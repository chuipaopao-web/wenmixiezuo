import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { buildJudgePrompt } from '../../apps/api/src/application/evaluation/eval-judge.js';
import { buildFixture } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';
import { ProductionEvalAdapter } from './node-model-eval.js';
const batchId = 'model-node-eval-b1-validation-judging';
const dbPath = '.local/eval/node-model-eval.sqlite';
async function main(): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(resolve(dbPath));
  runMigrations(db, resolve('apps/api/src/infrastructure/db/migrations'));
  const repo = new NodeEvaluationRepository(db);
  repo.ensureBudget(batchId, 400, 12_000_000);
  const config = loadModelRuntimeConfig();
  const adapter = new ProductionEvalAdapter(new ModelAdapterFactory(config));
  for (const genre of ['历史融合', '都市感情'] as const) {
    const f = buildFixture(genre, 'medium');
    const prompt = buildJudgePrompt('skeleton', f, JSON.stringify(f.cleanPlan));
    const reserved = Math.ceil(prompt.length / 2) + 2000 + 4096;
    const key = `diag:ds-pro:clean-${genre}:${Date.now()}`;
    if (!repo.tryReserve(batchId, key, 1, reserved)) throw new Error('预算硬停');
    try {
      const response = await adapter.generate({ provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', prompt, maxOutputTokens: 2000, temperature: 0.2 });
      const usageKnown = response.usage !== null && response.usage.inputTokens !== null && response.usage.outputTokens !== null;
      repo.settle(batchId, key, { requests: 1, reservedTokens: reserved, actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null });
      console.log(`--- ${genre} clean ---`);
      console.log(response.output.slice(0, 500));
    } catch (error) {
      repo.settle(batchId, key, { requests: 1, reservedTokens: reserved, actualTokens: null });
      console.log(`--- ${genre} 调用失败: ${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }
  db.close();
}
if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/judge-calib-diag2.ts')) {
  main().catch(error => { console.error('失败：', error); process.exit(1); });
}
