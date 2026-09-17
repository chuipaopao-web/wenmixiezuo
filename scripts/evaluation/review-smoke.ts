#!/usr/bin/env tsx
/**
 * S1-FAST-CLOSE审查冒烟（合同步骤2）：
 *   tsx scripts/evaluation/review-smoke.ts --batch s1-fast-close --models kimi-k3,kimi-k2.7-code
 * 用冻结的人工核对样本集（.local/eval/review-smoke-set.json，正确2+明确严重缺陷2，调参不用）
 * 对最多两个不同底层审查候选各跑4次（review-anchors生产修正后提示，可见输出6000实验参数）。
 * 合格线：正确样本不误拒（pass=true）且缺陷样本不漏报（pass=false且命中植入错误）。
 * 冒烟资格不替代n≥10正式准入。全部调用计入本批父账本（默认80请求/300万token/4小时，与后续端到端共用）。
 * 漂移防护：冻结contentHash与当前fixture不一致即中止（样本必须是冻结版本，不静默跟随夹具变化）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { buildFixture } from '../../apps/api/src/application/evaluation/eval-sample-factory.js';
import { timeMachineReviewChecks } from '../../apps/api/src/application/books/time-machine-review.js';
import { ProductionEvalAdapter } from './node-model-eval.js';
import type { EvalAdapter } from '../../apps/api/src/application/evaluation/node-evaluation-executor.js';

const argv = process.argv.slice(2);
const get = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const batchId = get('batch') ?? 's1-fast-close';
const dbPath = get('db') ?? '.local/eval/node-model-eval.sqlite';
const models = (get('models') ?? 'kimi-k3,kimi-k2.7-code').split(',').filter(Boolean);
const MAX_OUTPUT = Number(get('max-output') ?? 6000); // S1-FAST-CLOSE实验参数：审查可见输出初始6000
const limitRequests = Number(get('limit-requests') ?? 80);
const limitTokens = Number(get('limit-tokens') ?? 3_000_000);
const PROMPT_VERSION = 'review-anchors-v3-anchor-semantics';
// 截断证据后的定向复验（合同：仅截断证据才可对该节点改8000复验一次，版本分开）
const ONLY_SAMPLE = get('only-sample');
const ONLY_MODEL = get('only-model');
const ATTEMPT_SEQ = Number(get('attempt') ?? 1);
const CONFIG_VERSION = MAX_OUTPUT === 6000 ? 'cfg-fast-close-smoke' : `cfg-fast-close-smoke-max${MAX_OUTPUT}`; // 8000复验与6000版本分开（合同）

const listRule = '每条问题或建议不超过80字并定位到具体卷或故事线（如卷B、主线1）；阻塞问题放在issues前部；单次issues最多10条、suggestions最多10条；若阻塞问题超过10条，将hasMoreIssues设为true，系统会追加询问，不要省略、合并或概括掉阻塞问题。';

interface SmokeSample { id: string; kind: 'correct' | 'flawed'; genre: '玄幻成长' | '历史融合' | '都市感情'; plan: Record<string, unknown>; seededErrors?: string[]; verification: string; contentHash: string }

interface Verdict { pass: boolean; issues: string[]; suggestions: string[] }

function parseVerdict(text: string): Verdict {
  const match = text.match(/\{[\s\S]*\}/u);
  if (!match) throw new Error('审查输出非JSON');
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  if (typeof parsed.pass !== 'boolean' || !Array.isArray(parsed.issues) || parsed.issues.some(i => typeof i !== 'string')) throw new Error('审查格式错误');
  return { pass: parsed.pass === true && (parsed.issues as string[]).length === 0, issues: (parsed.issues as string[]).slice(0, 10), suggestions: Array.isArray(parsed.suggestions) ? (parsed.suggestions as string[]).slice(0, 10) : [] };
}

/** 与reviewAnalysis一致的植入错误召回保守近似（关键词归类，最终判定以人工核对issues为准）。 */
function seededRecall(issues: string[]): number {
  const text = issues.join('\n');
  const checks = [/字数|合计|400000|350000|target/u, /对抗线|贯穿|去向|职责/u, /将来|承诺|已经获得|无法核对|未发生/u];
  return checks.filter(c => c.test(text)).length;
}

