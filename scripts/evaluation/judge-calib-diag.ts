/**
 * 校准诊断探针（一次性）：对指定评审模型跑clean-skeleton校准调用，打印完整原始结论（含issues），
 * 用于定位clean-skeleton连续误判的根因。消耗计入judging账本（reserveKey=diag:*），不重复发送。
 * 用法：tsx scripts/evaluation/judge-calib-diag.ts --model deepseek-v4-pro [--probe clean-skeleton]
 */
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { buildCalibrationCases } from '../../apps/api/src/application/evaluation/eval-judge.js';
import { buildFixture } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';
import { ProductionEvalAdapter } from './node-model-eval.js';

const argv = process.argv.slice(2);
const get = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const modelId = get('model') ?? 'deepseek-v4-pro';
const probeLabel = get('probe') ?? 'clean-skeleton';
const batchId = 'model-node-eval-b1-validation-judging';
const dbPath = '.local/eval/node-model-eval.sqlite';

async function main(): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(resolve(dbPath));
  runMigrations(db, resolve('apps/api/src/infrastructure/db/migrations'));
  const repo = new NodeEvaluationRepository(db);
  repo.ensureBudget(batchId, 400, 12_000_000);
  const config = loadModelRuntimeConfig();
  if (config.activeMode !== 'subscription-plan') throw new Error('订阅模式未激活');
  const adapter = new ProductionEvalAdapter(new ModelAdapterFactory(config));
  const probe = buildCalibrationCases(buildFixture('玄幻成长', 'medium')).find(p => p.label === probeLabel);
  if (!probe) throw new Error(`探针不存在：${probeLabel}`);
  console.log(`探针 ${probe.label}（预期${probe.expectPass ? '过' : '不过'}），提示含对抗线职责=${probe.prompt.includes('对抗压力初显') || probe.prompt.includes('对抗正面升级')}`);
  const reserved = Math.ceil(probe.prompt.length / 2) + 2000 + 4096;
  const key = `diag:${modelId}:${probe.label}:${Date.now()}`;
  if (!repo.tryReserve(batchId, key, 1, reserved)) throw new Error('预算硬停');
  try {
    const response = await adapter.generate({ provider: 'volcengine-ark-agent-plan', modelId, prompt: probe.prompt, maxOutputTokens: 2000, temperature: 0.2 });
    const usageKnown = response.usage !== null && response.usage.inputTokens !== null && response.usage.outputTokens !== null;
    repo.settle(batchId, key, { requests: 1, reservedTokens: reserved, actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null });
    console.log('--- 评审原始输出 ---');
    console.log(response.output);
  } catch (error) {
    repo.settle(batchId, key, { requests: 1, reservedTokens: reserved, actualTokens: null });
    throw error;
  } finally { db.close(); }
}
if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/judge-calib-diag.ts')) {
  main().catch(error => { console.error('诊断失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
