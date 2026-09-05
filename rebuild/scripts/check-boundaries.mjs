import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(process.argv[2] ?? process.cwd());
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".vite", "coverage", ".tools"]);
const builtinNames = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const packageRoots = [
  ["@wenmi-rebuild/contracts", path.join(root, "packages", "contracts")],
  ["@wenmi-rebuild/backend", path.join(root, "packages", "backend")],
  ["@wenmi-rebuild/api", path.join(root, "apps", "api")],
  ["@wenmi-rebuild/worker", path.join(root, "apps", "worker")],
  ["@wenmi-rebuild/author-web", path.join(root, "apps", "author-web")],
  ["@wenmi-rebuild/admin-web", path.join(root, "apps", "admin-web")]
];

const workspacePackages = new Set(packageRoots.map(([name]) => name));
const allowedExternalPackages = await readAllowedExternalPackages(root);
const errors = [];
const fileGraph = new Map();
const packageGraph = new Map(packageRoots.map(([name]) => [name, new Set()]));

const files = await listFiles(root);
for (const file of files) {
  const owner = findOwnerPackage(file);
  if (!owner) {
    continue;
  }
  fileGraph.set(file, new Set());
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const specifier of collectImports(sourceFile)) {
    checkImport(file, owner, specifier);
  }
}

detectFileCycles();
detectPackageCycles();

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`boundary check passed (${files.length} source files)`);

async function readAllowedExternalPackages(projectRoot) {
  const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
  const manifest = JSON.parse(raw);
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})
  ]);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      output.push(...(await listFiles(path.join(directory, entry.name))));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      output.push(path.join(directory, entry.name));
    }
  }
  return output;
}

function collectImports(sourceFile) {
  const imports = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push(node.arguments[0].text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      imports.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function checkImport(file, owner, specifier) {
  if (isForbiddenProjectSpecifier(specifier)) {
    errors.push(`${relative(file)} imports forbidden old or root project path: ${specifier}`);
  }

  const resolved = resolveInternalTarget(file, specifier);
  if (resolved) {
    if (!isInside(resolved, root)) {
      errors.push(`${relative(file)} imports outside rebuild: ${specifier}`);
      return;
    }

    const targetOwner = findOwnerPackage(resolved);
    if (targetOwner) {
      fileGraph.get(file)?.add(resolved);
      if (targetOwner !== owner) {
        packageGraph.get(owner)?.add(targetOwner);
      }
      checkLayer(file, owner, targetOwner, resolved, specifier);
    }
    return;
  }

  const workspaceTarget = workspacePackageFromSpecifier(specifier);
  if (workspaceTarget) {
    packageGraph.get(owner)?.add(workspaceTarget);
    checkLayer(file, owner, workspaceTarget, null, specifier);
    return;
  }

  if (!isAllowedExternalSpecifier(specifier)) {
    errors.push(`${relative(file)} imports unknown bare specifier: ${specifier}`);
  }
  checkRuntimeAdapterImport(file, specifier, null);
}

function resolveInternalTarget(file, specifier) {
  if (specifier.startsWith("file:")) {
    try {
      return path.resolve(new URL(specifier));
    } catch {
      errors.push(`${relative(file)} imports invalid file URL: ${specifier}`);
      return null;
    }
  }
  if (path.isAbsolute(specifier)) {
    return resolveExistingSource(specifier);
  }
  if (!specifier.startsWith(".")) {
    return null;
  }
  return resolveExistingSource(path.resolve(path.dirname(file), specifier));
}

function resolveExistingSource(candidate) {
  const extension = path.extname(candidate);
  const tsSourceCandidates =
    extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs"
      ? [candidate.slice(0, -extension.length) + ".ts", candidate.slice(0, -extension.length) + ".tsx"]
      : [];
  const candidates = [
    candidate,
    ...tsSourceCandidates,
    ...[...sourceExtensions].map((extension) => `${candidate}${extension}`),
    ...[...sourceExtensions].map((extension) => path.join(candidate, `index${extension}`))
  ];
  return candidates.find((target) => files.includes(target)) ?? candidate;
}

function workspacePackageFromSpecifier(specifier) {
  for (const packageName of workspacePackages) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return packageName;
    }
  }
  return null;
}

function isAllowedExternalSpecifier(specifier) {
  if (builtinNames.has(specifier)) {
    return true;
  }
  const packageName = packageNameFromBareSpecifier(specifier);
  return Boolean(packageName && allowedExternalPackages.has(packageName));
}

function packageNameFromBareSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  return specifier.split("/")[0] ?? null;
}

function checkLayer(file, owner, targetOwner, resolved, specifier) {
  if (owner === "@wenmi-rebuild/contracts" && targetOwner !== "@wenmi-rebuild/contracts") {
    errors.push(`${relative(file)} contracts cannot import ${specifier}`);
  }
  if (
    (owner === "@wenmi-rebuild/author-web" || owner === "@wenmi-rebuild/admin-web") &&
    targetOwner !== owner &&
    targetOwner !== "@wenmi-rebuild/contracts"
  ) {
    errors.push(`${relative(file)} web apps can only import contracts among workspace packages`);
  }
  if (owner === "@wenmi-rebuild/backend" && targetOwner.startsWith("@wenmi-rebuild/") && targetOwner !== "@wenmi-rebuild/contracts" && targetOwner !== "@wenmi-rebuild/backend") {
    errors.push(`${relative(file)} backend cannot import app package ${specifier}`);
  }
  checkRuntimeAdapterImport(file, specifier, resolved);
  checkCrossModuleImport(file, resolved);
}

function checkRuntimeAdapterImport(file, specifier, resolved) {
  const normalizedFile = normalize(file);
  const normalizedTarget = resolved ? normalize(resolved) : "";
  const inDomain =
    normalizedFile.includes("/packages/backend/src/domain/") ||
    (normalizedFile.includes("/packages/backend/src/modules/") && normalizedFile.includes("/domain/"));
  if (!inDomain) {
    return;
  }
  if (specifier === "pg" || specifier.startsWith("pg/") || specifier === "fastify" || specifier.startsWith("fastify/")) {
    errors.push(`${relative(file)} domain code cannot import runtime adapter ${specifier}`);
  }
  if (normalizedTarget.includes("/packages/backend/src/infrastructure/") || specifier.includes("/infrastructure/")) {
    errors.push(`${relative(file)} domain code cannot import infrastructure`);
  }
}

function checkCrossModuleImport(file, resolved) {
  if (!resolved) {
    return;
  }
  const sourceModule = backendModuleName(file);
  const targetModule = backendModuleName(resolved);
  if (sourceModule && targetModule && sourceModule !== targetModule && !normalize(resolved).endsWith(`/modules/${targetModule}/index.ts`)) {
    errors.push(`${relative(file)} cross-module imports must use the target module public entry: ${relative(resolved)}`);
  }
}

function backendModuleName(file) {
  const match = normalize(file).match(/\/packages\/backend\/src\/modules\/([^/]+)\//);
  return match?.[1] ?? null;
}

function isForbiddenProjectSpecifier(specifier) {
  return (
    specifier.includes("coauthoring-v7") ||
    specifier === "apps" ||
    specifier.startsWith("apps/") ||
    specifier.startsWith("packages/") ||
    specifier.startsWith("@wenmi/") ||
    specifier.startsWith("@wenmi-v7/")
  );
}

function detectFileCycles() {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  const visit = (file) => {
    if (visiting.has(file)) {
      const index = stack.indexOf(file);
      const cycle = [...stack.slice(index), file].map(relative).join(" -> ");
      errors.push(`file import cycle: ${cycle}`);
      return;
    }
    if (visited.has(file)) {
      return;
    }
    visiting.add(file);
    stack.push(file);
    for (const next of fileGraph.get(file) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };

  for (const file of fileGraph.keys()) {
    visit(file);
  }
}

function detectPackageCycles() {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  const visit = (packageName) => {
    if (visiting.has(packageName)) {
      const index = stack.indexOf(packageName);
      errors.push(`package cycle: ${[...stack.slice(index), packageName].join(" -> ")}`);
      return;
    }
    if (visited.has(packageName)) {
      return;
    }
    visiting.add(packageName);
    stack.push(packageName);
    for (const next of packageGraph.get(packageName) ?? []) {
      if (next !== packageName) {
        visit(next);
      }
    }
    stack.pop();
    visiting.delete(packageName);
    visited.add(packageName);
  };

  for (const packageName of packageGraph.keys()) {
    visit(packageName);
  }
}

function findOwnerPackage(file) {
  return packageRoots.find(([, packageRoot]) => isInside(file, packageRoot))?.[0] ?? null;
}

function isInside(target, container) {
  const relativePath = path.relative(container, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalize(file) {
  return path.resolve(file).split(path.sep).join("/");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
