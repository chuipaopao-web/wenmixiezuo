#!/usr/bin/env tsx
/**
 * MODEL-NODE-EVAL验证阶段质量盲评运行器：
 *   tsx scripts/evaluation/node-model-judge.ts --batch model-node-eval-b1-judging --db .local/eval/node-model-eval.sqlite
 * 对validation阶段生成节点结构通过且工件在案的case做异模型盲评（评审模型≠本案例模型）；
 * 主审判不过→第二名异模型复核；一致不过=0，分歧=null单独统计。
 * 主判通过→按序号确定性抽查（每3抽1）异模型复核；抽查不过=分歧null=未定，不自动算过（防误放）。
 * 评审前先做可靠性校准（已知正确应判过/已知缺陷应判不过），校准不过的评审其结论标注仅供参考；
 * 校准结果写 .local/eval/judge-calibration.json（幂等：已覆盖名册则不重复调用）。
 * 评审调用计入本批次独立账本；结尾打印各账分账+合计（合并核算，不绕合同总上限）。
 */
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TEXT_MODELS } from '@wenmi/agent-catalog';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import {
  buildJudgePrompt, parseJudgeVerdict, judgePoolFor, loadJudgmentInput, buildCalibrationCases,
  shouldSpotCheck, JUDGE_CONFIG_ID, CALIBRATION_CONFIG_ID
} from '../../apps/api/src/application/evaluation/eval-judge.js';
import { buildFixture } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';
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

