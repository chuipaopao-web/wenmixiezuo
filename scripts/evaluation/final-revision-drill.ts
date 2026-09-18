#!/usr/bin/env tsx
/**
 * 915a3a79复核·断路演练（零真实调用、不加载密钥、不改原证据库）：
 * 用隔离库一致副本，适配器在任何新dispatch前仅记录稳定节点ID与完整请求hash/长度然后拒绝发送。
 * 核对：①process()恢复链上首轮成功步骤全部缓存命中（唯一计划dispatch=旧finalize）；
 * ②reviseAgain首个计划dispatch=第二轮节点（首轮步骤零重发）；
 * ③无双后缀步骤、无输入漂移归档（演练产生0条新归档）。
 */
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { TimeMachineDesignService } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineResumeService } from '../../apps/api/src/application/books/time-machine-resume-service.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { ModelAdapterError } from '../../apps/api/src/infrastructure/models/model-adapter.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const DRILL_DB = '.local/eval/drill-copy.sqlite';
const FINAL_ADJUDICATION = [{
  issue: 'A1核定硬矛盾：v3:exit称"甲内连坐漏洞已修补，追责规则可执行"，v4:entry却称"连坐漏洞仍留隐患"——同一漏洞同一时间两条件不可同真；按正式来源澄清为v3暂堵/暴露而v4危机中修复（或不同漏洞），成对核对交接，不与本卷转折相矛盾',
  sources: ['adjudication', 'self-check-anchors:revision-1#1', 'review-anchors:2#1']
}];

interface ProbeRec { node: string; hash: string; chars: number; kind: 'structured' | 'dispatch' }

