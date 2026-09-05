import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.resolve("scripts/check-boundaries.mjs");

describe("architectural boundary checker", () => {
  it("rejects relative imports from domain to infrastructure", async () => {
    const root = await fixtureRoot("domain-infra");
    await writeFile(
      path.join(root, "packages/backend/src/domain/bad.ts"),
      "import '../infrastructure/config.js';\n"
    );
    await expect(runChecker(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("domain code cannot import infrastructure")
    });
  });

  it("rejects three-file internal cycles", async () => {
    const root = await fixtureRoot("cycles");
    await writeFile(path.join(root, "packages/contracts/src/a.ts"), "import './b.js';\n");
    await writeFile(path.join(root, "packages/contracts/src/b.ts"), "import './c.js';\n");
    await writeFile(path.join(root, "packages/contracts/src/c.ts"), "import './a.js';\n");
    await expect(runChecker(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("file import cycle")
    });
  });

  it("rejects unknown local-style bare aliases", async () => {
    const root = await fixtureRoot("aliases");
    await writeFile(path.join(root, "apps/author-web/src/app.ts"), "import 'apps/api/src/main.js';\n");
    await expect(runChecker(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("forbidden old or root project path")
    });
  });

  it("rejects frontend relative imports into API code", async () => {
    const root = await fixtureRoot("frontend-api");
    await writeFile(path.join(root, "apps/api/src/main.ts"), "export const api = true;\n");
    await writeFile(path.join(root, "apps/author-web/src/app.ts"), "import '../../api/src/main.js';\n");
    await expect(runChecker(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("web apps can only import contracts")
    });
  });

  it("rejects domain deep imports through the backend workspace package", async () => {
    const root = await fixtureRoot("domain-backend-deep");
    await writeFile(
      path.join(root, "packages/backend/src/domain/bad.ts"),
      "import '@wenmi-rebuild/backend/infrastructure/postgres/client';\n"
    );
    await expect(runChecker(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("domain code cannot import infrastructure")
    });
  });
});

async function fixtureRoot(name: string): Promise<string> {
  const root = await mkdir(path.resolve(".tools", "boundary-fixtures", `wenmi-boundary-${name}-${Date.now()}`), {
    recursive: true
  });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { typescript: "5.9.3" }, devDependencies: {} })
  );
  await Promise.all([
    mkdir(path.join(root, "packages/contracts/src"), { recursive: true }),
    mkdir(path.join(root, "packages/backend/src/domain"), { recursive: true }),
    mkdir(path.join(root, "packages/backend/src/infrastructure"), { recursive: true }),
    mkdir(path.join(root, "apps/author-web/src"), { recursive: true }),
    mkdir(path.join(root, "apps/admin-web/src"), { recursive: true }),
    mkdir(path.join(root, "apps/api/src"), { recursive: true }),
    mkdir(path.join(root, "apps/worker/src"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(root, "packages/contracts/src/index.ts"), ""),
    writeFile(path.join(root, "packages/backend/src/index.ts"), ""),
    writeFile(path.join(root, "apps/admin-web/src/index.ts"), ""),
    writeFile(path.join(root, "apps/api/src/index.ts"), ""),
    writeFile(path.join(root, "apps/worker/src/index.ts"), "")
  ]);
  return root;
}

async function runChecker(root: string) {
  return execFileAsync(process.execPath, [checker, root], { cwd: path.resolve(".") });
}
