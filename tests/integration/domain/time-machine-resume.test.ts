import { afterEach, describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { TimeMachineDesignService } from '../../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineResumeService } from '../../../apps/api/src/application/books/time-machine-resume-service.js';
import { StepArchiveRepository } from '../../../apps/api/src/infrastructure/db/repositories/step-archive-repository.js';
import { TimeMachineModelGateway } from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { snapshotTimeMachine } from '../../../apps/api/src/application/books/time-machine-sources.js';
import type { StorylineSelectionInput } from '../../../apps/api/src/application/books/storyline-selection.js';

// 625cc3f7集中复核①离线证明：合法恢复——同版本成功审查零重发，仅确实失败/变化步骤重建；
// 活动租约阻塞；完整归档非删除。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

function buildSelection(service: TimeMachineDesignService, scope: { ownerId: string; bookId: string }): StorylineSelectionInput {
  const rec = service.state(scope).filter(r => r.kind === 'recommend' && r.state === 'succeeded').sort((a, b) => String(a.updatedAt ?? '') < String(b.updatedAt ?? '') ? 1 : -1)[0];
  if (!rec) throw Error('测试前置失败：缺少成功推荐');
  const lines = (rec.result as unknown as { lines: { id: string }[] }).lines;
  return { recommendationRunId: String(rec.id), recommendationHash: String(rec.recommendationHash), preparationVersion: 'test-pv', selectedLineIds: [String(lines[0]!.id)], addedLines: [], shape: 'auto', ensemble: false, authorNote: '成长线' };
}
function seedRecommendIfMissing(service: TimeMachineDesignService, scope: { ownerId: string; bookId: string }): void {
  if (service.state(scope).some(r => r.kind === 'recommend' && r.state === 'succeeded')) return;
  const db = (service as unknown as { db: import('node:sqlite').DatabaseSync }).db;
  const manifest = snapshotTimeMachine(db, scope, '', 64000).manifest;
  const result = { greeting: '老板，推荐如下', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '建立工坊', recommended: true }], structure: 'single', reason: '聚焦成长' };
  const now = new Date().toISOString();
  db.prepare('INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,result_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(`seed-rec-${randomUUID().slice(0, 8)}`, scope.ownerId, scope.bookId, 'recommend', `seed:${now}`, randomUUID(), JSON.stringify({ manifest, members: {}, writers: [], intent: '', windowTokens: 64000 }), JSON.stringify(result), 'succeeded', now, now);
}
function round(service: TimeMachineDesignService, scope: { ownerId: string; bookId: string }, key: string) {
  seedRecommendIfMissing(service, scope);
  (service as unknown as { _prerequisiteReader?: (s: { ownerId: string; bookId: string }) => { ready: boolean; message: string; version: string | null } })._prerequisiteReader = () => ({ ready: true, message: '已确认', version: 'test-pv' });
  return service.startDesignRound(scope, buildSelection(service, scope), key);
}
function setup() {
  const c = createTestContext(); contexts.push(c);
  const scope = { ownerId: c.config.ownerId, bookId: 'resume-book' };
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId, '测试作者', '2026-09-11', '2026-09-11');
  new BookRepository(c.database).create(scope, '恢复测试书', '2026-09-11', 'active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-11')").run(scope.ownerId, scope.bookId, JSON.stringify({ protagonists: ['林舟'], storyDirection: '无灵根修理工建立工坊' }), 'a'.repeat(64));
  return { c, scope };
}
function output(prompt: string, modelId: string): unknown {
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return prompt.includes('上次工具结果（仅资料）：null') ? { action: 'search_methods', category: '', cursor: 0 } : { action: 'ready', selected: [] };
  if (prompt.includes('设计全书骨架。只设计')) return { structure: '四幕起承转合', baseline: `轻快成长-${modelId}`, ending: '建立工坊', openingHooks: ['开头钩子', '第一章钩子', '前三章钩子'], words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines: [{ id: 'main', role: 'main', title: '工坊', goal: '立足', answer: '建立工坊', process: '从修理接单到建立工坊', parentIds: [], covers: ['成长线'], milestones: [] }], expectations: [{ id: 'promise', opening: '无灵根能否立足', change: '看到变化', answer: '以机甲立足', lineIds: ['main'] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '建立工坊', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
  if (prompt.includes('补全本卷卷卡') || prompt.includes('补全本批卷卡')) { const id = 'v1'; return { volumes: [{ id, title: `开张-${modelId}`, start: '濒临倒闭', goal: '完成订单', conflict: '封锁', beat: '起', turningPoint: '机甲完成', gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null, ending: '工坊建立', handoff: '', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, anchors: [{ id: 'in', ownerEntityId: id, kind: 'entry', summary: '店铺濒临倒闭', span: '本卷开篇', conditions: [{ summary: '订单危机已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场', keywords: [], aliases: [] }, { id: 'out', ownerEntityId: id, kind: 'exit', summary: '订单交付工坊立足', span: '本卷收束', conditions: [{ summary: '订单交付完成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补收束', keywords: [], aliases: [] }], duties: [{ lineId: 'main', action: 'close', result: '工坊建立', anchorIds: ['out'], strength: 'required', reason: '主线起点' }] }] }; }
  if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [] };
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}
const fakeAdapter = (calls: { prompt: string }[], failAnchors: { remaining: number }) => (provider: string, modelId: string) => ({
  provider, modelId,
  async generate(request: { prompt: string }) {
    calls.push({ prompt: request.prompt });
    if (failAnchors.remaining > 0 && request.prompt.includes('核对候选锚点')) { failAnchors.remaining--; throw new ModelAdapterError('供应商暂时不可用', 'technical_failure', true, 500); }
    return { provider, modelId, output: JSON.stringify(output(request.prompt, modelId)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
  }
});

describe('Codex恢复反例：已补查来源后恢复', () => {
  it('复用缓存的read_source不得重复插入轨迹，锚点失败后仍能恢复成功', async () => {
    const { c, scope } = setup();
    const calls: string[] = [];
    let readIssued = false;
    let anchorFailures = 2;
    const resolver = (provider: string, modelId: string) => ({
      provider, modelId,
      async generate(request: { prompt: string }) {
        calls.push(request.prompt);
        if (request.prompt.includes('核对候选锚点') && anchorFailures-- > 0)
          throw new ModelAdapterError('临时失败', 'technical_failure', true, 500);
        let value = output(request.prompt, modelId);
        if (request.prompt.includes('核对候选骨架') && !readIssued) {
          readIssued = true;
          value = { action: 'read_source', key: 'opening:opening:1', offset: 0 };
        }
        return { provider, modelId, output: JSON.stringify(value), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
      }
    });
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, resolver), 64000);
    const runId = round(service, scope, 'codex-read-resume')[0]!.id;
    await service.process(runId);
    expect(service.state(scope).find(r => r.id === runId)?.state).toBe('failed');
    expect((c.database.prepare('SELECT COUNT(*) AS n FROM tm2_review_reads WHERE run_id=?').get(runId) as { n: number }).n).toBe(1);
    expect(new TimeMachineResumeService(c.database).prepare(scope, runId).blocked).toHaveLength(0);
    calls.length = 0;
    await service.process(runId);
    const final = c.database.prepare('SELECT state,error_message FROM tm2_design_runs WHERE id=?').get(runId) as { state: string; error_message: string | null };
    expect({ state: final.state, error: final.error_message }).toEqual({ state: 'succeeded', error: null });
    expect(calls.filter(p => p.includes('核对候选骨架'))).toHaveLength(0);
    expect(calls.filter(p => p.includes('核对候选锚点'))).toHaveLength(1);
  });
});

describe('合法恢复（集中复核①）', () => {
  it('审查已过、锚点批次失败→重启仅该批次一次dispatch，成功审查零重发、无归档', async () => {
    const { c, scope } = setup();
    const calls: { prompt: string }[] = [];
    const failAnchors = { remaining: 2 }; // temporary错误会被自动重试一次：连续两次失败才终态
    const gateway = new TimeMachineModelGateway(c.database, fakeAdapter(calls, failAnchors));
    const service = new TimeMachineDesignService(c.database, gateway, 64000);
    const created = await round(service, scope, 'resume-r1');
    await service.process(created[0]!.id);
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.state).toBe('failed');
    const reviewCallsBefore = calls.filter(x => x.prompt.includes('核对候选骨架')).length;
    expect(reviewCallsBefore).toBeGreaterThanOrEqual(1); // 首跑审查已过（pass）

    // 合法恢复：服务化prepare（非猴子补丁）→ 恢复执行
    const resume = new TimeMachineResumeService(c.database);
    const prep = resume.prepare(scope, created[0]!.id);
    expect(prep.blocked).toHaveLength(0);
    calls.length = 0;
    await service.process(created[0]!.id);

    const reviewSourceDispatches = calls.filter(x => x.prompt.includes('核对候选骨架')).length;
    const anchorDispatches = calls.filter(x => x.prompt.includes('核对候选锚点')).length;
    expect(reviewSourceDispatches).toBe(0); // 同版本成功审查零重发（claim命中saved）
    expect(anchorDispatches).toBe(1); // 仅失败批次一次dispatch
    const archives = new StepArchiveRepository(c.database).archivedVersions(scope, `${created[0]!.id}:review-anchors:0`);
    expect(archives).toHaveLength(0); // 输入未变：无重建无归档
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.state).toBe('succeeded');
  });

  it('变化输入不能命中旧缓存：冲突步骤完整归档后重建，归档含全部行/attempt/输出', async () => {
    const { c, scope } = setup();
    const archive = new StepArchiveRepository(c.database);
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, fakeAdapter([], { remaining: 0 })), 64000);
    const created = await round(service, scope, 'resume-r2'); // 先建run（tm2_books/manifest就绪）
    const stepId = `${created[0]!.id}:review-source:0`;
    const inputA = { prompt: '原始输入甲', member: { k: 1 }, window: 64000 };
    const versioned = (service as unknown as { createStepVersioned: (s: typeof scope, id: string, input: unknown, memberKey: string, reason: string) => void }).createStepVersioned.bind(service);
    versioned(scope, stepId, inputA, 'member-a', '测试归档');
    versioned(scope, stepId, inputA, 'member-a', '测试归档'); // 同输入幂等复用：不归档
    expect(archive.archivedVersions(scope, stepId)).toHaveLength(0);
    versioned(scope, stepId, { ...inputA, prompt: '已变化输入乙' }, 'member-a', '输入版本变化'); // 冲突→归档+重建
    const versions = archive.archivedVersions(scope, stepId);
    expect(versions).toHaveLength(1);
    const row = JSON.parse(versions[0]!.row_json) as { input_hash: string; state: string };
    expect(row.input_hash).toBeTruthy();
    expect(versions[0]!.attempts_json).toBeTruthy();
    expect(versions[0]!.reason).toContain('输入版本变化');
    const fresh = c.database.prepare('SELECT input_hash FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId, scope.bookId, stepId) as { input_hash: string };
    expect(fresh.input_hash).not.toBe(row.input_hash); // 新版本输入hash不同=变化输入不命中旧缓存
  });

  it('活动租约/活写者阻塞：running租约未过期不动；已成功run直接返回', () => {
    const { c, scope } = setup();
    const resume = new TimeMachineResumeService(c.database);
    const now = new Date().toISOString();
    c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES('run-live',?,?,'design','k','h','{}','working',?,?)").run(scope.ownerId, scope.bookId, now, now);
    c.database.prepare("INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,'{}')").run(scope.ownerId, scope.bookId);    c.database.prepare("INSERT INTO tm2_steps(owner,book,id,input_hash,member,state,lease_until) VALUES(?,?,'run-live:review-anchors:0','h','m','running',?)").run(scope.ownerId, scope.bookId, Date.now() + 600_000);
    const prep = resume.prepare(scope, 'run-live');
    expect(prep.blocked.length).toBe(1);
    expect(prep.blocked[0]).toContain('活动租约未过期');
    expect(prep.actions).toHaveLength(0);
    const step = c.database.prepare("SELECT state, lease_until FROM tm2_steps WHERE id='run-live:review-anchors:0'").get() as { state: string; lease_until: number };
    expect(step.state).toBe('running'); // 未被重置
    c.database.prepare("UPDATE tm2_design_runs SET state='succeeded' WHERE id='run-live'").run();
    expect(resume.prepare(scope, 'run-live').actions[0]).toContain('无需恢复');
  });
});

describe('审查证据链（集中复核③）', () => {
  function readSourceAdapter(calls: { prompt: string }[], reads: { current: number }) {
    let readIdx = 0;
    return (provider: string, modelId: string) => ({
      provider, modelId,
      async generate(request: { prompt: string }) {
        calls.push({ prompt: request.prompt });
        if (request.prompt.includes('核对候选骨架') && reads.current > 0) {
          reads.current--;
          return { provider, modelId, output: JSON.stringify({ action: 'read_source', key: 'opening:opening:1', offset: (readIdx++) * 200 }), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
        }
        return { provider, modelId, output: JSON.stringify(output(request.prompt, modelId)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
      }
    });
  }

  it('回查轨迹持久化：key/revision/offset/length/hash逐项落库可对照', async () => {
    const { c, scope } = setup();
    const calls: { prompt: string }[] = [];
    const reads = { current: 1 };
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, readSourceAdapter(calls, reads)), 64000);
    const created = await round(service, scope, 'evidence-r1');
    await service.process(created[0]!.id);
    const rows = c.database.prepare('SELECT * FROM tm2_review_reads WHERE run_id=? ORDER BY seq').all(created[0]!.id) as { source_key: string; source_revision: string; offset: number; length: number; content_hash: string; seq: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.source_key).toBe('opening:opening:1');
    expect(rows[0]!.source_revision).toBe('1');
    expect(rows[0]!.offset).toBe(0);
    expect(rows[0]!.length).toBeGreaterThan(0);
    expect(rows[0]!.content_hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('锚点审查输入含最新片段与全部回查证据（不漏传latest）', async () => {
    const { c, scope } = setup();
    const calls: { prompt: string }[] = [];
    const reads = { current: 1 };
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, readSourceAdapter(calls, reads)), 64000);
    const created = await round(service, scope, 'evidence-r2');
    await service.process(created[0]!.id);
    const anchorsPrompt = calls.filter(x => x.prompt.includes('核对候选锚点'))[0]?.prompt ?? '';
    expect(anchorsPrompt).toBeTruthy();
    // 最新片段（latest）必须出现在锚点审查输入的"已回查原件"中
    const anchorsSection = anchorsPrompt.split('已回查原件：')[1]?.split('\n本批：')[0] ?? '';
    expect(anchorsSection.length).toBeGreaterThan(2); // 非空数组
    const readsInPrompt = JSON.parse(anchorsSection) as { key: string; text: string }[];
    expect(readsInPrompt.some(r => r.key === 'opening:opening:1' && r.text.length > 0)).toBe(true);
  });

  it('多轮补查后存根保留offset/length/hash坐标（证据可回查）', async () => {
    const { c, scope } = setup();
    const calls: { prompt: string }[] = [];
    const reads = { current: 3 };
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, readSourceAdapter(calls, reads)), 64000);
    const created = await round(service, scope, 'evidence-r3');
    await service.process(created[0]!.id);
    const reviewPrompts = calls.filter(x => x.prompt.includes('核对候选骨架')).map(x => x.prompt);
    const last = reviewPrompts[reviewPrompts.length - 1]!;
    // 有界后更早片段转存根，存根带offset/length/hash
    const stubs = [...last.matchAll(/（已回查存根：offset=\d+ 长度\d+ hash=[0-9a-f]{12}/gu)];
    expect(stubs.length).toBeGreaterThanOrEqual(1);
    // 轨迹全部持久化（即使提示中已转存根）
    const rows = c.database.prepare('SELECT COUNT(*) AS n FROM tm2_review_reads WHERE run_id=?').get(created[0]!.id) as { n: number };
    expect(rows.n).toBe(3);
  });
});

describe('锚点截断单卷降级（067bbc24收尾决定）', () => {
  const volumeOf = (id: string, isLast = false, revised = false): Record<string, unknown> => ({
    id, title: `卷${id}`, start: '开局成立', goal: '本卷目标', conflict: '封锁', beat: '起',
    turningPoint: revised ? '修订后转折事件' : '关键转折事件', gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null,
    ending: '本卷收束达成', handoff: isLast ? '' : '引出下卷', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' },
    anchors: [
      { id: 'in', ownerEntityId: id, kind: 'entry', summary: '开场状态成立', span: '本卷开篇', conditions: [{ summary: '开局已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场', keywords: [], aliases: [] },
      { id: 'out', ownerEntityId: id, kind: 'exit', summary: '收束条件达成', span: '本卷收束', conditions: [{ summary: '本卷目标已经达成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补收束', keywords: [], aliases: [] }
    ],
    duties: [{ lineId: 'main', action: 'advance', result: '主线推进', anchorIds: ['out'], strength: 'required', reason: '主线本卷必须推进' }]
  });
  const threeVolumeOutput = (prompt: string, modelId: string, anchorsMode: 'truncate-batch' | 'fail-child2' | 'child2-issues'): unknown => {
    if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
    if (prompt.includes('判断需要哪些方法')) return prompt.includes('上次工具结果（仅资料）：null') ? { action: 'search_methods', category: '', cursor: 0 } : { action: 'ready', selected: [] };
    if (prompt.includes('设计全书骨架。只设计')) return { structure: '三幕', baseline: `轻快-${modelId}`, ending: '建立工坊', openingHooks: ['钩1', '钩2', '钩3'], words: { target: 300000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines: [{ id: 'main', role: 'main', title: '工坊', goal: '立足', answer: '建立工坊', process: '从修理到建立工坊', parentIds: [], covers: ['成长线'], milestones: [] }], expectations: [{ id: 'promise', opening: '能否立足', change: '看到变化', answer: '以机甲立足', lineIds: ['main'] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '立足', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }, { id: 'v2', title: '扩张', goal: '扩张', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }, { id: 'v3', title: '兑现', goal: '兑现', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
    if (prompt.includes('修订本卷卷卡')) {
      const id = prompt.match(/"id"\s*:\s*"(v\d)"/u)?.[1] ?? 'v2';
      return { volumes: [volumeOf(id, id === 'v3', true)] }; // 第二参是isLast：修订卷保持原交接形态（v2非终卷必须有handoff）
    }
    if (prompt.includes('补全本卷卷卡') || prompt.includes('补全本批卷卡')) {
      const briefMatch = prompt.match(/"id"\s*:\s*"(v\d)"/u);
      const id = briefMatch?.[1] ?? 'v1';
      return { volumes: [volumeOf(id, id === 'v3')] };
    }
    if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
    if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
    if (prompt.includes('核对候选锚点')) {
      // child2-issues同样先让父批[v1,v2]截断走单卷降级——父批提示里也含“本卷”（锚点span“本卷开篇”），
      // 若父批直接命中问题分支，问题不会经reviewByVolumes加卷名前缀，与子卷路径证据形态不一致。
      if ((anchorsMode === 'truncate-batch' || anchorsMode === 'child2-issues') && prompt.includes('本批') && prompt.includes('"id":"v2"')) return '__TRUNCATE__';
      if (anchorsMode === 'fail-child2' && prompt.includes('本卷') && prompt.includes('"id":"v2"')) return '__FAIL2__';
      if (anchorsMode === 'fail-child2' && prompt.includes('本卷') && prompt.includes('"id": "v2"')) return '__FAIL2__';
      // 只匹配单卷子提示："id":"v2"带引号排除相邻交接里的卷名“卷v2”（v1子提示相邻next.title含v2字样）
      if (anchorsMode === 'child2-issues' && prompt.includes('本卷') && prompt.includes('"id":"v2"')) return { pass: false, issues: ['卷2锚点条件空泛循环'], suggestions: [], hasMoreIssues: false };
      return { pass: true, issues: [], suggestions: [], hasMoreIssues: false };
    }
    return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
  };
  const splitAdapter = (calls: string[], mode: 'truncate-batch' | 'fail-child2' | 'child2-issues') => (provider: string, modelId: string) => ({
    provider, modelId,
    async generate(request: { prompt: string }) {
      calls.push(request.prompt);
      const value = threeVolumeOutput(request.prompt, modelId, mode);
      if (value === '__TRUNCATE__' && request.prompt.includes('"id":"v2"')) throw new ModelAdapterError('输出长度超限', 'technical_failure', false, 200, false, undefined, 'output_length_limit');
      if (value === '__FAIL2__') throw new ModelAdapterError('供应商暂时不可用', 'technical_failure', true, 500);
      return { provider, modelId, output: JSON.stringify(value), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
    }
  });

  it('父批截断→只发两个子请求；父批truncated证据保留并标记覆盖；结论合取通过', async () => {
    const { c, scope } = setup();
    const calls: string[] = [];
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, splitAdapter(calls, 'truncate-batch')), 64000);
    const created = await round(service, scope, 'split-r1');
    await service.process(created[0]!.id);
    const childCalls = calls.filter(p => p.includes('核对候选锚点') && p.includes('本卷：'));
    const parentBatchCallsV1V2 = calls.filter(p => p.includes('核对候选锚点') && p.includes('本批：') && p.includes('"id":"v2"'));
    expect(parentBatchCallsV1V2.length).toBe(1); // 第一批[v1,v2]截断后不再发父批（第二批[v3]正常批量不在此断言）
    expect(childCalls.length).toBe(2); // 恰好两个子请求
    const parent = c.database.prepare("SELECT error_code FROM tm2_steps WHERE id=?").get(`${created[0]!.id}:review-anchors:0`) as { error_code: string };
    expect(parent.error_code).toBe('truncated-split-covered'); // truncated证据保留并标记覆盖
    const child1 = c.database.prepare("SELECT state FROM tm2_steps WHERE id=?").get(`${created[0]!.id}:review-anchors:0:vol:v1`) as { state: string } | undefined;
    const child2 = c.database.prepare("SELECT state FROM tm2_steps WHERE id=?").get(`${created[0]!.id}:review-anchors:0:vol:v2`) as { state: string } | undefined;
    expect(child1?.state).toBe('succeeded');
    expect(child2?.state).toBe('succeeded');
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.state).toBe('succeeded');
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.result?.review.pass).toBe(true);
  });

  it('子1成功子2失败→重启只发子2；骨架/卷卡/来源审查/子1零重发', async () => {
    const { c, scope } = setup();
    const calls: string[] = [];
    const failState = { truncatedBatch: 1, failChild2: 2 };
    const adapter = (provider: string, modelId: string) => ({
      provider, modelId,
      async generate(request: { prompt: string }) {
        calls.push(request.prompt);
        // 父批先截断一次触发降级；随后子2连续失败两次（temporary重试一次后终态）
        if (failState.truncatedBatch > 0 && request.prompt.includes('核对候选锚点') && request.prompt.includes('本批：')) {
          failState.truncatedBatch--;
          throw new ModelAdapterError('输出长度超限', 'technical_failure', false, 200, false, undefined, 'output_length_limit');
        }
        if (failState.failChild2 > 0 && request.prompt.includes('核对候选锚点') && request.prompt.includes('本卷') && request.prompt.includes('"id":"v2"')) {
          failState.failChild2--;
          throw new ModelAdapterError('供应商暂时不可用', 'technical_failure', true, 500);
        }
        return { provider, modelId, output: JSON.stringify(threeVolumeOutput(request.prompt, modelId, 'truncate-batch')), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
      }
    });
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, adapter), 64000);
    const created = await round(service, scope, 'split-r2');
    await service.process(created[0]!.id);
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.state).toBe('failed');
    expect(c.database.prepare("SELECT state FROM tm2_steps WHERE id=?").get(`${created[0]!.id}:review-anchors:0:vol:v1`) as { state: string }).toBeDefined();
    const prep = new TimeMachineResumeService(c.database).prepare(scope, created[0]!.id);
    expect(prep.blocked).toHaveLength(0);
    calls.length = 0;
    await service.process(created[0]!.id);
    const child1Calls = calls.filter(p => p.includes('"id":"v1"') && p.includes('核对候选锚点')).length;
    const child2Calls = calls.filter(p => p.includes('v2') && p.includes('核对候选锚点')).length;
    expect(child1Calls).toBe(0); // 子1已成功零重发
    expect(child2Calls).toBe(1); // 只发子2
    expect(calls.filter(p => p.includes('核对候选骨架')).length).toBe(0); // 来源审查零重发
    expect(calls.filter(p => p.includes('设计全书骨架')).length).toBe(0); // 骨架零重发
    expect(calls.filter(p => p.includes('补全本')).length).toBe(0); // 卷卡零重发
  });

  it('子卷有阻塞问题→不得放行：合取为false且问题带卷名前缀，首轮修订证据在案', async () => {
    const { c, scope } = setup();
    const calls: string[] = [];
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, splitAdapter(calls, 'child2-issues')), 64000);
    const created = await round(service, scope, 'split-r3');
    await service.process(created[0]!.id);
    // 首轮审查verdict记录revise（合取false不冒充通过），修订后复查放行的新版本不掩盖首轮证据
    const verdicts = c.database.prepare('SELECT verdict, revision FROM tm2_reviews WHERE owner=? AND book=? AND candidate=? ORDER BY rowid').all(scope.ownerId, scope.bookId, created[0]!.id) as { verdict: string; revision: number }[];
    expect(verdicts[0]?.verdict).toBe('revise');
    // 阻塞问题带卷名前缀进入修订输入（修订请求证据可查）
    const revisePrompt = calls.find(p => p.includes('修订本卷卷卡')) ?? '';
    expect(revisePrompt).toContain('卷2锚点条件空泛循环'); // 问题原文进入修订输入
    expect(revisePrompt).toMatch(/卷2（[^）]+）：卷2锚点条件空泛循环/u); // 带卷名前缀可定位
    expect(revisePrompt).toContain('本卷问题与依据');
  });

  it('自检引用内部卷ID（v2样式）→确定性定位该卷局部修订，来源标记self-check', async () => {
    const { c, scope } = setup();
    const calls: string[] = [];
    let selfChecked = false;
    // 真实自检输出会引用内部ID（自检提示未要求显示编号，c116818b实测"v4中保甲线…"）：按词边界确定性对照到该卷
    const adapter = (provider: string, modelId: string) => ({
      provider, modelId,
      async generate(request: { prompt: string }) {
        calls.push(request.prompt);
        if (request.prompt.includes('自检你刚完成') && !selfChecked) {
          selfChecked = true;
          return { provider, modelId, output: JSON.stringify({ pass: false, issues: ['v2收束fallback与全书结局矛盾'] }), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
        }
        const value = threeVolumeOutput(request.prompt, modelId, 'truncate-batch');
        if (value === '__TRUNCATE__' && request.prompt.includes('"id":"v2"')) throw new ModelAdapterError('输出长度超限', 'technical_failure', false, 200, false, undefined, 'output_length_limit');
        return { provider, modelId, output: JSON.stringify(value), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
      }
    });
    const service = new TimeMachineDesignService(c.database, new TimeMachineModelGateway(c.database, adapter), 64000);
    const created = await round(service, scope, 'split-r4');
    await service.process(created[0]!.id);
    const revisePrompts = calls.filter(p => p.includes('修订本卷卷卡'));
    expect(revisePrompts.length).toBe(1); // 只修v2，其他卷零重生
    expect(revisePrompts[0]).toContain('本卷现行内容：{"id":"v2"');
    expect(revisePrompts[0]).toContain('v2收束fallback与全书结局矛盾');
    expect(revisePrompts[0]).toContain('"sources":["self-check"]'); // 来源随问题进入修订输入
    expect(service.state(scope).find(r => r.id === created[0]!.id)?.state).toBe('succeeded');
  });
});
