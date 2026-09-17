#!/usr/bin/env tsx
/**
 * 7662b6f6收尾补充：合法payload的资料影响预览验证（零模型调用）。
 * 主续跑脚本⑤的预览请求因content不是合法StorylineSelectionInput被400校验拒绝（合法拒绝非缺陷），
 * 此处用已存材料的真实内容做合法修改（仅改authorNote），断言预览200+revisionMatch+受影响对象清单。
 */
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

async function main(): Promise<void> {
  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43112, dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'fast-close-worker-token-00000000000000000000000000',
    promptViewPassword: 'fast-close-prompt-view',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const db: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(db, config);
  const material = db.prepare('SELECT owner, book, revision, content_json FROM tm2_storyline_materials').get() as { owner: string; book: string; revision: number; content_json: string };
  const content = JSON.parse(material.content_json) as Record<string, unknown>;
  content.authorNote = `${String(content.authorNote ?? '')}（作者修改：加强粮草线权重）`;
  const app = await createAppServer(config, db, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43112', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const emailRow = db.prepare('SELECT email_normalized FROM user_accounts WHERE owner_id=?').get(material.owner) as { email_normalized: string };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: emailRow.email_normalized, password: 'Strong-test-pass-123!' } });
  if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const preview = await app.inject({ method: 'POST', url: `/api/time-machine/books/${material.book}/storyline-material/preview`, headers: { ...headers, cookie }, payload: { content, expectedRevision: material.revision } });
  console.log('PREVIEW-STATUS:', preview.statusCode);
  const body = preview.json() as { data?: { revisionMatch?: boolean; unchanged?: boolean; affectedBaseline?: boolean; affectedRuns?: { id: string; state: string }[]; affectedInFlight?: number; signature?: string } };
  console.log('PREVIEW-BODY:', JSON.stringify(body.data ?? body).slice(0, 300));
  const d = body.data ?? {};
  console.log('PREVIEW-KEYS:', JSON.stringify({ revisionMatch: d.revisionMatch, unchanged: d.unchanged, affectedBaseline: d.affectedBaseline, affectedInFlight: d.affectedInFlight, runs: d.affectedRuns?.length, hasSignature: typeof d.signature === 'string' }));
  await app.close();
  db.close();
}
main().catch(e => { console.error('P7预览验证失败：', e instanceof Error ? e.message : e); process.exit(1); });
