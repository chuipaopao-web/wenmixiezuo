#!/usr/bin/env tsx
/**
 * d8407c59复核·revision3完整证据复查窗口（真实模型，一次性受控批次）。
 *   tsx scripts/evaluation/review-evidence-run.ts
 * 批次s1-fast-close-review-evidence：最多12真实请求/75万保守tokens/120分钟（首次dispatch持久化，先到即止；
 * 不自动延期续批；历史各批账保持不清零）。run内原520000基线保持记录，本批一次性75万上限为该run/该批
 * 受控增量（可信装配显式预算策略注入并审计配置，非客户端传参、不全局放宽生产）；120调用上限保留；
 * 父预算与run限额取更严格者，先核查全链足额再发送。
 * 流程：①统一统计（当前+归档按调用ID去重，fail closed）输出历史累计→②全链足额预检→③reviseAgain同轮恢复
 * （只完成revision3审查：修订/自检缓存重放零重发，不生成revision4；旧稿finalize不执行）→④自然过审且自检
 * 无未处置硬问题才真实HTTP采用/回放/合法资料修改失效验证→⑤未过审交完整候选+具体分类，停止自动修订。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { TimeMachineDesignService } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineResumeService } from '../../apps/api/src/application/books/time-machine-resume-service.js';
import { computeRunSpend } from '../../apps/api/src/application/books/time-machine-run-spend.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ParentBudgetGuard, ParentBudgetExhausted } from './parent-budget-guard.js';
import { FINAL_ADJUDICATION } from './final-adjudication.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const BATCH = 's1-fast-close-review-evidence';
const STATE_FILE = '.local/eval/review-evidence-state.json';
const EVAL_DB = '.local/eval/node-model-eval.sqlite';
const WINDOW = { requests: 12, tokens: 750_000, wallClockMs: 120 * 60_000 };
const RUN_TOKENS_INCREMENT = 750_000; // 本run/本批一次性受控增量（原520000基线保持记录）
const RUN_TOKENS_LIMIT = 520_000 + RUN_TOKENS_INCREMENT;
const now = (): string => new Date().toISOString();

interface RunState { notes: { at: string; text: string }[]; adoptedCandidateId?: string; adoptedRevision?: number }
const state: RunState = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RunState : { notes: [] };
function note(text: string): void {
  state.notes.push({ at: now(), text });
  mkdirSync('.local/eval', { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[review] ${text}`);
}

async function main(): Promise<void> {
  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43114, dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'review-evidence-worker-token-00000000000000000',
    promptViewPassword: 'review-evidence-prompt-view',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const db: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(db, config);
  const evalDb: DatabaseSync = openDatabase(resolve(EVAL_DB));
  const guard = new ParentBudgetGuard(evalDb, BATCH, WINDOW);
  guard.reconcile();
  if (!evalDb.prepare('SELECT 1 FROM tm2_eval_budget_ext WHERE batch_id=?').get(BATCH)) {
    guard.grantWallClockExtensionOnce(60 * 60_000, '87ce990a纠偏：原余额续最后两卷，一次60分钟，不新增请求或token额度');
  }

  // ① 统一统计：当前+归档attempts按调用ID去重（fail closed）；更正后历史累计
  const run = db.prepare('SELECT owner_id, book_id FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { owner_id: string; book_id: string } | undefined;
  if (!run) throw new Error(`run ${RUN_ID} 不存在`);
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const spend = computeRunSpend(db, scope, RUN_ID);
  if (spend.gaps.length) {
    note(`run预算统计缺口（fail closed，不按0）：${spend.gaps.join('；')}`);
    db.close(); evalDb.close();
    return;
  }
  note(`run历史累计（统一口径含归档去重）：${spend.calls}次/${spend.tokens}tokens；run原520000基线保持记录，本批一次性增量上限${RUN_TOKENS_INCREMENT}；120调用上限保留`);

  // ② 全链足额预检：估计复审查全链（结构至多3读+finalize+锚点3批及截断降级），父预算与run增量取更严格者
  const budgetNow = guard.snapshot();
  const parentLeft = budgetNow.limitRequests - budgetNow.actual - budgetNow.unknown - budgetNow.reserved;
  const runTokensLeft = RUN_TOKENS_LIMIT - spend.tokens;
  const estCalls = 2; // 已验证恢复frontier仅v5/v6，其他成功审查复用
  const estTokens = estCalls * 64_000;
  note(`足额预检：父余量${parentLeft}/12请求（需${estCalls}）；run累计限额${RUN_TOKENS_LIMIT}、余量${runTokensLeft}tokens（估${estTokens}）；取更严格者`);
  if (spend.calls + estCalls > 120 || parentLeft < estCalls || runTokensLeft < estTokens) {
    note(`全链不足额（calls=${spend.calls}+${estCalls}/120 父余量=${parentLeft} run增量余量=${runTokensLeft}）——不启动发送，保留现场`);
    db.close(); evalDb.close();
    return;
  }

  // ③ reviseAgain同轮恢复：只完成revision3审查（修订/自检缓存重放零重发；不生成revision4）
  // 先服务化恢复准备（非成功步骤回ready留证据、run回queued、活租约阻塞事务内核验）——reviseAgain不替代既有恢复边界
  const prep = new TimeMachineResumeService(db).prepare(scope, RUN_ID);
  for (const action of prep.actions) note(`恢复动作：${action}`);
  if (prep.blocked.length) {
    for (const b of prep.blocked) note(`恢复阻塞（不触网）：${b}`);
    db.close(); evalDb.close();
    return;
  }
  const factory = new ModelAdapterFactory(config.modelRuntime);
  const resolver = (provider: string, modelId: string) => {
    const a = factory.resolve(provider, modelId, 'structured_planning') as { inputContext?: (r: { prompt: string }) => string };
    const origInput = a.inputContext?.bind(a);
    a.inputContext = (r: { prompt: string }) => {
      const s = origInput ? origInput(r) : JSON.stringify({ messages: [{ role: 'user', content: r.prompt }] });
      note(`封套测量：envelope=${s.length} promptChars=${r.prompt.length} 差值=${s.length - r.prompt.length}`);
      return s;
    };
    return guard.wrap(a as never);
  };
  const gateway = new TimeMachineModelGateway(db, resolver as never);
  const service = new TimeMachineDesignService(db, gateway as never, 64000, { tokensLimit: RUN_TOKENS_LIMIT, reason: '87ce990a纠正：520000基线+750000已授权增量=1270000，仅隔离收尾，不全局放宽' });
  let result: { revision?: number; review?: { pass?: boolean; issues?: string[]; suggestions?: string[]; inconclusive?: string[] }; selfCheck?: { pass?: boolean; issues?: string[] }; blocked?: string[] } | null = null;
  try {
    note(`reviseAgain同轮恢复启动：完成revision3审查（输入不足的原审查重评、缺失锚点批次完成；成功结果复用）`);
    result = await service.reviseAgain(scope, RUN_ID, FINAL_ADJUDICATION) as typeof result;
  } catch (error) {
    if (error instanceof ParentBudgetExhausted) {
      note(`父预算发送前停止：${error.message}；已完成部分保留`);
      const snap = guard.snapshot();
      note(`账本：实耗${snap.actual}+未知${snap.unknown}+预留${snap.reserved}/${snap.limitRequests}请求`);
      db.close(); evalDb.close();
      return;
    }
    const after = db.prepare('SELECT state, phase, error_code, error_message FROM tm2_design_runs WHERE id=?').get(RUN_ID) as Record<string, unknown>;
    note(`复审查中断（如实记录）：${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}；run=${JSON.stringify(after)}`);
    db.close(); evalDb.close();
    return;
  }
  note(`复审查结果：revision=${result?.revision} review.pass=${result?.review?.pass ?? '无'} issues=${(result?.review?.issues ?? []).length}条 selfCheck.pass=${result?.selfCheck?.pass ?? '无'} inconclusive=${(result?.review?.inconclusive ?? []).length}条 blocked=${(result?.blocked ?? []).length}条`);
  for (const issue of (result?.review?.issues ?? []).slice(0, 10)) note(`  审查issue：${issue.slice(0, 140)}`);
  for (const issue of (result?.selfCheck?.issues ?? []).slice(0, 10)) note(`  自检issue：${issue.slice(0, 140)}`);
  for (const m of (result?.review?.inconclusive ?? []).slice(0, 5)) note(`  审查信息不足：${m.slice(0, 140)}`);
  for (const b of (result?.blocked ?? []).slice(0, 5)) note(`  阻塞标记：${b.slice(0, 140)}`);

  // ④ 自然过审且自检无未处置硬问题才真实HTTP采用/回放/合法资料失效验证
  const emailRow = db.prepare('SELECT email_normalized FROM user_accounts WHERE owner_id=?').get(scope.ownerId) as { email_normalized: string } | undefined;
  const bookId = scope.bookId;
  const app = await createAppServer(config, db, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43114', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: emailRow?.email_normalized, password: 'Strong-test-pass-123!' } });
  if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const inj = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { ...headers, cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

  const naturalPass = result?.review?.pass === true && result?.selfCheck?.pass === true && typeof result.revision === 'number';
  if (naturalPass) {
    note('采用前核对：review.pass与selfCheck.pass均自然通过（审查已见完整因果与限制证据；k2.7可靠性未达标，采用仅验证工程链路）');
    const adopt = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result!.revision, expectedRevision: 0, idempotencyKey: 'review-evidence-adopt' });
    if (adopt.statusCode !== 200) {
      note(`HTTP采用失败${adopt.statusCode}：${adopt.body.slice(0, 200)}（如实记录不伪装）`);
    } else {
      state.adoptedCandidateId = RUN_ID;
      state.adoptedRevision = result!.revision;
      note(`HTTP采用成功：candidate=${RUN_ID} revision=${result!.revision}`);
      const replay = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result!.revision, expectedRevision: 0, idempotencyKey: 'review-evidence-adopt' });
      note(`采用同键回放=${replay.statusCode}（应200且不重复生效）`);
    }
  } else {
    note(`未自然过审：不发生HTTP采用（review.pass=${result?.review?.pass ?? '无'} selfCheck.pass=${result?.selfCheck?.pass ?? '无'} inconclusive=${(result?.review?.inconclusive ?? []).length}条）；完整候选保留，停止自动修订`);
  }

  // 合法资料修改预览/失效/刷新恢复（零模型调用）
  const matRow = db.prepare('SELECT revision, content_json FROM tm2_storyline_materials WHERE owner=? AND book=?').get(scope.ownerId, bookId) as { revision: number; content_json: string } | undefined;
  if (matRow) {
    const content = JSON.parse(matRow.content_json) as Record<string, unknown>;
    content.authorNote = `${String(content.authorNote ?? '')}（作者修改：加强粮草线权重）`;
    const preview = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, { content, expectedRevision: matRow.revision });
    note(`资料影响预览${preview.statusCode}（合法payload应200）：${preview.body.slice(0, 200)}`);
    assert.equal(preview.statusCode,200);
    const savedSelection=JSON.parse(matRow.content_json);
    const stale = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'review-evidence-stale', selection: savedSelection, expectedMaterialRevision: 999 });
    assert.equal(stale.statusCode,409);
    assert.equal(stale.json().error.retryable,false);
    note(`过期版本999设计请求=${stale.statusCode}（应409且retryable=false）：${stale.body.slice(0, 160)}`);
    const getState = async () => (await inj('GET', `/api/time-machine/books/${bookId}/state`)).json().data as { runs: unknown[] };
    const runsBefore = (await getState()).runs.length;
    const expectedIds=db.prepare('SELECT id FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND round_key=?').all(scope.ownerId,bookId,'fc-e2e-round').map(r=>String(r.id)).sort();
    const replay2 = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'fc-e2e-round', selection: savedSelection });
    assert.ok([200,202].includes(replay2.statusCode),replay2.body);
    assert.deepEqual(replay2.json().data.runs.map((r:{id:string})=>r.id).sort(),expectedIds);
    const runsAfter = (await getState()).runs.length;
    assert.equal(runsAfter,runsBefore);
    note(`同键刷新=${replay2.statusCode}，runs数${runsBefore}→${runsAfter}（不重复创建=${runsAfter === runsBefore}）`);
  } else {
    note('无正式材料行：资料修改验证如实标注跳过');
  }

  const snap = guard.snapshot();
  const spendAfter = computeRunSpend(db, scope, RUN_ID);
  note(`账本：父批实耗${snap.actual}+未知${snap.unknown}+预留${snap.reserved}/${snap.limitRequests}请求；run累计（统一口径）${spendAfter.calls}次/${spendAfter.tokens}tokens`);
  db.close(); evalDb.close();
  await app.close();
}

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/review-evidence-run.ts')) {
  main().catch(error => { console.error('复审查窗口失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
