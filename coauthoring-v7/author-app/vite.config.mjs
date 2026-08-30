import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const apiTarget = process.env.V7_AUTHOR_API_TARGET ?? 'http://127.0.0.1:43111';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 43180,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.origin !== undefined) proxyRequest.setHeader('origin', 'http://127.0.0.1:43110');
          });
        }
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 43180,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
});