async function main(): Promise<void> {
  // 一致副本（VACUUM INTO含WAL；原库只读不动；旧副本先清）
  if (existsSync(DRILL_DB)) rmSync(DRILL_DB);
  const src = openDatabase(resolve('.local/eval/fast-close-runtime/data/database/wenmi.sqlite'));
  src.prepare('VACUUM INTO ?').run(resolve(DRILL_DB));
  src.close();

  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43199, dataDir,
    databasePath: resolve(DRILL_DB),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'drill-token', promptViewPassword: 'drill',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const db: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(db, config);
  const run = db.prepare('SELECT owner_id, book_id, state FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { owner_id: string; book_id: string; state: string };
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const archiveCount = () => (db.prepare('SELECT COUNT(*) AS n FROM tm2_step_archive').get() as { n: number }).n;
  const doubleSuffix = () => (db.prepare("SELECT id FROM tm2_steps WHERE id LIKE '%:revision-1:revision-1%' OR id LIKE '%:revision-2:revision-2%'").all() as { id: string }[]).map(r => r.id);

  // 拒绝发送的适配器：记录节点ID（经structured包装）与真实dispatch请求hash/长度，不加载任何密钥
  const records: ProbeRec[] = [];
  const refusingFactory = (provider: string, modelId: string) => ({
    provider, modelId,
    async generate(request: { requestId?: string; prompt: string }) {
      records.push({ node: '(adapter-dispatch)', hash: createHash('sha256').update(request.prompt).digest('hex').slice(0, 16), chars: request.prompt.length, kind: 'dispatch' });
      throw new ModelAdapterError('断路演练：适配器拒绝发送（仅记录不触网）', 'technical_failure', false, 500);
    }
  });
  const gateway = new TimeMachineModelGateway(db, refusingFactory as never);
  const service = new TimeMachineDesignService(db, gateway as never, 64000);
  const inner = service as unknown as { structured: (r: unknown, s: unknown, snap: unknown, node: string, m: unknown, prompt: string, p: unknown) => Promise<unknown> };
  const origStructured = inner.structured.bind(service);
  inner.structured = ((r: unknown, s: unknown, snap: unknown, node: string, m: unknown, prompt: string, p: unknown) => {
    records.push({ node, hash: createHash('sha256').update(prompt).digest('hex').slice(0, 16), chars: prompt.length, kind: 'structured' });
    return origStructured(r as never, s as never, snap as never, node, m as never, prompt, p as never);
  }) as never;

  const prep = new TimeMachineResumeService(db).prepare(scope, RUN_ID);
  console.log('prepare blocked:', JSON.stringify(prep.blocked), 'actions:', prep.actions.length);

  // 探针①：process()恢复——首轮成功步骤应全部缓存命中，唯一计划dispatch=旧finalize
  const a0 = archiveCount();
  records.length = 0;
  await service.process(RUN_ID).catch(() => undefined);
  const dispatchA = records.filter(r => r.kind === 'dispatch');
  const structuredA = records.filter(r => r.kind === 'structured').map(r => r.node);
  console.log('探针① process()计划dispatch:', JSON.stringify(dispatchA.map(d => ({ hash: d.hash, chars: d.chars }))));
  console.log('探针① structured回放链(前24):', JSON.stringify(structuredA.slice(0, 24)));
  console.log('探针① 回放链含双后缀节点:', structuredA.filter(n => n.includes(':revision-1:revision-1')).length);

  // 探针②：reviseAgain——首个计划dispatch必须是第二轮节点（首轮步骤零重发）
  records.length = 0;
  await service.reviseAgain(scope, RUN_ID, FINAL_ADJUDICATION).catch((e: unknown) => console.log('探针② 终止于:', (e as Error).message.slice(0, 80)));
  const dispatchB = records.filter(r => r.kind === 'dispatch');
  const structuredB = records.filter(r => r.kind === 'structured').map(r => r.node);
  console.log('探针② reviseAgain structured链:', JSON.stringify(structuredB));
  console.log('探针② 计划dispatch数:', dispatchB.length, 'hash:', dispatchB[0]?.hash, 'chars:', dispatchB[0]?.chars);
  console.log('探针② 首轮节点出现在structured链:', structuredB.filter(n => n.includes(':revision-1') && !n.includes('finalize')).length);

  // 断言
  const failures: string[] = [];
  const expectedA = db.prepare("SELECT id FROM tm2_steps WHERE id=?").get(`${RUN_ID}:review-source:finalize:revision-1`);
  if (!expectedA) failures.push('探针①未到达finalize（首轮链未全部命中）');
  if (dispatchA.length !== 1) failures.push(`探针①计划dispatch应为1（旧finalize），实得${dispatchA.length}`);
  if (structuredA.some(n => n.includes(':revision-1:revision-1'))) failures.push('探针①回放链存在双后缀节点');
  const bFirst = structuredB.find(n => n.startsWith('revise-volume:'));
  if (bFirst !== 'revise-volume:v3:revision-2') failures.push(`探针②首个修订节点应为revise-volume:v3:revision-2，实得${bFirst ?? '无'}`);
  if (structuredB.some(n => n.endsWith(':revision-1') && !n.includes('finalize'))) failures.push('探针②structured链含首轮节点（首轮步骤被重放消耗）');
  if (structuredB.some(n => n.includes(':revision-2:revision-2'))) failures.push('探针②存在双后缀节点');
  if (archiveCount() !== a0) failures.push(`演练产生新归档${archiveCount() - a0}条（应0：无输入漂移）`);
  const ds = doubleSuffix();
  if (ds.length) failures.push(`副本内存在双后缀步骤${ds.length}条（历史孤儿应已清理或标注）`);

  console.log('——— 断路演练结论 ———');
  if (failures.length) { for (const f of failures) console.log('FAIL:', f); process.exit(1); }
  console.log('通过：首轮成功步骤全部缓存命中；唯一旧dispatch=finalize；reviseAgain首dispatch=第二轮节点；0新归档；无双后缀。');
  db.close();
}
main().catch(e => { console.error('断路演练失败：', e instanceof Error ? e.message : e); process.exit(1); });
