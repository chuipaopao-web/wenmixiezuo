import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestContext, type TestContext } from '../helpers/test-context.js';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import type { V7OpeningModelAdapterResolver } from '../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import {
  SettingResolver,
  registerDepartmentAuthor,
  createDepartmentBook,
  pollDepartmentBatch,
  pollDepartmentFinalReview,
  DEPARTMENT_HEADERS
} from '../integration/helpers/setting-department-fixtures.js';

/**
 * S1-A隔离浏览器验证harness（3a84dc98复核要求）。仅当S1A_BROWSER_HARNESS=1时运行；
 * 默认skip，不影响verify:full。启动真实API(43111)+vite dev(43180，代理/api)，
 * 通过真实HTTP把测试书推进到“设定确认+总清单完成”状态，浏览器侧用真实登录会话验证
 * 时光机方向页三宽度、刷新恢复、未知响应原键重试与编辑不被轮询覆盖。
 * BREAK_FLAG文件存在时，design-runs请求以连接重置方式丢失响应（结果未知场景）。
 */
export const BREAK_FLAG = join(tmpdir(), 's1a-break-design.flag');
const API_PORT = 43111;
const WEB_PORT = 43180;

function tmOutput(prompt: string): unknown {
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return { action: 'ready', selected: [] };
  if (prompt.includes('你是主编，推荐')) return { greeting: '老板，推荐如下', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '建立工坊', recommended: true }, { id: 'ally', role: 'through', title: '伙伴线', description: '结识同伴', recommended: false }], structure: 'single', reason: '聚焦成长' };
  if (prompt.includes('设计全书骨架。只设计')) return { structure: '四幕起承转合', baseline: '轻快成长', ending: '建立工坊', openingHooks: ['开头钩子', '第一章钩子', '前三章钩子'], words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines: [{ id: 'main', role: 'main', title: '工坊', goal: '立足', answer: '建立工坊', process: '从修理到建坊', parentIds: [], milestones: [] }], expectations: [{ id: 'promise', opening: '无灵根能否立足', change: '看到变化', answer: '以机甲立足', lineIds: ['main'] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '建立工坊', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
  if (prompt.includes('补全本批卷卡')) return { volumes: [{ id: 'v1', title: '开张', start: '濒临倒闭', goal: '完成订单', conflict: '封锁', beat: '起', turningPoint: '机甲完成', gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null, ending: '工坊建立', handoff: '', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, anchors: [{ id: 'v1-in', ownerEntityId: 'v1', kind: 'entry', summary: '店铺濒临倒闭', span: '本卷开篇', conditions: [{ summary: '订单危机已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '未达成需修订开场', keywords: [], aliases: [] }, { id: 'v1-out', ownerEntityId: 'v1', kind: 'exit', summary: '订单交付工坊立足', span: '本卷收束', conditions: [{ summary: '订单交付完成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '全书结束', keywords: [], aliases: [] }], duties: [{ lineId: 'main', action: 'close', result: '工坊建立', anchorIds: ['v1-out'], strength: 'required', reason: '主线起点' }] }] };
  if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [] };
  if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [] };
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}

const maybeIt = process.env.S1A_BROWSER_HARNESS === '1' ? it : it.skip;
const contexts: TestContext[] = [];
let vite: ReturnType<typeof spawn> | null = null;
let app: Awaited<ReturnType<typeof createAppServer>> | null = null;

describe('S1-A browser harness (manual, env-gated)', () => {
  maybeIt('serves the real app with a setting-complete book and keeps running', async () => {
    const c = createTestContext('s1a-browser-'); contexts.push(c);
    c.config.modelRuntime.endpoints.coding.apiKey = 'fixture-only-no-network';
    c.config.modelRuntime.endpoints.agent.apiKey = 'fixture-only-no-network';
    const settingBase = new SettingResolver(false);
    // 时光机提示词先判（其自检/修复提示含“紧凑候选：”，会误中设定段的“候选：”通配标记）
    const tmMarkers = ['你是主编，推荐', '设计全书骨架。只设计', '补全本批卷卡', '核对短卡是否', '判断需要哪些方法', '自检你刚完成', '自检候选锚点', '核对候选锚点', '核对候选骨架'];
    const settingMarkers = ['v7_setting_group_design_v1', 'v7_setting_batch_final_review', 'v7_compile_book_genre_profile_v1', '只判断后续设定阶段应该准备哪些条目', '你是副编', '你是设计成员', '你是设定连续性审查员', '候选：', '上次输出存在空字段'];
    const resolver: V7OpeningModelAdapterResolver = {
      resolve(provider, modelId, purpose) {
        const base = settingBase.resolve(provider, modelId, purpose);
        return {
          provider, modelId,
          async generate(request, signal) {
            if (tmMarkers.some(marker => request.prompt.includes(marker))) {
              return { provider, modelId, output: JSON.stringify(tmOutput(request.prompt)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
            }
            if (settingMarkers.some(marker => request.prompt.includes(marker))) return base.generate(request, signal);
            return { provider, modelId, output: JSON.stringify(tmOutput(request.prompt)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
          }
        };
      }
    };
    app = await createAppServer(c.config, c.database, { timeMachineWindowTokens: 64000, v7OpeningModelAdapters: resolver });
    // BREAK_FLAG存在时：design-runs以连接重置丢失响应（模拟结果未知），浏览器侧刷新后应原键重试
    await app.addHook('onRequest', async (request) => {
      if (existsSync(BREAK_FLAG) && request.method === 'POST' && request.url.includes('/design-runs')) {
        request.raw.destroy();
      }
    });
    await app.listen({ host: '127.0.0.1', port: API_PORT });
    const cookie = await registerDepartmentAuthor(app, 'browser@example.test', '浏览器验证作者', 'strong-pass-browser');
    const bookId = await createDepartmentBook(app, cookie, '浏览器验证书', 's1a-browser-book', '历史脑洞');
    const batch = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'browser-batch' } });
    expect(batch.statusCode, batch.body).toBe(200);
    const completed = await pollDepartmentBatch(app, cookie, bookId, batch.json().data.batchId as string);
    expect(completed.status, JSON.stringify(completed)).toBe('awaiting_author');
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/confirm-all`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { items: (completed.items as { itemKey: string; revision: number }[]).map(item => ({ itemKey: item.itemKey, expectedRevision: item.revision })) } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    settingBase.finalReviewOutputOverride = JSON.stringify({ verdict: 'pass', summary: '全部设定跨条目核对一致。', unifiedDecisions: [], conflicts: [], patches: [] });
    const review = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { idempotencyKey: 'browser-review' } });
    expect(review.statusCode, review.body).toBe(200);
    expect((await pollDepartmentFinalReview(app, cookie, bookId)).status).toBe('ready');
    // 等待交接派工的推荐完成（真实执行器tick）
    const recDeadline = Date.now() + 30000;
    for (;;) {
      const state = (await app.inject({ url: `/api/time-machine/books/${bookId}/state`, headers: { ...DEPARTMENT_HEADERS, cookie } })).json().data as { runs: { kind: string; state: string }[] };
      if (state.runs.some(r => r.kind === 'recommend' && r.state === 'succeeded')) break;
      if (Date.now() > recDeadline) throw new Error('推荐未在30秒内完成');
      await new Promise(r => setTimeout(r, 500));
    }
    // vite dev服务前端（/api代理到43111，origin改写为43110与CORS配置一致）
    const repoRoot = process.cwd();
    vite = spawn(process.execPath, [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'vite.config.mjs', '--configLoader', 'native'], { cwd: join(repoRoot, 'coauthoring-v7', 'author-app'), stdio: 'ignore', shell: false });
    const webDeadline = Date.now() + 30000;
    for (;;) {
      try {
        const probe = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
        if (probe.ok) break;
      } catch { /* 等待vite启动 */ }
      if (Date.now() > webDeadline) throw new Error('vite dev未在30秒内启动');
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('S1A-HARNESS ' + JSON.stringify({
      email: 'browser@example.test',
      password: 'strong-pass-browser',
      bookId,
      webUrl: `http://127.0.0.1:${WEB_PORT}/?view=time-machine&bookId=${bookId}`,
      apiOrigin: `http://127.0.0.1:${API_PORT}`,
      breakFlag: BREAK_FLAG
    }));
    await new Promise(() => undefined); // 常驻直至外部终止
  }, 3_600_000);
});

afterAll(() => {
  vite?.kill();
  void app?.close();
  contexts.splice(0).forEach(context => context.close());
});