function buildSmokePrompt(sample: SmokeSample): string {
  const f = buildFixture(sample.genre, 'medium');
  const volumes = (sample.plan.volumes as Record<string, unknown>[]).slice(0, 2);
  const reads = f.documents.slice(0, 2).map(d => ({ key: d.key, text: d.text.slice(0, 1200) }));
  const section = volumes.map(v => ({ id: v.id, anchors: (v as { anchors?: unknown[] }).anchors ?? [], volume: { ...v, anchors: undefined } }));
  return `核对候选锚点与条件（本批卷）。锚点条件是设计阶段定义、将来由正文兑现的核对点——本阶段没有正文是正常前提，不得以“尚无正文”或“无正文支撑”判问题。检查：每个锚点条件是否具体可核对（不是“获得认可后”式把将来承诺当已达成的循环表述）、与正式来源/短卡/作者要求一致、开场条件与开场文字自洽、收束条件与收束文字自洽、条件之间不矛盾；本批卷的开场、冲突、转折、人物弧光与爽点是否具体可信；未完成承接fallback是否可行。返回 {"pass":true或false,"issues":["具体问题"],"suggestions":["文学建议"],"hasMoreIssues":true或false}。issues与suggestions面向作者，用显示编号（卷A、主线1），不引用v1等内部ID或字段名。${listRule}\n正式资料短卡：${JSON.stringify(f.cardFields)}\n已回查原件：${JSON.stringify(reads)}\n本批：${JSON.stringify(section)}\n作者：${f.intent}\n${timeMachineReviewChecks}`;
}

