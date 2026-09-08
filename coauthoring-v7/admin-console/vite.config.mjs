import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { verifyFunctionManagement } from '../../scripts/verify-function-management.mjs';

const apiTarget = process.env.V7_ADMIN_API_TARGET ?? 'http://127.0.0.1:43111';
const trustedLocalOrigin = process.env.V7_ADMIN_PROXY_ORIGIN ?? 'http://127.0.0.1:43110';

// Production serves these shared avatars at /avatars; give local admin the same URLs.
function sharedAvatars(server) {
  server.middlewares.use((req, res, next) => {
    const name = req.url?.split('?')[0];
    if (!['/avatars/editorial-women-v130.png', '/avatars/editorial-women-v131.png', '/avatars/diaochan-welcome-r166.png'].includes(name)) return next();
    readFile(new URL('../author-app/public' + name, import.meta.url)).then(data => {
      res.setHeader('Content-Type', 'image/png'); res.end(data);
    }).catch(next);
  });
}

const apiProxy = {
  target: apiTarget,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (request) => {
      // Local V7 admin runs on its own port while the API keeps the same
      // browser-origin fence as the author app. The development proxy is the
      // only bridge and must not weaken the API's production origin policy.
      request.setHeader('origin', trustedLocalOrigin);
      request.setHeader('sec-fetch-site', 'same-site');
    });
  }
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/v7/',
  plugins: [react(), { name: 'function-management-sync', apply: 'build', buildStart() { verifyFunctionManagement(fileURLToPath(new URL('../..', import.meta.url))); } }, { name: 'shared-member-avatars', configureServer: sharedAvatars, configurePreviewServer: sharedAvatars }],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 43170,
    strictPort: true,
    proxy: { '/api': apiProxy }
  },
  preview: {
    host: '127.0.0.1',
    port: 43170,
    strictPort: true,
    proxy: { '/api': apiProxy }
  }
});
