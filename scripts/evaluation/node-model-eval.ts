/**
 * MODEL-NODE-EVAL评测运行器（真实调用，合同预算纪律）。
 * 用法（worktree根目录，凭据只从环境变量读取，不落盘不输出）：
 *   set WENMI_ARK_AGENT_PLAN_API_KEY=... & set WENMI_MODEL_MODE=subscription-plan
 *   tsx scripts/evaluation/node-model-eval.ts --phase screen --batch model-node-eval-b1
 * 参数：
 *   --phase screen|validation（默认screen）
 *   --nodes a,b（默认首批八节点）
 *   --models k1,k2（默认名册全部文字模型；缺权限/未登记如实标未测）
 *   --batch id（默认model-node-eval-b1；同id重跑自动断点续传）
 *   --limit-requests N（默认400） --limit-tokens N（默认12000000）
 *   --db 路径（默认.local/eval/node-model-eval.sqlite）
 * 每case真实发送前原子预留预算；429退避；结果逐行入库；结束打印汇总JSON。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ModelAdapterError } from '../../apps/api/src/infrastructure/models/model-adapter.js';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { NodeEvaluationExecutor, EvalCallError, type EvalAdapter, type EvalAdapterRequest, type EvalAdapterResponse, type EvalRunPlan } from '../../apps/api/src/application/evaluation/node-evaluation-executor.js';
import { buildSamples } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';
import { buildEvalPrompt, validateEvalOutput } from '../../apps/api/src/application/evaluation/eval-prompt-builders.js';
import { EVAL_BATCH1_NODE_KEYS, findEvalNode } from '../../apps/api/src/application/evaluation/node-registry.js';
import { timeMachineSynthesisHeadroom } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { TEXT_MODELS } from '@wenmi/agent-catalog';

interface Args { phase: 'screen' | 'validation'; nodes: string[]; models: string[] | null; batch: string; limitRequests: number; limitTokens: number; db: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    phase: (get('phase') === 'validation' ? 'validation' : 'screen'),
    nodes: get('nodes')?.split(',').filter(Boolean) ?? [...EVAL_BATCH1_NODE_KEYS],
    models: get('models')?.split(',').filter(Boolean) ?? null,
    batch: get('batch') ?? 'model-node-eval-b1',
    limitRequests: Number(get('limit-requests') ?? 400),
    limitTokens: Number(get('limit-tokens') ?? 12_000_000),
    db: get('db') ?? '.local/eval/node-model-eval.sqlite'
  };
}

class ProductionEvalAdapter implements EvalAdapter {
  constructor(private readonly factory: ModelAdapterFactory) {}
  async generate(request: EvalAdapterRequest): Promise<EvalAdapterResponse> {
    const adapter = this.factory.resolve(request.provider, request.modelId, 'structured_planning'); // 与生产时间机器网关一致
    try {
      const result = await adapter.generate({
        requestId: randomUUID(), taskId: 'model-node-eval', ownerId: '_system', bookId: '_eval',
        agentId: `eval-${request.modelId}`, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens,
        ...(request.thinkingHeadroomTokens !== undefined ? { thinkingHeadroomTokens: request.thinkingHeadroomTokens } : {}),
        temperature: request.temperature
      });
      return {
        output: result.output,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, reasoningTokens: null },
        httpStatus: 200
      };
    } catch (error) {
      if (error instanceof ModelAdapterError) {
        if (error.statusCode === 429) throw new EvalCallError('rate_limited', error.message, 429);
        if (error.outcomeUnknown) throw new EvalCallError('unknown', `结果未知：${error.vendorDiagnostic?.code ?? error.message}`);
        if (error.failureClass === 'authentication_failure') throw new EvalCallError('auth_error', '鉴权/套餐失效', error.statusCode);
        if (error.causeCode === 'output_length_limit') throw new EvalCallError('truncated', `截断：${error.truncationDiagnostic?.stopReason ?? 'output_length_limit'}`, error.statusCode);
        throw new EvalCallError('http_error', `供应商错误：${error.vendorDiagnostic?.code ?? error.failureClass}`, error.statusCode);
      }
      throw new EvalCallError('unknown', error instanceof Error ? error.message : 'unknown');
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  mkdirSync(dirname(args.db), { recursive: true });
  const db = new DatabaseSync(resolve(args.db));
  const migrations = runMigrations(db, resolve('apps/api/src/infrastructure/db/migrations'));
  if (migrations.applied.length) console.log(`迁移已应用：${migrations.applied.join(',')}`);
  const repo = new NodeEvaluationRepository(db);
  const budget = repo.ensureBudget(args.batch, args.limitRequests, args.limitTokens);
  repo.reconcileReservedOnBoot(args.batch); // 新进程无在途调用，悬空预留归零（实耗/未知不动）
  console.log(`批次 ${args.batch} 预算账本：实耗${budget.actual_requests}+未知${budget.unknown_requests}+预留${budget.reserved_requests}/${budget.limit_requests}请求，tokens ${budget.actual_tokens}+${budget.unknown_tokens}+${budget.reserved_tokens}/${budget.limit_tokens}`);

  const config = loadModelRuntimeConfig();
  if (config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活（WENMI_MODEL_MODE=subscription-plan），拒绝发起真实调用');
  if (config.endpoints.agent.apiKey === undefined) throw new Error('Agent Plan凭证未配置（WENMI_ARK_AGENT_PLAN_API_KEY）');
  const factory = new ModelAdapterFactory(config);
  const adapter = new ProductionEvalAdapter(factory);

  // 名册全部文字模型（@wenmi/agent-catalog TEXT_MODELS，排除已停用glm-5.2；MiniMax未登记名册不枚举）
  const roster = TEXT_MODELS.filter(m => m.profileKey !== 'glm-5.2' && m.kind === 'text').map(m => m.profileKey);
  const targets = args.models ?? roster;
  const untested: { model: string; reason: string }[] = [];
  for (const profileKey of roster.filter(k => !targets.includes(k))) untested.push({ model: profileKey, reason: '本批未列入' });

  const executor = new NodeEvaluationExecutor(db, {});
  const sampleSetId = `eval-${args.phase}-v1`;
  const summary: { node: string; model: string; status: string; cases: number; ok: number; contractFail: number; truncated: number; other: number }[] = [];

  for (const nodeKey of args.nodes) {
    const node = findEvalNode(nodeKey);
    if (!node) { console.error(`未登记节点：${nodeKey}，跳过`); continue; }
    const samples = buildSamples(nodeKey, args.phase);
    for (const modelProfileKey of targets) {
      // 装配检查：模型未在套餐角色配置中=未测（不静默漏项）
      let probeOk = true;
      try { factory.resolve('volcengine-ark-agent-plan', modelProfileKey, 'structured_planning'); }
      catch (error) { probeOk = false; untested.push({ model: modelProfileKey, reason: error instanceof Error ? error.message : '装配失败' }); }
      if (!probeOk) { console.log(`[未测] ${nodeKey} × ${modelProfileKey}：${untested[untested.length - 1]!.reason}`); continue; }

      const runId = `eval-${args.batch}-${nodeKey}-${modelProfileKey}-${args.phase}`;
      const existing = repo.readRun(runId);
      if (!existing) {
        repo.createRun({
          id: runId, batch_id: args.batch, node_key: nodeKey, length_band: 'all', member_role: node.memberRole,
          model_profile_key: modelProfileKey, provider: 'volcengine-ark-agent-plan', model_id: modelProfileKey,
          model_plan: 'agent', config_version: `cfg-${args.phase}-default`, prompt_version: node.promptVersion,
          phase: args.phase, status: 'queued', sample_set_id: sampleSetId, planned_cases: samples.length
        });
      } else if (existing.status === 'succeeded') {
        console.log(`[跳过] ${nodeKey} × ${modelProfileKey} 已完成`);
        continue;
      }
      const headroom = timeMachineSynthesisHeadroom(modelProfileKey, node.budgetClass);
      const evalSamples = samples.map(s => ({ sampleHash: s.sampleHash, genre: s.genre, lengthBand: s.lengthBand, timeSlot: s.timeSlot, kind: s.kind, prompt: buildEvalPrompt(nodeKey, s) }));
      const plan: EvalRunPlan = {
        runId, batchId: args.batch, nodeKey, lengthBand: 'all', modelProfileKey,
        provider: 'volcengine-ark-agent-plan', modelId: modelProfileKey,
        configVersion: `cfg-${args.phase}-default`, promptVersion: node.promptVersion,
        maxOutputTokens: node.budgetClass, temperature: 0.6,
        ...(headroom !== undefined ? { thinkingHeadroomTokens: headroom } : {}),
        samples: evalSamples,
        validate: (output: string, evalSample) => {
          const sample = samples.find(s => s.sampleHash === evalSample.sampleHash)!;
          const analysis = validateEvalOutput(nodeKey, sample, output);
          return {
            qualityPass: nodeKey.startsWith('review') ? (sample.kind === 'negative' ? (analysis.seededCaught ?? null) : !(analysis.cleanFalseAlarm ?? false)) : null,
            qualityNote: analysis.note
          };
        }
      };
      console.log(`[评测] ${nodeKey} × ${modelProfileKey}：${samples.length}样本`);
      const status = await executor.execute(plan, adapter);
      const cases = repo.casesForRun(runId);
      summary.push({
        node: nodeKey, model: modelProfileKey, status, cases: cases.length,
        ok: cases.filter(c => c.outcome === 'ok').length,
        contractFail: cases.filter(c => c.outcome === 'contract_error').length,
        truncated: cases.filter(c => c.outcome === 'truncated').length,
        other: cases.filter(c => !['ok', 'contract_error', 'truncated'].includes(c.outcome)).length
      });
      console.log(`[${status}] ${nodeKey} × ${modelProfileKey}：ok=${summary[summary.length - 1]!.ok}/${cases.length}`);
      if (status === 'budget-stopped') { console.log('预算硬停，结束本批。'); break; }
    }
  }
  const finalBudget = repo.readBudget(args.batch)!;
  console.log(JSON.stringify({
    batch: args.batch, phase: args.phase,
    budget: { actual: finalBudget.actual_requests, unknown: finalBudget.unknown_requests, reserved: finalBudget.reserved_requests, tokens: { actual: finalBudget.actual_tokens, unknown: finalBudget.unknown_tokens, reserved: finalBudget.reserved_tokens } },
    untested, summary
  }, null, 1));
  db.close();
}

main().catch(error => { console.error('评测运行器失败：', error instanceof Error ? error.message : error); process.exitCode = 1; });