async function main(): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const smokeSet = JSON.parse(readFileSync('.local/eval/review-smoke-set.json', 'utf8')) as { version: string; samples: SmokeSample[] };
  // 漂移防护：冻结样本必须与当前fixture逐字一致
  for (const s of smokeSet.samples) {
    const current = buildFixture(s.genre, 'medium');
    const expected = createHash('sha256').update(JSON.stringify(s.kind === 'correct' ? current.cleanPlan : current.flawedPlan)).digest('hex').slice(0, 16);
    if (expected !== s.contentHash) throw new Error(`冻结样本${s.id}与当前fixture不一致（${s.contentHash}≠${expected}）——样本必须是冻结版本，先核对夹具变更再重新冻结`);
  }
  const db = new DatabaseSync(resolve(dbPath));
  runMigrations(db, resolve('apps/api/src/infrastructure/db/migrations'));
  const repo = new NodeEvaluationRepository(db);
  const budget = repo.ensureBudget(batchId, limitRequests, limitTokens);
  repo.reconcileReservedOnBoot(batchId);
  console.log(`冒烟批 ${batchId} 父账本：实耗${budget.actual_requests}+未知${budget.unknown_requests}+预留${budget.reserved_requests}/${budget.limit_requests}请求（端到端共用此上限）`);

  const config = loadModelRuntimeConfig();
  if (config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活');
  if (config.endpoints.agent.apiKey === undefined) throw new Error('Agent Plan凭证未配置');
  const adapter: EvalAdapter = new ProductionEvalAdapter(new ModelAdapterFactory(config));
  const artifactDir = resolve(dirname(dbPath), 'artifacts');

  const results: { model: string; sampleId: string; kind: string; verdict: Verdict | null; qualityPass: number; note: string }[] = [];
  for (const modelId of models) {
    if (ONLY_MODEL && modelId !== ONLY_MODEL) continue;
    const runId = `eval-${batchId}-review-anchors-${modelId}-smoke`;
    if (!repo.readRun(runId)) {
      repo.createRun({
        id: runId, batch_id: batchId, node_key: 'review-anchors', length_band: 'all', member_role: 'chief',
        model_profile_key: modelId, provider: 'volcengine-ark-agent-plan', model_id: modelId, model_plan: 'agent',
        config_version: CONFIG_VERSION, prompt_version: PROMPT_VERSION, phase: 'validation', status: 'queued',
        sample_set_id: smokeSet.version, planned_cases: smokeSet.samples.length
      });
    }
    repo.setRunStatus(runId, 'working');
    for (const sample of smokeSet.samples) {
      if (ONLY_SAMPLE && sample.id !== ONLY_SAMPLE) continue;
      const sampleHash = createHash('sha256').update(JSON.stringify([runId, sample.id, sample.contentHash])).digest('hex').slice(0, 24);
      if (repo.completedCaseKeys(runId).has(`${sampleHash}#${ATTEMPT_SEQ}`)) { console.log(`[跳过] ${modelId} × ${sample.id} attempt${ATTEMPT_SEQ}已完成`); continue; }
      const prompt = buildSmokePrompt(sample);
      const reserved = Math.ceil(prompt.length / 2) + MAX_OUTPUT + 4096;
      const reserveKey = `${runId}:${sample.id}`;
      if (!repo.tryReserve(batchId, reserveKey, 1, reserved)) { console.log('[预算硬停] 父账本达上限，剩余样本保留'); break; }
      const queuedAt = new Date().toISOString();
      let outcome = 'unknown'; let technicalOk = 0; let contractOk: number | null = null; let qualityPass: number | null = null;
      let qualityNote: string | null = null; let errorCode: string | null = null; let httpStatus: number | null = null;
      let verdict: Verdict | null = null; let artifactPath: string | null = null;
      let usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null } | null = null;
      const startedAt = new Date().toISOString();
      try {
        const response = await adapter.generate({ provider: 'volcengine-ark-agent-plan', modelId, prompt, maxOutputTokens: MAX_OUTPUT, temperature: 0.6 });
        httpStatus = response.httpStatus ?? 200;
        usage = response.usage;
        const usageKnown = usage !== null && usage.inputTokens !== null && usage.outputTokens !== null;
        try {
          verdict = parseVerdict(response.output);
          outcome = 'ok'; technicalOk = 1; contractOk = 1;
          if (sample.kind === 'correct') {
            qualityPass = verdict.pass ? 1 : 0;
            qualityNote = verdict.pass ? '正确样本正确通过' : `正确样本误拒${verdict.issues.length}条`;
          } else {
            const recall = seededRecall(verdict.issues);
            qualityPass = !verdict.pass && recall >= 2 ? 1 : 0;
            qualityNote = verdict.pass ? '缺陷样本漏报（判通过）' : `缺陷命中${recall}/3类（${verdict.issues.length}条issues）`;
          }
          const name = `${runId.replace(/[^A-Za-z0-9_-]/gu, '_')}__${sample.id}__a${ATTEMPT_SEQ}.json`;
          writeFileSync(`${artifactDir}/${name}`, JSON.stringify({ nodeKey: 'review-anchors', modelProfileKey: modelId, sampleId: sample.id, kind: sample.kind, output: response.output }), 'utf8');
          artifactPath = name;
          repo.settle(batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null });
        } catch (parseError) {
          outcome = 'contract_error'; technicalOk = 1; contractOk = 0;
          errorCode = parseError instanceof Error ? parseError.message.slice(0, 120) : '审查格式错误';
          repo.settle(batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: usageKnown ? response.usage!.inputTokens! + response.usage!.outputTokens! + (response.usage!.reasoningTokens ?? 0) : null });
        }
      } catch (error) {
        repo.settle(batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: null });
        outcome = error instanceof Error && error.message.includes('截断') ? 'truncated' : 'http_error';
        errorCode = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
      }
      const finishedAt = new Date().toISOString();
      repo.insertCase({
        run_id: runId, node_key: 'review-anchors', model_profile_key: modelId, sample_hash: sampleHash, attempt_seq: ATTEMPT_SEQ,
        genre: sample.genre, length_band: 'medium', time_slot: 'T1', sample_kind: sample.kind === 'correct' ? 'positive' : 'negative',
        input_hash: createHash('sha256').update(prompt).digest('hex'), config_version: CONFIG_VERSION, prompt_version: PROMPT_VERSION,
        http_status: httpStatus, outcome, technical_ok: technicalOk, contract_ok: contractOk,
        quality_pass: qualityPass, quality_note: qualityNote, judge_source: null, judge_model_id: null,
        input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, reasoning_tokens: usage?.reasoningTokens ?? null,
        usage_known: usage !== null && usage.inputTokens !== null && usage.outputTokens !== null ? 1 : 0, reserved_tokens: reserved, retry_count: 0,
        queued_at: queuedAt, started_at: startedAt, finished_at: finishedAt,
        queue_ms: 0, duration_ms: Date.parse(finishedAt) - Date.parse(startedAt), error_code: errorCode, artifact_path: artifactPath,
        provider_model_version: null, id: randomUUID()
      });
      results.push({ model: modelId, sampleId: sample.id, kind: sample.kind, verdict, qualityPass: qualityPass ?? -1, note: qualityNote ?? (errorCode ?? '调用失败') });
      console.log(`[${outcome}] ${modelId} × ${sample.id}：${qualityNote ?? errorCode}`);
    }
    repo.setRunStatus(runId, 'succeeded');
  }

  console.log('\n=== 冒烟资格判定（正确不误拒且缺陷不漏报）===');
  for (const modelId of models) {
    const mine = results.filter(r => r.model === modelId);
    const correctOk = mine.filter(r => r.kind === 'correct').every(r => r.qualityPass === 1);
    const flawedOk = mine.filter(r => r.kind === 'flawed').every(r => r.qualityPass === 1);
    const qualified = mine.length === smokeSet.samples.length && correctOk && flawedOk;
    console.log(`${modelId}：${qualified ? '冒烟通过（实验候选，不替代n≥10正式准入）' : `冒烟未过（${mine.map(r => `${r.sampleId}=${r.note}`).join('；')}）`}`);
  }
  const after = repo.readBudget(batchId)!;
  console.log(`父账本：实耗${after.actual_requests}+未知${after.unknown_requests}+预留${after.reserved_requests}/${after.limit_requests}请求，token ${after.actual_tokens}+${after.unknown_tokens}+${after.reserved_tokens}/${after.limit_tokens}`);
  db.close();
}

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/review-smoke.ts')) {
  main().catch(error => { console.error('冒烟运行器失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
