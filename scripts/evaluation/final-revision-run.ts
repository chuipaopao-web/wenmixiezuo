#!/usr/bin/env tsx
/**
 * 915a3a79复核·最终候选收尾（真实模型，单一新批次窗口）。
 *   tsx scripts/evaluation/final-revision-run.ts
 * 批次s1-fast-close-final-revision：最多16真实请求/100万保守tokens/120分钟（首次dispatch持久化，先到即止；
 * 旧s1-fast-close-revise的21/24及事故消耗封存不清零、不复用过期墙钟）。
 * 流程：①预算双检（父账本+run内部，换账本不清run累计）→②冻结核定驱动reviseAgain（只修v3/v4的A1交接，
 * v1/v2/v5/v6逐字段不变；旧finalize保留"未完成"不再为旧稿调用）→③自然过审（review.pass且selfCheck.pass）
 * 才真实HTTP采用+同键回放→④合法资料修改预览/保存失效/刷新恢复。受阻交完整候选+具体原因+准确用量。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { TimeMachineDesignService } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { computeRunSpend } from '../../apps/api/src/application/books/time-machine-run-spend.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ParentBudgetGuard, ParentBudgetExhausted } from './parent-budget-guard.js';
import { FINAL_ADJUDICATION } from './final-adjudication.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const BATCH = 's1-fast-close-final-revision';
const STATE_FILE = '.local/eval/final-revision-state.json';
const EVAL_DB = '.local/eval/node-model-eval.sqlite';
const WINDOW = { requests: 16, tokens: 1_000_000, wallClockMs: 120 * 60_000 }; // 915a3a79：16请求/100万tokens/120分钟
const now = (): string => new Date().toISOString();

interface RunState { notes: { at: string; text: string }[]; adoptedCandidateId?: string; adoptedRevision?: number }
const state: RunState = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RunState : { notes: [] };
function note(text: string): void {
  state.notes.push({ at: now(), text });
  mkdirSync('.local/eval', { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[final] ${text}`);
}

async function main(): Promise<void> {
  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43113, dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'final-revision-worker-token-000000000000000000',
    promptViewPassword: 'final-revision-prompt-view',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const db: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(db, config);
  const evalDb: DatabaseSync = openDatabase(resolve(EVAL_DB));
  const guard = new ParentBudgetGuard(evalDb, BATCH, WINDOW);
  guard.reconcile(); // 新批次首跑对账（无历史行则全零；活进程不动、禁止全批清零）

  // ① 预算双检
  const budgetNow = guard.snapshot();
  note(`父预算复核：实耗${budgetNow.actual}+未知${budgetNow.unknown}+预留${budgetNow.reserved}/${budgetNow.limitRequests}请求（余量${budgetNow.limitRequests - budgetNow.actual - budgetNow.unknown - budgetNow.reserved}）；旧批次21/24封存不清零`);
  const run = db.prepare('SELECT id, owner_id, book_id, state, phase FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { owner_id: string; book_id: string; state: string; phase: string } | undefined;
  if (!run) throw new Error(`run ${RUN_ID} 不存在`);
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const spendNow = computeRunSpend(db, scope, RUN_ID);
  if (spendNow.gaps.length) {
    note(`run预算统计缺口（fail closed）：${spendNow.gaps.join('；')}`);
    db.close(); evalDb.close();
    return;
  }
  const spent = { calls: spendNow.calls, tokens: spendNow.tokens };
  if (spent.calls >= 120 || spent.tokens + 64000 > 520000) {
    note(`run内预算无余量：calls=${spent.calls} tokens=${spent.tokens}（上限120/520000-64000）——停止，不发起新dispatch`);
    db.close(); evalDb.close();
    return;
  }
  note(`run内预算复核：calls=${spent.calls}/120 tokens=${spent.tokens}+64000/520000（有余量，run累计不因换父账本清空）`);

  // ② 冻结核定驱动reviseAgain（只修v3/v4的A1交接；成功步骤缓存重放、中断恢复同轮幂等）
  const factory = new ModelAdapterFactory(config.modelRuntime);
  const resolver = (provider: string, modelId: string) => guard.wrap(factory.resolve(provider, modelId, 'structured_planning') as never);
  const gateway = new TimeMachineModelGateway(db, resolver as never);
  const service = new TimeMachineDesignService(db, gateway as never, 64000);
  let result: { revision?: number; review?: { pass?: boolean; issues?: string[]; inconclusive?: string[] }; selfCheck?: { pass?: boolean; issues?: string[] }; blocked?: string[] } | null = null;
  try {
    note(`reviseAgain启动：核定${FINAL_ADJUDICATION.length}条（A1交接冲突），目标revision3，只修v3/v4`);
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
    note(`reviseAgain中断（如实记录）：${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}；run=${JSON.stringify(after)}`);
    db.close(); evalDb.close();
    return;
  }
  const candidates = db.prepare('SELECT revision, length(body) AS len FROM tm2_candidates WHERE id=? ORDER BY revision').all(RUN_ID) as { revision: number; len: number }[];
  note(`候选在库：${JSON.stringify(candidates)}；reviseAgain结果：revision=${result?.revision} review.pass=${result?.review?.pass ?? '无'} selfCheck.pass=${result?.selfCheck?.pass ?? '无'} inconclusive=${(result?.review?.inconclusive ?? []).length}条`);
  for (const issue of (result?.review?.issues ?? []).slice(0, 10)) note(`  审查issue：${issue.slice(0, 130)}`);
  for (const issue of (result?.selfCheck?.issues ?? []).slice(0, 10)) note(`  自检issue：${issue.slice(0, 130)}`);
  for (const m of (result?.review?.inconclusive ?? []).slice(0, 5)) note(`  审查信息不足：${m.slice(0, 130)}`);
  for (const b of (result?.blocked ?? []).slice(0, 5)) note(`  阻塞标记：${b.slice(0, 130)}`);

  // ③ 自然过审才真实HTTP采用+同键回放（合法窗口64000；此时无queued run）
  const emailRow = db.prepare('SELECT email_normalized FROM user_accounts WHERE owner_id=?').get(scope.ownerId) as { email_normalized: string } | undefined;
  const bookId = scope.bookId;
  const app = await createAppServer(config, db, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43113', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: emailRow?.email_normalized, password: 'Strong-test-pass-123!' } });
  if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const inj = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { ...headers, cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const getState = async () => (await inj('GET', `/api/time-machine/books/${bookId}/state`)).json().data as {
    runs: { id: string; kind: string; state: string; result: { revision: number; review: { pass: boolean } } | null }[];
    storylineMaterial?: { revision: number; content?: Record<string, unknown> } | null;
  };

  const naturalPass = result?.review?.pass === true && result?.selfCheck?.pass === true && typeof result.revision === 'number';
  if (naturalPass) {
    note('采用前逐条核对：review.pass与selfCheck.pass均自然通过（未修改原模型结论）；k2.7审查可靠性未达标，采用仅验证工程链路');
    const adopt = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result!.revision, expectedRevision: 0, idempotencyKey: 'final-revision-adopt' });
    if (adopt.statusCode !== 200) {
      note(`HTTP采用失败${adopt.statusCode}：${adopt.body.slice(0, 200)}（如实记录不伪装）`);
    } else {
      state.adoptedCandidateId = RUN_ID;
      state.adoptedRevision = result!.revision;
      note(`HTTP采用成功：candidate=${RUN_ID} revision=${result!.revision}`);
      const replay = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result!.revision, expectedRevision: 0, idempotencyKey: 'final-revision-adopt' });
      note(`采用同键回放=${replay.statusCode}（应200且不重复生效）`);
    }
  } else {
    note(`未自然过审：不发生HTTP采用（review.pass=${result?.review?.pass ?? '无'} selfCheck.pass=${result?.selfCheck?.pass ?? '无'}）；完整候选保留待修订`);
  }

  // ④ 合法资料修改预览/失效/刷新恢复（零模型调用；材料内容直接读库构造合法payload）
  const matRow = db.prepare('SELECT revision, content_json FROM tm2_storyline_materials WHERE owner=? AND book=?').get(scope.ownerId, bookId) as { revision: number; content_json: string } | undefined;
  if (matRow) {
    const content = JSON.parse(matRow.content_json) as Record<string, unknown>;
    content.authorNote = `${String(content.authorNote ?? '')}（作者修改：加强粮草线权重）`;
    const preview = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, { content, expectedRevision: matRow.revision });
    note(`资料影响预览${preview.statusCode}（合法payload应200）：${preview.body.slice(0, 200)}`);
    const stale = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'final-revision-stale', selection: { recommendationRunId: '4699f7ca-3d6f-4efe-98f8-f26aee96598f', recommendationHash: 'x', preparationVersion: 'x', selectedLineIds: ['x'], addedLines: [], shape: 'auto', ensemble: true, authorNote: '' }, expectedMaterialRevision: 999 });
    note(`过期版本999设计请求=${stale.statusCode}（应409且retryable=false）：${stale.body.slice(0, 160)}`);
    const s2 = await getState();
    const runsBefore = s2.runs.length;
    const replay2 = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'fc-e2e-round', selection: { note: '同键刷新' }, expectedMaterialRevision: matRow.revision });
    const runsAfter = (await getState()).runs.length;
    note(`同键刷新=${replay2.statusCode}，runs数${runsBefore}→${runsAfter}（不重复创建=${runsAfter === runsBefore}）`);
  } else {
    note('无正式材料行：资料修改验证如实标注跳过');
  }

  const snap = guard.snapshot();
  note(`账本：实耗${snap.actual}+未知${snap.unknown}+预留${snap.reserved}/${snap.limitRequests}请求，tokens见评测库tm2_eval_budget`);
  db.close(); evalDb.close();
  await app.close();
}

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/final-revision-run.ts')) {
  main().catch(error => { console.error('最终收尾失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
