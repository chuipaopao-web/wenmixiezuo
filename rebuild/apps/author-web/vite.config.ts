import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 43280,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:43282",
        rewrite: (targetPath) => targetPath.replace(/^\/api/, "")
      }
    }
  },
  resolve: {
    alias: {
      "@wenmi-rebuild/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url))
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"]
  }
});
