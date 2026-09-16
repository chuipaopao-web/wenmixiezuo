#!/usr/bin/env tsx
/**
 * MODEL-NODE-EVAL验证阶段质量盲评运行器：
 *   tsx scripts/evaluation/node-model-judge.ts --batch model-node-eval-b1-judging --db .local/eval/node-model-eval.sqlite
 * 对validation阶段生成节点结构通过且工件在案的case做异模型盲评（评审模型≠本案例模型）；
 * 主审判不过→第二名异模型复核；一致不过=0，分歧=null单独统计。评审调用计入本批次独立账本。
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TEXT_MODELS } from '@wenmi/agent-catalog';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { buildJudgePrompt, parseJudgeVerdict, judgePoolFor, loadJudgmentInput, JUDGE_CONFIG_ID } from '../../apps/api/src/application/evaluation/eval-judge.js';
import { ProductionEvalAdapter } from './node-model-eval.js';
import type { EvalAdapter } from '../../apps/api/src/application/evaluation/node-evaluation-executor.js';

const argv = process.argv.slice(2);
const get = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const batchId = get('batch') ?? 'model-node-eval-b1-judging';
const dbPath = get('db') ?? '.local/eval/node-model-eval.sqlite';
const limitRequests = Number(get('limit-requests') ?? 400);
const limitTokens = Number(get('limit-tokens') ?? 12_000_000);
const MAX_OUTPUT = 2000;
const TEMPERATURE = 0.2;

async function main(): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(resolve(dbPath));
  runMigrations(db, resolve('apps/api/src/infrastructure/db/migrations'));
  const repo = new NodeEvaluationRepository(db);
  const budget = repo.ensureBudget(batchId, limitRequests, limitTokens);
  repo.reconcileReservedOnBoot(batchId);
  console.log(`评审批次 ${batchId} 账本：实耗${budget.actual_requests}+未知${budget.unknown_requests}+预留${budget.reserved_requests}/${budget.limit_requests}请求`);

  const config = loadModelRuntimeConfig();
  if (config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活，拒绝发起真实调用');
  if (config.endpoints.agent.apiKey === undefined) throw new Error('Agent Plan凭证未配置');
  const adapter: EvalAdapter = new ProductionEvalAdapter(new ModelAdapterFactory(config));

  // 评审名册：初筛结构可工作的模型（排除已停用glm-5.2）；排除顺序只影响轮换起点
  const judgeRoster = TEXT_MODELS.filter(m => m.profileKey !== 'glm-5.2' && m.kind === 'text').map(m => m.profileKey);
  const artifactDir = resolve(dirname(dbPath), 'artifacts');
  const pending = repo.casesNeedingJudgment();
  console.log(`待评审case：${pending.length}`);
  let judged = 0; let split = 0; let failed = 0; let budgetStopped = false;

  for (let index = 0; index < pending.length; index++) {
    const caseRow = pending[index]!;
    const input = loadJudgmentInput(artifactDir, caseRow);
    if (!input) { console.log(`[跳过] ${caseRow.node_key} × ${caseRow.model_profile_key}：工件缺失`); continue; }
    const prompt = buildJudgePrompt(caseRow.node_key, input.fixture, input.output);
    const reserved = Math.ceil(prompt.length / 2) + MAX_OUTPUT + 4096;

    const callJudge = async (modelId: string): Promise<{ pass: boolean; issues: string[] }> => {
      if (!repo.tryReserve(batchId, `judge:${caseRow.id}`, 1, reserved)) throw new Error('预算硬停');
      try {
        const response = await adapter.generate({
          provider: 'volcengine-ark-agent-plan', modelId, prompt, maxOutputTokens: MAX_OUTPUT, temperature: TEMPERATURE
        });
        const usageKnown = response.usage !== null && response.usage.inputTokens !== null && response.usage.outputTokens !== null;
        repo.settle(batchId, `judge:${caseRow.id}`, {
          requests: 1, reservedTokens: reserved,
          actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null
        });
        return parseJudgeVerdict(response.output);
      } catch (error) {
        repo.settle(batchId, `judge:${caseRow.id}`, { requests: 1, reservedTokens: reserved, actualTokens: null });
        throw error;
      }
    };

    const primary = judgePoolFor(caseRow.model_profile_key, judgeRoster, index);
    if (!primary) { console.log(`[跳过] ${caseRow.node_key} × ${caseRow.model_profile_key}：无可用异模型评审`); continue; }
    try {
      const first = await callJudge(primary);
      if (first.pass) {
        repo.setCaseJudgment(caseRow.id, { quality_pass: 1, quality_note: `盲评通过（${primary}）`, judge_source: JUDGE_CONFIG_ID, judge_model_id: primary });
        judged++;
        continue;
      }
      // 主审判不过→第二名异模型复核（评审模型不能一票淘汰竞争者）
      const secondary = judgePoolFor(caseRow.model_profile_key, judgeRoster, index + 1, primary);
      if (!secondary) {
        repo.setCaseJudgment(caseRow.id, { quality_pass: null, quality_note: `主评审${primary}判不过但无复核模型可用：${first.issues.join('；')}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: primary });
        split++;
        continue;
      }
      const second = await callJudge(secondary);
      if (!second.pass) {
        repo.setCaseJudgment(caseRow.id, { quality_pass: 0, quality_note: `双评审一致不过：${[...first.issues, ...second.issues].slice(0, 3).join('；')}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${secondary}` });
        failed++;
      } else {
        repo.setCaseJudgment(caseRow.id, { quality_pass: null, quality_note: `评审分歧（${primary}判不过/${secondary}判过）：${first.issues.slice(0, 2).join('；')}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${secondary}` });
        split++;
      }
    } catch (error) {
      if (error instanceof Error && error.message === '预算硬停') { budgetStopped = true; console.log('[预算硬停] 评审批次达上限，剩余case保留待续'); break; }
      // 评审调用失败不猜结果：保持未评审（judge_source仍为NULL），下一批继续
      console.log(`[评审失败] ${caseRow.node_key} × ${caseRow.model_profile_key}：${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`);
    }
  }
  const after = repo.readBudget(batchId)!;
  console.log(`评审完成：通过${judged} 不过${failed} 分歧${split} ${budgetStopped ? '（预算硬停）' : ''}；账本实耗${after.actual_requests}+未知${after.unknown_requests}/${after.limit_requests}`);
  db.close();
}

main().catch(error => { console.error('评审运行器失败：', error instanceof Error ? error.message : error); process.exit(1); });
