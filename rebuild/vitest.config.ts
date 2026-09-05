import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "threads",
    fileParallelism: false,
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@wenmi-rebuild/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@wenmi-rebuild/backend": fileURLToPath(new URL("./packages/backend/src/index.ts", import.meta.url)),
      "@wenmi-rebuild/backend/infrastructure/postgres/client": fileURLToPath(
        new URL("./packages/backend/src/infrastructure/postgres/client.ts", import.meta.url)
      ),
      "@wenmi-rebuild/backend/infrastructure/postgres/migrations": fileURLToPath(
        new URL("./packages/backend/src/infrastructure/postgres/migrations.ts", import.meta.url)
      )
    }
  }
});
