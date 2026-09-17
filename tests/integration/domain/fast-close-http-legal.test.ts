import { afterEach, describe, it, expect, vi } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { V7SettingEditorialService } from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';

// 625cc3f7集中复核④：合法HTTP流程断言（非日志打印、非虚绿）。
// payload从已保存选择/资料读取（除待测版本外全部字段合法）；断言状态码、业务错误详情、
// 同轮/同采用ID、前后数量与落库事实。采用分支本书未执行=标注未验证。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

function output(prompt: string): unknown {
  if (prompt.includes('你是主编，推荐')) return { greeting: '老板，推荐如下', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '建立工坊', recommended: true }], structure: 'single', reason: '聚焦成长' };
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return prompt.includes('上次工具结果（仅资料）：null') ? { action: 'search_methods', category: '', cursor: 0 } : { action: 'ready', selected: [] };
  if (prompt.includes('设计全书骨架。只设计')) return { structure: '四幕起承转合', baseline: '轻快成长', ending: '建立工坊', openingHooks: ['钩子1', '钩子2', '钩子3'], words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines: [{ id: 'main', role: 'main', title: '工坊', goal: '立足', answer: '建立工坊', process: '从修理接单到建立工坊', parentIds: [], covers: ['成长线'], milestones: [] }], expectations: [{ id: 'promise', opening: '无灵根能否立足', change: '看到变化', answer: '以机甲立足', lineIds: ['main'] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '建立工坊', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
  if (prompt.includes('补全本卷卷卡') || prompt.includes('补全本批卷卡')) { const id = 'v1'; return { volumes: [{ id, title: '开张', start: '濒临倒闭', goal: '完成订单', conflict: '封锁', beat: '起', turningPoint: '机甲完成', gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null, ending: '工坊建立', handoff: '', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, anchors: [{ id: 'in', ownerEntityId: id, kind: 'entry', summary: '店铺濒临倒闭', span: '本卷开篇', conditions: [{ summary: '订单危机已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场', keywords: [], aliases: [] }, { id: 'out', ownerEntityId: id, kind: 'exit', summary: '订单交付工坊立足', span: '本卷收束', conditions: [{ summary: '订单交付完成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补收束', keywords: [], aliases: [] }], duties: [{ lineId: 'main', action: 'close', result: '工坊建立', anchorIds: ['out'], strength: 'required', reason: '主线起点' }] }] }; }
  if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [] };
  if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}

describe('合法HTTP流程断言（集中复核④）', () => {
  it('资料预览/保存/失效/版本门禁/同键回放全用合法payload并断言业务详情', async () => {
    const c = createTestContext(); contexts.push(c);
    c.config.modelRuntime.endpoints.coding.apiKey = 'fixture-only-no-network';
    c.config.modelRuntime.endpoints.agent.apiKey = 'fixture-only-no-network';
    const app = await createAppServer(c.config, c.database, { timeMachineWindowTokens: 64000, v7OpeningModelAdapters: { resolve: (provider: string, modelId: string) => ({ provider, modelId, async generate(request: { prompt: string }) { return { provider, modelId, output: JSON.stringify(output(request.prompt)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const }; } }) } });
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'fc-http@example.com', displayName: '测试', password: 'Strong-test-pass-123!' } });
      expect(register.statusCode).toBe(200);
      const cookie = String(register.headers['set-cookie']).split(';')[0]!;
      const authed = { ...headers, cookie };
      const ownerId = String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('fc-http@example.com') as { owner_id: string }).owner_id);
      const scope = { ownerId, bookId: 'fc-http-book' };
      new BookRepository(c.database).create(scope, 'HTTP合法验证书', '2026-09-15', 'active');
      c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId, scope.bookId, JSON.stringify({ protagonists: ['林舟'], storyDirection: '无灵根修理工建立工坊' }), 'a'.repeat(64));
      const spy = vi.spyOn(V7SettingEditorialService.prototype, 'timeMachinePrerequisite').mockReturnValue({ ready: true, message: '已确认', version: 'v-f1' });

      const getState = async () => (await app.inject({ url: `/api/time-machine/books/${scope.bookId}/state`, headers: authed })).json().data as {
        runs: { id: string; kind: string; state: string; roundKey: string | null; recommendationHash?: string | null; preparationVersion?: string | null; needsRedesign?: boolean; result: { revision: number; review: { pass: boolean } } | null }[];
        storylineMaterial?: { revision: number; content: Record<string, unknown> } | null;
      };
      const waitFor = async (check: () => Promise<boolean>, what: string) => {
        const start = Date.now();
        while (Date.now() - start < 30000) { if (await check()) return; await new Promise(r => setTimeout(r, 250)); }
        throw new Error(`等待超时：${what}`);
      };

      // 推荐→设计轮（合法选择来自真实推荐结果）
      const rec = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/recommendation-runs`, headers: authed, payload: { intent: '目标20万字轻松向', idempotencyKey: 'fc-http-rec' } });
      expect(rec.statusCode).toBe(202);
      await waitFor(async () => (await getState()).runs.some(r => r.kind === 'recommend' && r.state === 'succeeded'), '推荐完成');
      const recRun = (await getState()).runs.find(r => r.kind === 'recommend' && r.state === 'succeeded')!;
      const recResult = c.database.prepare("SELECT result_json FROM tm2_design_runs WHERE id=?").get(recRun.id) as { result_json: string };
      const recLines = (JSON.parse(recResult.result_json) as { lines: { id: string }[] }).lines;
      const selection = {
        recommendationRunId: recRun.id, recommendationHash: String(recRun.recommendationHash),
        preparationVersion: String(recRun.preparationVersion), selectedLineIds: [String(recLines[0]!.id)],
        addedLines: [], shape: 'auto' as const, ensemble: false, authorNote: '关注成长线'
      };
      const designStart = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/design-runs`, headers: authed, payload: { idempotencyKey: 'fc-http-round', selection } });
      expect(designStart.statusCode).toBe(202);
      const created = (designStart.json().data as { runs: { id: string; scheme: string }[] }).runs;
      await waitFor(async () => (await getState()).runs.filter(r => created.some(cr => cr.id === r.id)).every(r => r.state === 'succeeded'), '三方案完成');

      // ① 资料可看：材料已创建（revision 1，内容完整可读）
      const s1 = await getState();
      expect(s1.storylineMaterial).toBeTruthy();
      expect(s1.storylineMaterial!.revision).toBe(1);
      const savedContent = s1.storylineMaterial!.content; // 合法payload从已保存资料读取
      expect(savedContent.recommendationRunId).toBe(recRun.id);

      // ② 预览：内容未变（合法payload+当前版本）→200且unchanged、有签名
      const previewSame = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/storyline-material/preview`, headers: authed, payload: { content: savedContent, expectedRevision: 1 } });
      expect(previewSame.statusCode, previewSame.body).toBe(200);
      const previewSameData = previewSame.json().data as { unchanged: boolean; currentRevision: number; signature: string; revisionMatch: boolean };
      expect(previewSameData.unchanged).toBe(true);
      expect(previewSameData.revisionMatch).toBe(true);
      expect(previewSameData.signature).toBeTruthy();

      // ③ 预览：作者修改→200且影响基线（非unchanged）
      const editedContent = { ...savedContent, authorNote: '作者修改：加强伙伴线权重' };
      const previewEdit = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/storyline-material/preview`, headers: authed, payload: { content: editedContent, expectedRevision: 1 } });
      expect(previewEdit.statusCode, previewEdit.body).toBe(200);
      const previewEditData = previewEdit.json().data as { unchanged: boolean; affectedBaseline: boolean; affectedRuns: { id: string }[]; signature: string };
      expect(previewEditData.unchanged).toBe(false);
      expect(previewEditData.affectedBaseline).toBe(false); // 本书尚未采用：无已采用基线可受影响（正确语义）
      expect(previewEditData.affectedRuns.length).toBeGreaterThan(0); // 受影响设计轮如实列出

      // ④ 保存修改：版本+1且落库（createdBy=author-edit），设计轮失效标记
      const save = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/storyline-material`, headers: authed, payload: { content: editedContent, expectedRevision: 1, idempotencyKey: 'fc-http-mat-save', previewSignature: previewEditData.signature } });
      expect(save.statusCode, save.body).toBe(200);
      const saveData = save.json().data as { projection: { revision: number }; markedRuns: number };
      expect(saveData.projection.revision).toBe(2);
      const matRow = c.database.prepare('SELECT revision, created_by FROM tm2_storyline_materials WHERE owner=? AND book=? ORDER BY revision DESC LIMIT 1').get(scope.ownerId, scope.bookId) as { revision: number; created_by: string } | undefined;
      expect(matRow?.revision).toBe(2);
      expect(matRow?.created_by).toBe('author-edit');
      expect(saveData.markedRuns).toBeGreaterThan(0); // 失效标记落库
      const staleRuns = c.database.prepare("SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND needs_redesign=1").get(scope.bookId) as { n: number };
      expect(staleRuns.n).toBeGreaterThan(0);

      // ⑤ 版本门禁：除待测版本外全部字段合法，旧版本1→409且retryable=false、零新轮
      const runsBefore = (await getState()).runs.length;
      const stale = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/design-runs`, headers: authed, payload: { idempotencyKey: 'fc-http-stale', selection, expectedMaterialRevision: 1 } });
      expect(stale.statusCode).toBe(409);
      const staleErr = stale.json() as { error: { code: string; message: string; retryable: boolean } };
      expect(staleErr.error.retryable).toBe(false);
      expect(staleErr.error.message).toContain('版本');
      expect((await getState()).runs.length).toBe(runsBefore);

      // ⑥ 同键回放：原幂等键+原合法选择→返回同一轮（同run IDs），不是只比数量
      const replay = await app.inject({ method: 'POST', url: `/api/time-machine/books/${scope.bookId}/design-runs`, headers: authed, payload: { idempotencyKey: 'fc-http-round', selection } });
      expect([200, 202]).toContain(replay.statusCode);
      const replayRuns = (replay.json().data as { runs: { id: string }[] }).runs;
      expect(replayRuns.map(r => r.id).sort()).toEqual(created.map(r => r.id).sort());
      expect((await getState()).runs.length).toBe(runsBefore);

      // ⑦ 采用分支：本书未发生自然采用→明确标注未验证（不冒充已证明）
      const adopted = c.database.prepare('SELECT adoption FROM tm2_books WHERE owner=? AND book=?').get(scope.ownerId, scope.bookId) as { adoption: string | null } | undefined;
      expect(adopted?.adoption ?? null).toBeNull(); // 未验证分支：本测试不声明采用机制已验（机制证据见s1a-fixes F1套件）
      spy.mockRestore();
    } finally { vi.restoreAllMocks(); await app.close(); }
  });
});
