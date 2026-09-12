import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRebuildPlan, REBUILD_PLAN_PATH, summarizeTaskSignals } from '../../../apps/api/src/application/admin/rebuild-control-service.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext } from '../../helpers/test-context.js';
import type { V7TaskAuditRow } from '../../../apps/api/src/infrastructure/db/repositories/v7-task-audit-repository.js';

const source = readFileSync(REBUILD_PLAN_PATH, 'utf8');
const expectedCurrentBatch = '第122批：保留功能接入与分批发布';
const expectedCurrentWork = '接入团队开书所需成员目录，核对任务与用量依赖；发布后台功能地图及真实进度。新后端账号、权益与旧书兼容未完成，作者入口暂不切换。';
function withoutCurrentProgress(text: string): string {
  return text.replace(/^- \*\*当前(?:批次|工作)\*\*：.+\r?\n/gmu, '');
}
function withCurrentProgress(text: string): string {
  return withoutCurrentProgress(text).replace(/^## 3\.[^\n]*\r?\n/mu,
    (heading) => `${heading}- **当前批次**：${expectedCurrentBatch}\n- **当前工作**：${expectedCurrentWork}\n`);
}
describe('重构管理后台文档与运行证据', () => {
  it('完整展示82个重构单元与85来源功能，顺序和说明来自同一文档', () => {
    const plan = parseRebuildPlan(source);
    expect(plan.units).toHaveLength(82);
    expect(plan.units.find(unit => unit.id === 'RB-51.1')?.name).toBe('节奏资产、分层短卡与输入预览');
    expect(plan.sourceFeatures).toHaveLength(85);
    expect(plan.version).toBeTruthy();
    expect(plan.units[0]?.id).toBe('RB-00.1');
    expect(plan.units.slice(1, 5).map((unit) => unit.id)).toEqual(['RB-00.2', 'RB-00', 'RB-01', 'RB-02']);
    for (let index = 0; index <= 61; index++) {
      expect(plan.units.some((unit) => unit.id === `RB-${String(index).padStart(2, '0')}`)).toBe(true);
    }
    const signup = plan.units.find((unit) => unit.id === 'RB-01')!;
    expect(signup.frontend).toBe('未开始');
    expect(signup.acceptance).toBe('未验证');
    expect(signup.details.find((item) => item.label === '重点验收')?.text).toContain('重复邮箱并发');
    expect(plan.units.find((unit) => unit.id === 'RB-00.1')?.sourceFeatures.some((item) => item.id === 'F-1206')).toBe(true);
    // Never mistake the same coverage feature mentioned in multiple units for new features.
    expect(new Set(plan.sourceFeatures.map((feature) => feature.id)).size).toBe(85);
    const adminFramework = plan.sourceFeatures.find((feature) => feature.id === 'F-1205')!;
    expect(adminFramework.unitIds).toEqual(expect.arrayContaining(['RB-12', 'RB-42', 'RB-43', 'RB-47.1', 'RB-54', 'RB-55']));
    expect(plan.units.find((item) => item.id === 'RB-43')?.sourceFeatures.some((item) => item.id === 'F-1205')).toBe(true);
  });

  it('当前批次和当前工作只读取第3节明确登记，缺字段不推导', () => {
    const plan = parseRebuildPlan(withCurrentProgress(source));
    expect(plan.currentBatch).toBe(expectedCurrentBatch);
    expect(plan.currentWork).toBe(expectedCurrentWork);
    const oldPlan = parseRebuildPlan(withoutCurrentProgress(source));
    expect(oldPlan.currentBatch).toBeUndefined();
    expect(oldPlan.currentWork).toBeUndefined();
  });

  it.each([
    ['丢失卡片', (text: string) => text.replace('### RB-01 注册页', '### 注册页已误删编号')],
    ['未知进度', (text: string) => text.replace('| 待讨论 | 未开始 | 未开始 | 未验证 |', '| 待讨论 | 完美完成 | 未开始 | 未验证 |')],
    ['无效依赖', (text: string) => text.replace('| 注册页 | RB-00 |', '| 注册页 | RB-61 |')],
    ['未开发却验收通过', (text: string) => text.replace('| 待讨论 | 未开始 | 未开始 | 未验证 |', '| 待讨论 | 未开始 | 未开始 | 通过 |')],
    ['重复当前批次', (text: string) => withCurrentProgress(text).replace(`- **当前工作**：${expectedCurrentWork}`, '- **当前批次**：第122批：重复登记')],
    ['丢失来源章节', (text: string) => text.replace('## 11. 85项来源功能覆盖与处理', '## 功能覆盖')],
    ['重复单元', (text: string) => text.replace('## 6. 每个单元具体讨论什么、开发什么、怎样验收', `${text.match(/^\| \[RB-01\].+$/mu)![0]}\n\n## 6. 每个单元具体讨论什么、开发什么、怎样验收`)]
  ])('%s 时明确拒绝，不能退化成空的正常地图', (_label, corrupt) => {
    expect(() => parseRebuildPlan(corrupt(source))).toThrow('开发顺序表暂时无法核对');
  });

  it('后来的成功不抹除失败，未知结果不计入成功', () => {
    const rows = ['failed', 'succeeded', 'unknown'].map((status, index) => ({
      taskType: 'creation_workflow', status, occurredAt: `2026-09-05T01:0${index}:00.000Z`
    } as V7TaskAuditRow));
    expect(summarizeTaskSignals(rows)).toEqual([{ taskKind: 'creation_workflow', observed: 3, succeeded: 1, failed: 1, other: 1, latestAt: '2026-09-05T01:02:00.000Z' }]);
  });

  it('沿用服务端管理员门禁；空任务/无心跳保持未知，文档缺失返回503且不暴露路径', async () => {
    const context = createTestContext('wenmi-rebuild-control-');
    const app = await createV7Server(context.config, context.database);
    const headers = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };
    const url = '/api/v1/admin/rebuild-control';
    try {
      expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(401);
      const cookies: string[] = [];
      for (const [email, displayName] of [['admin-control@example.com', '管理员'], ['author-control@example.com', '作者']]) {
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers,
          payload: { email, displayName, password: 'fixture-pass-12345' } });
        expect(response.statusCode).toBe(200);
        cookies.push(String(response.headers['set-cookie']).split(';')[0]!);
      }
      expect((await app.inject({ method: 'GET', url, headers: { ...headers, cookie: cookies[1]! } })).statusCode).toBe(403);
      const response = await app.inject({ method: 'GET', url, headers: { ...headers, cookie: cookies[0]! } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const data = response.json().data;
      expect(data.units).toHaveLength(82);
      expect(data.source).toHaveProperty('version');
      expect(data.runtime).toMatchObject({ taskCount: 0, sampledCount: 0, worker: 'stale_or_missing', taskSignals: [] });
      expect(JSON.stringify(data)).not.toMatch(/fixture-pass|owner-local-boss|session_token/u);
      const now=new Date().toISOString();
      context.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run('test-owner','合成任务作者',now,now);
      new BookRepository(context.database).create({ownerId:'test-owner',bookId:'test-book'},'合成任务书',now,'active');
      context.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES('test-tm','test-owner','test-book','recommend','test-key','test-hash','{}','failed',?,?)").run(now,now);
      const withNewTasks=(await app.inject({method:'GET',url,headers:{...headers,cookie:cookies[0]!}})).json().data;
      expect(withNewTasks.runtime).toMatchObject({taskCount:1,sampledCount:1,taskSignals:[{taskKind:'tm2_recommend',observed:1,failed:1,succeeded:0,other:0}]});
      expect(withNewTasks.units.find((unit:{id:string})=>unit.id==='RB-22').taskKinds).toContain('tm2_recommend');
      context.config.projectRoot = context.root;
      const missing = await app.inject({ method: 'GET', url, headers: { ...headers, cookie: cookies[0]! } });
      expect(missing.statusCode).toBe(503);
      expect(missing.body).not.toContain(context.root);
    } finally { await app.close(); context.close(); }
  });
});
