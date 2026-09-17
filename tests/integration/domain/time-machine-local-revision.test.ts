import { afterEach, describe, it, expect, vi } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { V7SettingEditorialService } from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';

// 7662b6f6修订闭环收尾·离线整链证明：
// mock首轮审查报本轮三类问题（卷2/卷3定位）→局部修订只发受影响卷→新版本复查放行→
// 合法HTTP采用/同键回放/作者修改失效闭环。骨架与其他卷零重生，未改对象逐字段不变。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

const volumeOf = (id: string, turningPoint: string): Record<string, unknown> => ({
  id, title: `卷${id}`, start: '开局成立', goal: '本卷目标', conflict: '封锁', beat: '起',
  turningPoint, gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null,
  ending: '本卷收束达成', handoff: id === 'v3' ? '' : '引出下卷',
  words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' },
  anchors: [
    { id: 'in', ownerEntityId: id, kind: 'entry', summary: '开场状态成立', span: '本卷开篇', conditions: [{ summary: '开局已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场', keywords: [], aliases: [] },
    { id: 'out', ownerEntityId: id, kind: 'exit', summary: '收束条件达成', span: '本卷收束', conditions: [{ summary: '本卷目标已经达成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补收束', keywords: [], aliases: [] }
  ],
  duties: [{ lineId: 'main', action: 'advance', result: '主线推进', anchorIds: ['out'], strength: 'required', reason: '主线本卷必须推进' }]
});

/** 修订感知fake输出：首轮锚点审查对卷2/卷3报问题；修订请求返回对应修订卷（turningPoint带修订标记）；复查放行。 */
function revisionAwareOutput(prompt: string, modelId: string, state: { revised: boolean }): unknown {
  if (prompt.includes('你是主编，推荐')) return { greeting: '老板，推荐如下', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '建立工坊', recommended: true }], structure: 'single', reason: '聚焦成长' };
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return prompt.includes('上次工具结果（仅资料）：null') ? { action: 'search_methods', category: '', cursor: 0 } : { action: 'ready', selected: [] };
  if (prompt.includes('设计全书骨架。只设计')) return { structure: '三幕', baseline: `轻快-${modelId}`, ending: '建立工坊', openingHooks: ['钩1', '钩2', '钩3'], words: { target: 300000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines: [{ id: 'main', role: 'main', title: '工坊', goal: '立足', answer: '建立工坊', process: '从修理到建立工坊', parentIds: [], covers: ['成长线'], milestones: [] }], expectations: [{ id: 'promise', opening: '能否立足', change: '看到变化', answer: '以机甲立足', lineIds: ['main'] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '立足', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }, { id: 'v2', title: '扩张', goal: '扩张', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }, { id: 'v3', title: '兑现', goal: '兑现', words: { target: 100000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
  if (prompt.includes('修订本卷卷卡')) {
    const idMatch = prompt.match(/"id"\s*:\s*"(v\d)"/u);
    const id = idMatch?.[1] ?? 'v2';
    state.revised = true;
    return { volumes: [volumeOf(id, `修订后转折-${id}`)] };
  }
  if (prompt.includes('补全本卷卷卡') || prompt.includes('补全本批卷卡')) {
    const briefMatch = prompt.match(/"id"\s*:\s*"(v\d)"/u);
    return { volumes: [volumeOf(briefMatch?.[1] ?? 'v1', '初稿转折')] };
  }
  if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  if (prompt.includes('核对候选锚点')) {
    if (!state.revised && (prompt.includes('卷2') || prompt.includes('"id":"v2"'))) {
      return { pass: false, issues: ['卷2收束fallback与必填目标冲突', '卷3锚点条件空泛循环'], suggestions: [], hasMoreIssues: false };
    }
    return { pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  }
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}

describe('局部修订闭环（7662b6f6收尾）', () => {
  it('首轮问题→只修受影响卷→复查放行→HTTP采用/回放/修改失效全链断言', async () => {
    const c = createTestContext(); contexts.push(c);
    c.config.modelRuntime.endpoints.coding.apiKey = 'fixture-only-no-network';
    c.config.modelRuntime.endpoints.agent.apiKey = 'fixture-only-no-network';
    const revisionState = { revised: false };
    const allPrompts: string[] = [];
    const app = await createAppServer(c.config, c.database, {
      timeMachineWindowTokens: 64000,
      v7OpeningModelAdapters: {
        resolve: (provider: string, modelId: string) => ({
          provider, modelId,
          async generate(request: { prompt: string }) {
            allPrompts.push(request.prompt);
            return { provider, modelId, output: JSON.stringify(revisionAwareOutput(request.prompt, modelId, revisionState)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
          }
        })
      }
    });
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'fc-revise@example.com', displayName: '测试', password: 'Strong-test-pass-123!' } });
      expect(register.statusCode).toBe(200);
      const cookie = String(register.headers['set-cookie']).split(';')[0]!;
      const authed = { ...headers, cookie };
      const ownerId = String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('fc-revise@example.com') as { owner_id: string }).owner_id);
      const scope = { ownerId, bookId: 'fc-revise-book' };
      new BookRepository(c.database).create(scope, '局部修订验证书', '2026-09-15', 'active');
      c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId, scope.bookId, JSON.stringify({ protagonists: ['林舟'], storyDirection: '无灵根修理工建立工坊' }), 'a'.repeat(64));
      const spy = vi.spyOn(V7SettingEditorialService.prototype, 'timeMachinePrerequisite').mockReturnValue({ ready: true, message: '已确认', version: 'v-f1' });

      const getState = async () => (await app.inject({ url: `/api/time-machine/books/${scope.bookId}/state`, headers: authed })).json().data as {
        runs: { id: string; kind: string; state: string; roundKey: string | null; recommendationHash?: string | null; preparationVersion?: string | null; result: { revision: number; review: { pass: boolean } } | null }[];
        storylineMaterial?: { revision: number; content: Record<string, unknown> } | null;
      };
      const waitFor = async (check: () => Promise<boolean>, what: string) => {
        const start = Date.now();
        while (Date.now() - start < 30000) { if (await check()) return; await new Promise(r => setTimeout(r, 250)); }
        throw new Error(`等待超时：${what}`);
      };

      // 推荐→设计轮
      const rec = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/recommendation-runs`, headers: authed, payload: { intent: '目标30万字轻松向', idempotencyKey: 'fc-revise-rec' } });
      expect(rec.statusCode).toBe(202);
      await waitFor(async () => (await getState()).runs.some(r => r.kind === 'recommend' && r.state === 'succeeded'), '推荐完成');
      const recRun = (await getState()).runs.find(r => r.kind === 'recommend' && r.state === 'succeeded')!;
      const recResult = c.database.prepare('SELECT result_json FROM tm2_design_runs WHERE id=?').get(recRun.id) as { result_json: string };
      const recLines = (JSON.parse(recResult.result_json) as { lines: { id: string }[] }).lines;
      const selection = {
        recommendationRunId: recRun.id, recommendationHash: String(recRun.recommendationHash),
        preparationVersion: String(recRun.preparationVersion), selectedLineIds: [String(recLines[0]!.id)],
        addedLines: [], shape: 'auto' as const, ensemble: false, authorNote: '关注成长线'
      };
      const designStart = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/design-runs`, headers: authed, payload: { idempotencyKey: 'fc-revise-round', selection } });
      expect(designStart.statusCode).toBe(202);
      const created = (designStart.json().data as { runs: { id: string; scheme: string }[] }).runs;

      // 等待方案A终态（首轮审查报卷2/卷3问题→局部修订→复查放行）
      await waitFor(async () => {
        const a = (await getState()).runs.find(r => r.id === created[0]!.id);
        return a?.state === 'succeeded' && a.result !== null;
      }, '方案A局部修订完成');

      const runA = (await getState()).runs.find(r => r.id === created[0]!.id)!;
      expect(runA.result!.review.pass).toBe(true);
      expect(runA.result!.revision).toBe(2); // revision-1局部修订后新revision

      // ① 局部修订各完整封套合限；骨架/其他卷零重生
      const revisionPrompts = allPrompts.filter(p => p.includes('修订本卷卷卡'));
      expect(revisionPrompts.length).toBe(2); // 只修卷2、卷3
      for (const p of revisionPrompts) expect(p.length).toBeLessThan(15000); // 完整封套合限
      expect(revisionPrompts.every(p => p.includes('本卷现行内容') && p.includes('本卷问题与依据'))).toBe(true);
      // 修订轮不触发骨架/未受影响卷生成（v1不在修订范围）
      expect(revisionPrompts.some(p => p.includes('"v1"') && p.includes('本卷现行内容'))).toBe(false);
      // 修订反馈只注入修订请求：复查（自检/审查）提示不含"上轮意见"
      const recheckPrompts = allPrompts.filter(p => p.includes('自检你刚完成') || p.includes('核对候选骨架') || p.includes('核对候选锚点'));
      const revisionRoundRechecks = recheckPrompts.filter(p => p.includes('修订后转折')); // 修订后候选内容进入复查输入
      expect(revisionRoundRechecks.length).toBeGreaterThan(0); // 复查确实针对新版本
      expect(recheckPrompts.filter(p => p.includes('上轮意见')).length).toBe(0); // 修订反馈不无差别附加到复查

      // ② 未改对象与原候选逐字段不变
      const oldCandidate = c.database.prepare('SELECT body FROM tm2_candidates WHERE id=? AND revision=1').get(created[0]!.id) as { body: string } | undefined;
      const newCandidate = c.database.prepare('SELECT body FROM tm2_candidates WHERE id=? AND revision=2').get(created[0]!.id) as { body: string } | undefined;
      expect(oldCandidate).toBeTruthy();
      expect(newCandidate).toBeTruthy();
      const oldPlan = (JSON.parse(oldCandidate!.body) as { plan: { volumes: Record<string, unknown>[]; structure: string; ending: string } }).plan;
      const newPlan = (JSON.parse(newCandidate!.body) as { plan: { volumes: Record<string, unknown>[]; structure: string; ending: string } }).plan;
      expect(JSON.stringify(newPlan.volumes[0])).toBe(JSON.stringify(oldPlan.volumes[0])); // v1逐字段不变
      expect(newPlan.structure).toBe(oldPlan.structure); // 骨架不变
      expect(newPlan.ending).toBe(oldPlan.ending); // 结局不变
      expect(String((newPlan.volumes[1] as { turningPoint: string }).turningPoint)).toContain('修订后转折'); // v2已修订
      expect(String((newPlan.volumes[2] as { turningPoint: string }).turningPoint)).toContain('修订后转折'); // v3已修订
      expect((newPlan.volumes as { id: string }[]).map(v => v.id)).toEqual(['v1', 'v2', 'v3']); // 卷ID/顺序不变

      // ③ HTTP采用（合法payload）+同键回放+作者修改失效闭环
      const adopt = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/adoptions`, headers: authed, payload: { candidateId: created[0]!.id, revision: 2, expectedRevision: 0, idempotencyKey: 'fc-revise-adopt' } });
      expect(adopt.statusCode, adopt.body).toBe(200);
      // 采用同键回放：返回同一采用不重复生效
      const adoptReplay = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/adoptions`, headers: authed, payload: { candidateId: created[0]!.id, revision: 2, expectedRevision: 0, idempotencyKey: 'fc-revise-adopt' } });
      expect(adoptReplay.statusCode).toBe(200);
      // 采用事实落库（books.adoption）且回放后仍为同一采用
      const adoptedRow = c.database.prepare('SELECT adoption FROM tm2_books WHERE owner=? AND book=?').get(scope.ownerId, scope.bookId) as { adoption: string | null } | undefined;
      expect(adoptedRow?.adoption).toBeTruthy();
      const stateAfter = await getState();
      expect((stateAfter as unknown as { adopted: { candidateId?: string } | null }).adopted).toBeTruthy();
      // 作者修改失效：保存材料修改→旧基线标记
      const s2 = await getState();
      const mat = s2.storylineMaterial!;
      const previewEdit = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/storyline-material/preview`, headers: authed, payload: { content: { ...mat.content, authorNote: '作者修改：加强伙伴线' }, expectedRevision: mat.revision } });
      expect(previewEdit.statusCode, previewEdit.body).toBe(200);
      const previewEditData = previewEdit.json().data as { signature: string; affectedRuns: { id: string }[] };
      expect(previewEditData.affectedRuns.length).toBeGreaterThan(0);
      const save = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/storyline-material`, headers: authed, payload: { content: { ...mat.content, authorNote: '作者修改：加强伙伴线' }, expectedRevision: mat.revision, idempotencyKey: 'fc-revise-mat-save', previewSignature: previewEditData.signature } });
      expect(save.statusCode, save.body).toBe(200);
      const matRow = c.database.prepare('SELECT revision, created_by FROM tm2_storyline_materials WHERE owner=? AND book=? ORDER BY revision DESC LIMIT 1').get(scope.ownerId, scope.bookId) as { revision: number; created_by: string };
      expect(matRow.revision).toBe(2);
      expect(matRow.created_by).toBe('author-edit');
      // 失效后旧版本设计请求409
      const stale = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/design-runs`, headers: authed, payload: { idempotencyKey: 'fc-revise-stale', selection, expectedMaterialRevision: 1 } });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: { retryable: boolean } }).error.retryable).toBe(false);
      spy.mockRestore();
    } finally { vi.restoreAllMocks(); await app.close(); }
  });
});
