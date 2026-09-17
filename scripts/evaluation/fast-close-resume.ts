#!/usr/bin/env tsx
/**
 * S1-FAST-CLOSE接续纠正：仅恢复c116818b完成审查与采用（真实模型，单一接续窗口）。
 *   tsx scripts/evaluation/fast-close-resume.ts
 * 接续窗口：20次真实请求/100万保守tokens/90分钟（自本脚本首次dispatch起，任一先到即止；
 * 父账本s1-fast-close-resume，与历史各账分列不清零）。不重做骨架和6卷卡（缓存命中证明在案），
 * 不开新书、不批量重跑、不部署。
 * 流程：①离线核对run/快照/检查点→②最小恢复路径（在途unknown如实结算、非成功步骤回ready、run回queued，审计记录）
 * →③service.process恢复（父预算包裹真实网关）→④自然过审才HTTP采用→⑤资料修改失效/同键刷新恢复。
 * 审查候选k2.7可靠性未达标：结果只证明实验链路，不宣称质量已验或可商用。
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
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { ParentBudgetGuard, ParentBudgetExhausted } from './parent-budget-guard.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const RESUME_STATE = '.local/eval/fast-close-resume-state.json';
const EVAL_DB = '.local/eval/node-model-eval.sqlite';
const WINDOW = { requests: 20, tokens: 1_000_000, wallClockMs: 90 * 60_000 };
const now = (): string => new Date().toISOString();

interface ResumeState { notes: { at: string; text: string }[]; adoptedCandidateId?: string }
const state: ResumeState = existsSync(RESUME_STATE)
  ? JSON.parse(readFileSync(RESUME_STATE, 'utf8')) as ResumeState
  : { notes: [] };
function note(text: string): void {
  state.notes.push({ at: now(), text });
  mkdirSync('.local/eval', { recursive: true });
  writeFileSync(RESUME_STATE, JSON.stringify(state, null, 2));
  console.log(`[resume] ${text}`);
}

async function main(): Promise<void> {
  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43111, dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'fast-close-worker-token-00000000000000000000000000',
    promptViewPassword: 'fast-close-prompt-view',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const db: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(db, config);
  // 父预算账本在评测库（与生产库分离；历史各账分列）
  const evalDb: DatabaseSync = openDatabase(resolve(EVAL_DB));
  const guard = new ParentBudgetGuard(evalDb, 's1-fast-close-resume', WINDOW);
  guard.reconcileOnBoot();

  // ① 离线核对run当前状态与检查点
  const run = db.prepare('SELECT id, owner_id, book_id, scheme, state, phase, error_code, snapshot_json FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { owner_id: string; book_id: string; scheme: string; state: string; phase: string; error_code: string | null } | undefined;
  if (!run) throw new Error(`run ${RUN_ID} 不存在`);
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const steps = db.prepare('SELECT id, state, attempt, error_code FROM tm2_steps WHERE id LIKE ? ORDER BY rowid').all(`${RUN_ID}:%`) as { id: string; state: string; attempt: string | null; error_code: string | null }[];
  note(`run核对：scheme=${run.scheme} state=${run.state} phase=${run.phase}；步骤${steps.length}（成功${steps.filter(s => s.state === 'succeeded').length}）`);

  // ② 最小恢复路径（审计：只结算在途unknown、非成功步骤回ready、run回queued；不伪造任何进度）
  // 2a. 在途working调用：结果未知，如实结算为unknown（消耗保留，不重发免费）
  const danglingCalls = db.prepare("SELECT id FROM tm2_model_calls WHERE id IN (SELECT attempt FROM tm2_steps WHERE id LIKE ? AND attempt IS NOT NULL) AND state='working'").all(`${RUN_ID}:%`) as { id: string }[];
  for (const call of danglingCalls) {
    db.prepare("UPDATE tm2_model_calls SET state='unknown', error_class='unknown', completed_at=? WHERE id=? AND state='working'").run(now(), call.id);
    note(`在途调用如实结算unknown：${call.id}（消耗保留，不免费重试）`);
  }
  // 2b. 非成功步骤（running/failed/unknown）回ready清租约，成功步骤原样保留（缓存命中已证明）
  const staleSteps = steps.filter(s => s.state !== 'succeeded');
  for (const s of staleSteps) {
    db.prepare("UPDATE tm2_steps SET state='ready', attempt=NULL, lease_until=NULL, error_code=NULL WHERE id=?").run(s.id);
    note(`步骤回ready待重试：${s.id.split(':').slice(-2).join(':')}（原${s.state}${s.error_code ? '/' + s.error_code : ''}）`);
  }
  // 2b+. 输入版本已变的成功步骤（reviewChecks去重/片段有界/片段长度改变了review-source提示合同）：
  // 合同要求"输入版本未变才缓存命中"——过期缓存不重用；归档旧行证据后删除，让新合同版本重新建步（非进度伪造）
  const changedInputSteps = steps.filter(s => /review-source|review-anchors/.test(s.id));
  for (const s of changedInputSteps) {
    const oldRow = db.prepare('SELECT state, error_code, output FROM tm2_steps WHERE id=?').get(s.id) as { state: string; error_code: string | null; output: string | null } | undefined;
    note(`输入版本已变归档重建：${s.id.split(':').slice(-2).join(':')}（旧state=${oldRow?.state}${oldRow?.error_code ? '/' + oldRow.error_code : ''}，旧输出前80=${(oldRow?.output ?? '').slice(0, 80)}）`);
    db.prepare('DELETE FROM tm2_attempts WHERE owner=? AND book=? AND step=?').run(scope.ownerId, scope.bookId, s.id);
    db.prepare('DELETE FROM tm2_steps WHERE owner=? AND book=? AND id=?').run(scope.ownerId, scope.bookId, s.id);
  }
  // 2c. run回queued（既有合法处理入口process只受理queued）
  if (run.state !== 'queued') {
    db.prepare("UPDATE tm2_design_runs SET state='queued', updated_at=? WHERE id=?").run(now(), RUN_ID);
    note(`run恢复入口：${run.state}→queued（审计：仅状态移交，无进度伪造）`);
  }

  // ③ 恢复执行：父预算包裹真实网关（每次dispatch发送前原子预留）
  const factory = new ModelAdapterFactory(config.modelRuntime);
  const resolver = (provider: string, modelId: string) => guard.wrap(factory.resolve(provider, modelId, 'structured_planning') as never);
  const gateway = new TimeMachineModelGateway(db, resolver as never);
  // 捕获budget预检原始消息（区分字符红线/窗口预留/成员预算）
  const origGenerate = gateway.generate.bind(gateway);
  gateway.generate = (async (request: { prompt: string; maxOutputTokens: number; windowTokens: number }) => {
    try {
      return await origGenerate(request as never);
    } catch (error) {
      if (error instanceof Error && error.message.includes('预算') || (error instanceof Error && error.message.includes('15000'))) {
        note(`budget预检消息："${(error as Error).message}"；promptChars=${request.prompt.length} bytes=${Buffer.byteLength(request.prompt, 'utf8')} maxOut=${request.maxOutputTokens} window=${request.windowTokens}`);
      }
      throw error;
    }
  }) as never;
  const service = new TimeMachineDesignService(db, gateway as never, 64000);
  // 冲突定位：steps.create冲突时打印既有行与新输入
  const innerSteps = (service as unknown as { steps: { create: (s: unknown, id: string, input: unknown, member: string) => void } }).steps;
  const origCreate = innerSteps.create.bind(innerSteps);
  innerSteps.create = ((s: unknown, id: string, input: unknown, member: string) => {
    try {
      return origCreate(s as never, id, input as never, member);
    } catch (error) {
      if (error instanceof Error && error.message.includes('接续不能改变')) {
        const row = db.prepare('SELECT input_hash, member, state FROM tm2_steps WHERE id=?').get(id) as { input_hash: string; member: string; state: string } | undefined;
        const inp = input as { prompt: string; member: { memberKey?: string }; window: number };
        note(`[冲突定位] step=${id} 既有hash=${row?.input_hash?.slice(0, 16)} state=${row?.state} member=${row?.member}→${member} 新prompt后120=${JSON.stringify(inp.prompt.slice(-120))}`);
      }
      throw error;
    }
  }) as never;
  try {
    await service.process(RUN_ID);
  } catch (error) {
    if (error instanceof ParentBudgetExhausted) {
      note(`父预算发送前停止：${error.message}；已完成部分保留，runId=${RUN_ID}`);
      const snap = guard.snapshot();
      note(`账本：实耗${snap.actual}+未知${snap.unknown}+预留${snap.reserved}/${snap.limitRequests}请求`);
      db.close(); evalDb.close();
      return;
    }
    const after = db.prepare('SELECT state, phase, error_code, error_message FROM tm2_design_runs WHERE id=?').get(RUN_ID) as Record<string, unknown>;
    note(`恢复中断（如实记录）：${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}；run=${JSON.stringify(after)}`);
    db.close(); evalDb.close();
    return;
  }
  const done = db.prepare('SELECT state, phase, error_code, result_json FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { state: string; phase: string; error_code: string | null; result_json: string | null };
  const result = done.result_json ? JSON.parse(done.result_json) as { revision?: number; review?: { pass?: boolean; issues?: string[]; suggestions?: string[] } } : null;
  note(`run终态：state=${done.state} phase=${done.phase} review.pass=${result?.review?.pass ?? '无'} issues=${(result?.review?.issues ?? []).length}条`);
  for (const issue of (result?.review?.issues ?? []).slice(0, 10)) note(`  审查issue：${issue.slice(0, 120)}`);

  // ④ 自然过审才HTTP采用（windowTokens=0启动：tick不触发，C保持原终态不被消耗）
  const emailRow = db.prepare('SELECT email_normalized FROM user_accounts WHERE owner_id=?').get(scope.ownerId) as { email_normalized: string } | undefined;
  const bookId = scope.bookId;
  const app = await createAppServer(config, db, { timeMachineWindowTokens: 0 });
  const headers = { host: '127.0.0.1:43111', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: emailRow?.email_normalized, password: 'Strong-test-pass-123!' } });
  if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const inj = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { ...headers, cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const getState = async () => (await inj('GET', `/api/time-machine/books/${bookId}/state`)).json().data as {
    runs: { id: string; kind: string; state: string; result: { revision: number; review: { pass: boolean } } | null }[];
    storylineMaterial?: { revision: number } | null;
  };

  if (done.state === 'succeeded' && result?.review?.pass === true && typeof result.revision === 'number') {
    note('采用前逐条核对：候选review.pass自然通过（未修改原模型结论）；审查候选k2.7可靠性未达标，采用仅验证工程链路');
    const adopt = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result.revision, expectedRevision: 0, idempotencyKey: 'fc-resume-adopt' });
    if (adopt.statusCode !== 200) {
      note(`HTTP采用失败${adopt.statusCode}：${adopt.body.slice(0, 200)}（如实记录不伪装）`);
    } else {
      state.adoptedCandidateId = RUN_ID;
      note(`HTTP采用成功：candidate=${RUN_ID} revision=${result.revision}`);
      // 幂等回放：同键再发不重复采用
      const replay = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, { candidateId: RUN_ID, revision: result.revision, expectedRevision: 0, idempotencyKey: 'fc-resume-adopt' });
      note(`采用同键回放=${replay.statusCode}（应200且不重复生效）`);
    }
  } else {
    note('未自然过审：不发生HTTP采用（合同允许此终局，不伪装成功）');
  }

  // ⑤ 资料修改失效/同键刷新恢复（不再生成新全书）
  const s2 = await getState();
  const mat = s2.storylineMaterial;
  if (mat) {
    const preview = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, { content: { note: '作者修改：加强粮草线权重' }, expectedRevision: mat.revision });
    note(`资料影响预览${preview.statusCode}：${preview.body.slice(0, 160)}`);
    const stale = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'fc-resume-stale', selection: { recommendationRunId: '4699f7ca-3d6f-4efe-98f8-f26aee96598f', recommendationHash: 'x', preparationVersion: 'x', selectedLineIds: ['x'], addedLines: [], shape: 'auto', ensemble: true, authorNote: '' }, expectedMaterialRevision: 999 });
    note(`过期版本999设计请求=${stale.statusCode}（应409且retryable=false）：${stale.body.slice(0, 160)}`);
    const runsBefore = s2.runs.length;
    const replay2 = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, { idempotencyKey: 'fc-e2e-round', selection: { note: '同键刷新' }, expectedMaterialRevision: mat.revision });
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

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/fast-close-resume.ts')) {
  main().catch(error => { console.error('恢复失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
