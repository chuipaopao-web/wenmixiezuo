import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const applications = [
  { name: 'contracts', source: 'apps/contracts/src', entries: ['apps/contracts/src/index.ts'] },
  { name: 'api', source: 'apps/api/src', entries: ['apps/api/src/main.ts', 'apps/api/src/infrastructure/db/migrate-cli.ts'] },
  { name: 'worker', source: 'apps/worker/src', entries: ['apps/worker/src/main.ts'] },
  { name: 'web', source: 'apps/web/src', entries: ['apps/web/src/main.tsx'] },
];
const check = process.argv.includes('--check');

function normalize(path) {
  return path.split(sep).join('/');
}

function collect(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collect(full));
    else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')) result.push(resolve(full));
  }
  return result;
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/u, '.ts'),
    base.replace(/\.js$/u, '.tsx'),
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function importsOf(file) {
  const content = readFileSync(file, 'utf8');
  const specifiers = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*(?:import|export)\b/u.test(line)) continue;
    let statement = line;
    let consumed = 0;
    while (!statement.includes(';') && index + 1 < lines.length && consumed < 24) {
      index += 1;
      consumed += 1;
      statement += `\n${lines[index]}`;
    }
    const match = /(?:\bfrom\s*)?['"]([^'"]+)['"]/u.exec(statement);
    if (match !== null) specifiers.push(match[1]);
  }
  for (const match of content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) specifiers.push(match[1]);
  return specifiers;
}

let unreachableTotal = 0;
for (const application of applications) {
  const files = collect(resolve(root, application.source));
  const known = new Set(files);
  const visited = new Set();
  const queue = application.entries.map((entry) => resolve(root, entry));
  while (queue.length > 0) {
    const file = queue.shift();
    if (!known.has(file) || visited.has(file)) continue;
    visited.add(file);
    for (const specifier of importsOf(file)) {
      const dependency = resolveRelative(file, specifier);
      if (dependency !== null && known.has(dependency) && !visited.has(dependency)) queue.push(dependency);
    }
  }
  const unreachable = files.filter((file) => !visited.has(file)).sort();
  unreachableTotal += unreachable.length;
  console.log(`${application.name}: reachable=${visited.size}, unreachable=${unreachable.length}`);
  for (const file of unreachable) console.log(`  ${normalize(relative(root, file))}`);
}

if (check && unreachableTotal > 0) process.exitCode = 1;
