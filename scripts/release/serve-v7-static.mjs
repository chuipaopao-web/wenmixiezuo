import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request as upstreamRequest } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE_NAME,
  resolveCurrentV7StaticRelease,
  resolveStaticRequest,
  verifyV7StaticRelease
} from './v7-static-release.mjs';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

export async function createV7StaticServer({
  releaseDirectory,
  apiHost = '127.0.0.1',
  apiPort = 43111
}) {
  const verified = await verifyV7StaticRelease(releaseDirectory);
  const manifest = JSON.parse(await readFile(join(verified.releaseDirectory, MANIFEST_FILE_NAME), 'utf8'));
  const availableFiles = new Set(manifest.files.map((file) => file.path));

  return createServer((incoming, response) => {
    let resolved;
    try {
      resolved = resolveStaticRequest(incoming.url ?? '/', availableFiles);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    if (resolved.kind === 'upstream') {
      proxyToApi(incoming, response, apiHost, apiPort);
      return;
    }
    if (resolved.kind === 'redirect') {
      response.writeHead(308, { location: resolved.location });
      response.end();
      return;
    }
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }

    const filePath = join(verified.releaseDirectory, ...resolved.path.split('/'));
    const headers = {
      'content-type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': resolved.path.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff'
    };
    response.writeHead(200, headers);
    if (incoming.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.once('error', () => {
      if (!response.headersSent) response.writeHead(500);
      response.destroy();
    });
    stream.pipe(response);
  });
}

function proxyToApi(incoming, response, apiHost, apiPort) {
  const headers = { ...incoming.headers, host: `${apiHost}:${apiPort}` };
  const proxy = upstreamRequest({
    hostname: apiHost,
    port: apiPort,
    method: incoming.method,
    path: incoming.url,
    headers
  }, (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.once('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: 'Local API is unavailable.' } }));
    } else {
      response.destroy();
    }
  });
  incoming.pipe(proxy);
}

async function main() {
  const projectRoot = process.cwd();
  const requestedDirectory = process.argv[2];
  const release = requestedDirectory === undefined
    ? await resolveCurrentV7StaticRelease(projectRoot)
    : await verifyV7StaticRelease(resolve(requestedDirectory));
  const server = await createV7StaticServer({ releaseDirectory: release.releaseDirectory });
  const port = Number.parseInt(process.env.WENMI_WEB_PORT ?? '43110', 10);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  console.log(`V7 static release ${release.releaseId} is ready at http://127.0.0.1:${port}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
