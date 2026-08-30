import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const apiTarget = process.env.V7_ADMIN_API_TARGET ?? 'http://127.0.0.1:43111';
const trustedLocalOrigin = process.env.V7_ADMIN_PROXY_ORIGIN ?? 'http://127.0.0.1:43110';

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
  plugins: [react()],
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
