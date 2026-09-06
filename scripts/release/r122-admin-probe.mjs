#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRebuildControl } from '../../apps/api/dist/application/admin/rebuild-control-service.js';

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const databasePath = flag('--database');
const projectRoot = flag('--project-root') ?? process.cwd();
if (databasePath === null) {
  throw new Error('usage: node scripts/release/r122-admin-probe.mjs --database <wenmi.sqlite> [--project-root <release/source>]');
}

const sourceRoot = resolve(projectRoot);
const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
try {
  const releaseId = readFileSync(resolve(sourceRoot, 'RELEASE_ID'), 'utf8').trim();
  const data = await readRebuildControl({
    projectRoot: sourceRoot,
    releaseId,
    publicOrigin: 'https://wenmixiezuo.com'
  }, database);
  const result = {
    ok: true,
    unitCount: data.units.length,
    sourceFeatureCount: data.sourceFeatures.length,
    currentBatch: data.source.currentBatch ?? null,
    digest: data.source.digest
  };
  if (result.unitCount !== 81 || result.sourceFeatureCount !== 85) {
    throw new Error(`unexpected rebuild control shape: units=${result.unitCount} features=${result.sourceFeatureCount}`);
  }
  const source = readFileSync(resolve(sourceRoot, 'docs/REBUILD_EXECUTION_PLAN.md'));
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== result.digest) {
    throw new Error('rebuild control digest does not match deployed plan source');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
