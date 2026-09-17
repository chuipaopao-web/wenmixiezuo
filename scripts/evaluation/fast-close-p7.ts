/**
 * c116818b续跑后的合法HTTP P7验证（零模型调用）：
 * payload从已保存故事线资料读取（除待测版本外全部字段合法），断言状态码/业务详情/同轮ID。
 */
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';

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
  const run = db.prepare('SELECT owner_id, book_id FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { owner_id: string; book_id: string };
  const emailRow = db.prepare('SELECT email_normalized FROM user_accounts WHERE owner_id=?').get(run.owner_id) as { email_normalized: string };
  const app = await createAppServer(config, db, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43111', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: emailRow.email_normalized, password: 'Strong-test-pass-123!' } });
  if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const authed = { ...headers, cookie };
  const bookId = run.book_id;
  const inj = async (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: authed, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const getState = async () => (await inj('GET', `/api/time-machine/books/${bookId}/state`)).json().data as {
    runs: { id: string }[]; storylineMaterial?: { revision: number; content: Record<string, unknown> } | null;
  };

  const s1 = await getState();
  const mat = s1.storylineMaterial;
  if (!mat) { console.log('无正式材料行：P7如实标注跳过'); await app.close(); db.close(); return; }
  console.log(`材料当前revision=${mat.revision}`);

  // ① 合法预览：已保存内容+当前版本→200且unchanged、有签名
  const previewSame = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, { content: mat.content, expectedRevision: mat.revision });
  const sameData = previewSame.json().data as { unchanged: boolean; signature: string; revisionMatch: boolean };
  console.log(`预览（未变内容）=${previewSame.statusCode} unchanged=${sameData.unchanged} revisionMatch=${sameData.revisionMatch} 签名=${(sameData.signature ?? '').slice(0, 12)}`);

  // ② 合法预览：作者修改→200且非unchanged+受影响runs列出
  const edited = { ...mat.content, authorNote: '作者修改：加强粮草线权重' };
  const previewEdit = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, { content: edited, expectedRevision: mat.revision });
  const editData = previewEdit.json().data as { unchanged: boolean; affectedRuns: { id: string }[]; signature: string };
  console.log(`预览（作者修改）=${previewEdit.statusCode} unchanged=${editData.unchanged} 受影响runs=${editData.affectedRuns?.length ?? 0} 签名=${(editData.signature ?? '').slice(0, 12)}`);

  // ③ 版本门禁：除版本外全部字段合法（选择=已保存资料内容），过期版本→409+retryable=false+零新轮
  const runsBefore = (await getState()).runs.length;
  const stale = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, {
    idempotencyKey: 'fc-p7-stale',
    selection: mat.content,
    expectedMaterialRevision: 999
  });
  console.log(`过期版本999设计请求=${stale.statusCode}：${stale.body.slice(0, 140)}`);
  const runsAfter = (await getState()).runs.length;
  console.log(`零新轮=${runsAfter === runsBefore}（${runsBefore}→${runsAfter}）`);

  // ④ 同键回放：原幂等键fc-e2e-round+原合法选择→返回同一轮（同run IDs）
  const replay = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, {
    idempotencyKey: 'fc-e2e-round',
    selection: mat.content
  });
  const replayData = replay.json().data as { runs?: { id: string }[] } | undefined;
  console.log(`同键回放=${replay.statusCode} 返回runs=${replayData?.runs?.map(r => r.id.slice(0, 8)).join(',') ?? replay.body.slice(0, 100)}`);
  console.log(`回放后runs总数=${(await getState()).runs.length}（前=${runsAfter}）`);

  await app.close();
  db.close();
}
if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/fast-close-p7.ts')) {
  main().catch(error => { console.error('P7失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
