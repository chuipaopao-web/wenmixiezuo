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
import { FINAL_ADJUDICATION } from './final-adjudication.js';

const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const DRILL_DB = '.local/eval/drill-copy.sqlite';

interface ProbeRec { node: string; hash: string; chars: number; kind: 'structured' | 'dispatch'; markers?: { causal: boolean; fields: boolean; caveat: boolean } }

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

  const doubleSuffix = () => (db.prepare("SELECT id FROM tm2_steps WHERE id LIKE '%:revision-1:revision-1%' OR id LIKE '%:revision-2:revision-2%'").all() as { id: string }[]).map(r => r.id);

  // 拒绝发送的适配器：记录节点ID（经structured包装）与真实dispatch请求hash/长度，不加载任何密钥
  const records: ProbeRec[] = [];
  const refusingFactory = (provider: string, modelId: string) => ({
    provider, modelId,
    async generate(request: { requestId?: string; prompt: string }) {
      records.push({
        node: '(adapter-dispatch)', hash: createHash('sha256').update(request.prompt).digest('hex').slice(0, 16), chars: request.prompt.length, kind: 'dispatch',
        markers: { causal: request.prompt.includes('人手物资不足'), fields: ['"conflict"', '"turningPoint"', '"gain"', '"loss"'].every(f => request.prompt.includes(f)), caveat: request.prompt.includes('未展示字段不判缺陷') }
      });
      throw new ModelAdapterError('断路演练：适配器拒绝发送（仅记录不触网）', 'technical_failure', false, 500);
    }
  });
  const gateway = new TimeMachineModelGateway(db, refusingFactory as never);
  // 一次性受控增量注入（d8407c59）：可信装配显式预算策略并审计配置；原520000基线保持记录，本次为run/批一次性增量
  const service = new TimeMachineDesignService(db, gateway as never, 64000, { tokensLimit: 750_000, reason: 'd8407c59断路演练：s1-fast-close-review-evidence一次性受控增量（审计注入，非客户端传参）' });
  const inner = service as unknown as { structured: (r: unknown, s: unknown, snap: unknown, node: string, m: unknown, prompt: string, p: unknown) => Promise<unknown> };
  const origStructured = inner.structured.bind(service);
  inner.structured = ((r: unknown, s: unknown, snap: unknown, node: string, m: unknown, prompt: string, p: unknown) => {
    records.push({ node, hash: createHash('sha256').update(prompt).digest('hex').slice(0, 16), chars: prompt.length, kind: 'structured' });
    return origStructured(r as never, s as never, snap as never, node, m as never, prompt, p as never);
  }) as never;
  // dispatch归因：adapter拒绝前最后一个structured节点即触发节点
  const dispatchNodes = (recs: ProbeRec[]): { node: string; chars: number; markers?: ProbeRec['markers'] }[] => {
    const out: { node: string; chars: number; markers?: ProbeRec['markers'] }[] = [];
    let lastStructured = '(none)';
    for (const r of recs) {
      if (r.kind === 'structured') lastStructured = r.node;
      else out.push({ node: lastStructured, chars: r.chars, markers: r.markers });
    }
    return out;
  };

  const prep = new TimeMachineResumeService(db).prepare(scope, RUN_ID);
  console.log('prepare blocked:', JSON.stringify(prep.blocked), 'actions:', prep.actions.length);

  // 探针①：process()恢复——全部成功步骤缓存重放（structured链）；计划dispatch仅审查输入升级节点（review-source归档重算）
  const archivedBefore = new Set((db.prepare('SELECT id FROM tm2_step_archive').all() as { id: string }[]).map(r => r.id));
  records.length = 0;
  await service.process(RUN_ID).catch((e: unknown) => console.log('探针① 终止于:', (e as Error).message?.slice(0, 120)));
  const dispatchA = dispatchNodes(records);
  const structuredA = records.filter(r => r.kind === 'structured').map(r => r.node);
  console.log('探针① process()计划dispatch:', JSON.stringify(dispatchA));
  console.log('探针① structured回放链(前24):', JSON.stringify(structuredA.slice(0, 24)));
  console.log('探针① 回放链含双后缀节点:', structuredA.filter(n => n.includes(':revision-1:revision-1')).length);

  // 探针②：reviseAgain——revision3复审查封套预检：修订/自检全缓存重放；首个计划dispatch=review-source:0:revision-2，
  // 真实封套必须含因果字段与v6实际约束文本（"人手物资不足"），且长度低于输入红线
  records.length = 0;
  await service.reviseAgain(scope, RUN_ID, FINAL_ADJUDICATION).catch((e: unknown) => console.log('探针② 终止于:', (e as Error).message.slice(0, 80)));
  const dispatchB = dispatchNodes(records);
  const structuredB = records.filter(r => r.kind === 'structured').map(r => r.node);
  console.log('探针② reviseAgain structured链:', JSON.stringify(structuredB));
  console.log('探针② 计划dispatch:', JSON.stringify(dispatchB));
  console.log('探针② 首轮节点出现在structured链:', structuredB.filter(n => n.endsWith(':revision-1')).length);

  // 断言
  const failures: string[] = [];
  if (!structuredA.includes('skeleton') || !structuredA.includes('volume-card:0') || !structuredA.includes('self-check')) failures.push('探针①回放链缺骨架/卷卡/自检缓存重放');
  if (dispatchA.length !== 1 || dispatchA[0]?.node !== 'review-source:0') failures.push(`探针①计划dispatch应为review-source:0（审查输入升级后首个归档重算节点），实得${JSON.stringify(dispatchA)}`);
  if (!dispatchA[0]?.markers?.fields || !dispatchA[0]?.markers?.causal) failures.push('探针①复审查封套缺因果字段或v6约束文本');
  if (structuredA.some(n => n.includes(':revision-1:revision-1'))) failures.push('探针①回放链存在双后缀节点');
  if (!structuredB.includes('revise-volume:v3:revision-2') || !structuredB.includes('self-check:revision-2')) failures.push('探针②修订/自检缓存重放缺失');
  if (!structuredB.includes('review-source:finalize:revision-2')) failures.push('探针②finalize成功步骤缓存重放缺失（应零重发）');
  if (structuredB.some(n => n.endsWith(':revision-1'))) failures.push('探针②structured链含首轮节点（首轮步骤被重放消耗）');
  if (structuredB.some(n => n.includes(':revision-2:revision-2'))) failures.push('探针②存在双后缀节点');
  const frontier = /^review-anchors:\d+(:vol:v\d+)?:revision-2$|^review-source:finalize:revision-2$/u;
  if (dispatchB.length !== 1 || !frontier.test(dispatchB[0]?.node ?? '')) failures.push(`探针②计划dispatch应为当前未完成审查节点（finalize/锚点批次），实得${JSON.stringify(dispatchB)}`);
  if ((dispatchB[0]?.chars ?? 0) >= 15000) failures.push(`探针②审查封套${dispatchB[0]?.chars}字符超输入红线（分层降级后必须放得下）`);
  const newArchives = (db.prepare('SELECT id FROM tm2_step_archive').all() as { id: string }[]).filter(r => !archivedBefore.has(r.id));
  const badArchives = newArchives.filter(r => !r.id.includes('review-source'));
  if (badArchives.length) failures.push(`非审查节点被归档重算${badArchives.length}条（仅完整审查输入改变的节点允许归档重算）：${badArchives.map(r => r.id).join(',')}`);
  const ds = doubleSuffix();
  if (ds.length) failures.push(`副本内存在双后缀步骤${ds.length}条（历史孤儿应已清理或标注）`);

  console.log('——— 断路演练结论 ———');
  if (failures.length) { for (const f of failures) console.log('FAIL:', f); process.exit(1); }
  console.log(`通过：成功步骤全部缓存重放；计划dispatch仅审查输入升级节点（${dispatchA[0]?.node}）；revision3复审查封套${dispatchB[0]?.chars}字符含因果字段与v6约束文本；非审查节点0归档；无双后缀。`);
  db.close();
}
main().catch(e => { console.error('断路演练失败：', e instanceof Error ? e.message : e); process.exit(1); });
