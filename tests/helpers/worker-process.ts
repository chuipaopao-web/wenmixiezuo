import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUT_LIMIT = 16_384;

export function workerSourceProcessArgs(): string[] {
  return [
    '--import',
    pathToFileURL(resolve(process.cwd(), 'tests/helpers/windows-tsx-preload.mjs')).href,
    '--import',
    'tsx',
    resolve(process.cwd(), 'apps/worker/src/main.ts')
  ];
}

export function captureChildProcessDiagnostics(child: ChildProcess): { summary: () => string } {
  let stdout = '';
  let stderr = '';

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = appendBounded(stderr, chunk);
  });

  return {
    summary: () => [
      `Worker exitCode=${child.exitCode ?? 'running'}, signal=${child.signalCode ?? 'none'}`,
      stderr.trim() === '' ? undefined : `stderr: ${stderr.trim()}`,
      stdout.trim() === '' ? undefined : `stdout: ${stdout.trim()}`
    ].filter((part): part is string => part !== undefined).join('\n')
  };
}

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= OUTPUT_LIMIT ? combined : combined.slice(-OUTPUT_LIMIT);
}
