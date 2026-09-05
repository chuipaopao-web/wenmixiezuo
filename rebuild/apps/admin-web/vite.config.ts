import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 43281,
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
  }
});