interface CalibrationFile {
  configId: string;
  updatedAt: string;
  judges: Record<string, { calibrated: boolean; results: { label: string; expectPass: boolean; actualPass: boolean | null; ok: boolean }[] }>;
}

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

  // 通用评审调用：预算预留/结算与本批账本一致；reserveKey保证幂等粒度
  const callJudge = async (modelId: string, reserveKey: string, prompt: string): Promise<{ pass: boolean; issues: string[] }> => {
    const reserved = Math.ceil(prompt.length / 2) + MAX_OUTPUT + 4096;
    if (!repo.tryReserve(batchId, reserveKey, 1, reserved)) throw new Error('预算硬停');
    try {
      const response = await adapter.generate({
        provider: 'volcengine-ark-agent-plan', modelId, prompt, maxOutputTokens: MAX_OUTPUT, temperature: TEMPERATURE
      });
      const usageKnown = response.usage !== null && response.usage.inputTokens !== null && response.usage.outputTokens !== null;
      repo.settle(batchId, reserveKey, {
        requests: 1, reservedTokens: reserved,
        actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null
      });
      return parseJudgeVerdict(response.output);
    } catch (error) {
      repo.settle(batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: null });
      throw error;
    }
  };

  // ---- 评审可靠性校准：已知正确应判过、已知缺陷应判不过；幂等（已覆盖名册且配置一致则不重复调用）----
  const calibrationPath = join(dirname(resolve(dbPath)), 'judge-calibration.json');
  let calibration: CalibrationFile = { configId: CALIBRATION_CONFIG_ID, updatedAt: '', judges: {} };
  if (existsSync(calibrationPath)) {
    try {
      const existing = JSON.parse(readFileSync(calibrationPath, 'utf8')) as CalibrationFile;
      if (existing.configId === CALIBRATION_CONFIG_ID) calibration = existing;
    } catch { /* 损坏文件按未校准重跑 */ }
  }
  const calibrationFixture = buildFixture('玄幻成长', 'medium');
  const calibrationCases = buildCalibrationCases(calibrationFixture);
  const uncalibratedJudges = new Set<string>();
  let calibrationDirty = false;
  for (const judge of judgeRoster) {
    if (calibration.judges[judge]) { if (!calibration.judges[judge]!.calibrated) uncalibratedJudges.add(judge); continue; }
    const results: CalibrationFile['judges'][string]['results'] = [];
    for (const probe of calibrationCases) {
      try {
        const verdict = await callJudge(judge, `calib:${judge}:${probe.label}`, probe.prompt);
        results.push({ label: probe.label, expectPass: probe.expectPass, actualPass: verdict.pass, ok: verdict.pass === probe.expectPass });
      } catch (error) {
        if (error instanceof Error && error.message === '预算硬停') throw error;
        results.push({ label: probe.label, expectPass: probe.expectPass, actualPass: null, ok: false });
      }
    }
    const calibrated = results.every(r => r.ok);
    calibration.judges[judge] = { calibrated, results };
    if (!calibrated) uncalibratedJudges.add(judge);
    calibrationDirty = true;
    console.log(`[校准] ${judge}：${calibrated ? '通过' : '未过'}（${results.map(r => `${r.label}${r.actualPass === null ? '调用失败' : r.actualPass === r.expectPass ? '✓' : '✗预期' + (r.expectPass ? '过' : '不过') + '实际' + (r.actualPass ? '过' : '不过')}`).join(' ')}）`);
  }
  if (calibrationDirty) {
    calibration.updatedAt = new Date().toISOString();
    writeFileSync(calibrationPath, JSON.stringify(calibration, null, 2));
  }
  if (uncalibratedJudges.size) console.log(`校准未过评审：${[...uncalibratedJudges].join('、')}（其结论标注仅供参考）`);
  const noteFor = (judgeId: string): string => uncalibratedJudges.has(judgeId) ? '（评审校准未过仅供参考）' : '';

  const pending = repo.casesNeedingJudgment();
  console.log(`待评审case：${pending.length}`);
  let judged = 0; let split = 0; let failed = 0; let budgetStopped = false;

  for (let index = 0; index < pending.length; index++) {
    const caseRow = pending[index]!;
    const input = loadJudgmentInput(artifactDir, caseRow);
    if (!input) { console.log(`[跳过] ${caseRow.node_key} × ${caseRow.model_profile_key}：工件缺失`); continue; }
    const prompt = buildJudgePrompt(caseRow.node_key, input.fixture, input.output);

    const primary = judgePoolFor(caseRow.model_profile_key, judgeRoster, index);
    if (!primary) { console.log(`[跳过] ${caseRow.node_key} × ${caseRow.model_profile_key}：无可用异模型评审`); continue; }
    try {
      const first = await callJudge(primary, `judge:${caseRow.id}`, prompt);
      if (first.pass) {
        // 主判通过→确定性抽查：异模型复核，抽查不过=分歧未定（防"主判过才复核"漏掉误放）
        if (shouldSpotCheck(index)) {
          const checker = judgePoolFor(caseRow.model_profile_key, judgeRoster, index + 1, primary);
          if (!checker) {
            repo.setCaseJudgment(caseRow.id, { quality_pass: 1, quality_note: `盲评通过（${primary}，应抽查但无复核模型可用）${noteFor(primary)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: primary });
            judged++;
            continue;
          }
          const check = await callJudge(checker, `spot:${caseRow.id}`, prompt);
          if (check.pass) {
            repo.setCaseJudgment(caseRow.id, { quality_pass: 1, quality_note: `双评审一致通过（${primary}+${checker}抽查）${noteFor(primary)}${noteFor(checker)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${checker}` });
            judged++;
          } else {
            repo.setCaseJudgment(caseRow.id, { quality_pass: null, quality_note: `评审分歧（${primary}判过/${checker}抽查不过）：${check.issues.slice(0, 2).join('；')}${noteFor(primary)}${noteFor(checker)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${checker}` });
            split++;
          }
          continue;
        }
        repo.setCaseJudgment(caseRow.id, { quality_pass: 1, quality_note: `盲评通过（${primary}）${noteFor(primary)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: primary });
        judged++;
        continue;
      }
      // 主审判不过→第二名异模型复核（评审模型不能一票淘汰竞争者）
      const secondary = judgePoolFor(caseRow.model_profile_key, judgeRoster, index + 1, primary);
      if (!secondary) {
        repo.setCaseJudgment(caseRow.id, { quality_pass: null, quality_note: `主评审${primary}判不过但无复核模型可用：${first.issues.join('；')}${noteFor(primary)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: primary });
        split++;
        continue;
      }
      const second = await callJudge(secondary, `judge2:${caseRow.id}`, prompt);
      if (!second.pass) {
        repo.setCaseJudgment(caseRow.id, { quality_pass: 0, quality_note: `双评审一致不过：${[...first.issues, ...second.issues].slice(0, 3).join('；')}${noteFor(primary)}${noteFor(secondary)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${secondary}` });
        failed++;
      } else {
        repo.setCaseJudgment(caseRow.id, { quality_pass: null, quality_note: `评审分歧（${primary}判不过/${secondary}判过）：${first.issues.slice(0, 2).join('；')}${noteFor(primary)}${noteFor(secondary)}`.slice(0, 300), judge_source: JUDGE_CONFIG_ID, judge_model_id: `${primary}+${secondary}` });
        split++;
      }
    } catch (error) {
      if (error instanceof Error && error.message === '预算硬停') { budgetStopped = true; console.log('[预算硬停] 评审批次达上限，剩余case保留待续'); break; }
      // 评审调用失败不猜结果：保持未评审（judge_source仍为NULL），下一批继续
      console.log(`[评审失败] ${caseRow.node_key} × ${caseRow.model_profile_key}：${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`);
    }
  }
  const after = repo.readBudget(batchId)!;
  console.log(`评审完成：通过${judged} 不过${failed} 分歧${split} ${budgetStopped ? '（预算硬停）' : ''}；本账实耗${after.actual_requests}+未知${after.unknown_requests}/${after.limit_requests}`);
  // 合并核算：分账+合计一并展示（不以独立账本绕过合同总上限）
  const all = repo.budgetTotals();
  for (const b of all.batches) console.log(`  [账] ${b.batch_id}：请求${b.actual_requests}+未知${b.unknown_requests}+预留${b.reserved_requests}/${b.limit_requests}，token ${b.actual_tokens}+${b.unknown_tokens}+${b.reserved_tokens}/${b.limit_tokens}`);
  console.log(`  [合计] 请求${all.totals.actual_requests}+未知${all.totals.unknown_requests}+预留${all.totals.reserved_requests}，token ${all.totals.actual_tokens}+${all.totals.unknown_tokens}+${all.totals.reserved_tokens}`);
  db.close();
}

// 仅直接调用时执行main（复用import不触发评审主流程，可干跑验证）
if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/node-model-judge.ts')) {
  main().catch(error => { console.error('评审运行器失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
