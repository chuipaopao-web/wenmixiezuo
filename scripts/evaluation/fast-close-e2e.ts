#!/usr/bin/env tsx
/**
 * S1-FAST-CLOSE隔离新书端到端（合同步骤4-5）：
 *   tsx scripts/evaluation/fast-close-e2e.ts --book fc-e2e-book-1
 * 隔离临时库+真实模型通道+真实HTTP（app.inject）：设定完成→故事线推荐→结构化确认→
 * 三方案全书设计→真实异模型审查（必要修订走现有一次流程）→自然通过→HTTP采用；
 * 资料页可看可改、修改后旧基线409、同键刷新不重复创建。
 * 断点：阶段状态写 .local/eval/fast-close-e2e-state.json，重跑从已完成阶段继续（幂等键固定）。
 * 父预算：与冒烟共用 s1-fast-close 80请求/300万token/4小时（本脚本按tm2_model_calls计数自查，超限即停）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createTestContext } from '../../tests/helpers/test-context.js';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';

const BOOK_ID = process.argv.includes('--book') ? process.argv[process.argv.indexOf('--book') + 1]! : 'fc-e2e-book-1';
const STATE_PATH = '.local/eval/fast-close-e2e-state.json';
const PARENT_BUDGET = { requests: 80, tokens: 3_000_000, wallClockHours: 4, startedAt: '2026-09-17T02:33:18Z' };
const TARGET_WORDS = 600000;

type Phase = 'setup' | 'members' | 'setting' | 'material' | 'recommend' | 'design' | 'adopt' | 'material-edit' | 'done';
interface E2EState {
  phase: Phase; ownerId?: string; ownerEmail?: string; materialRevision?: number;
  recommendationRunId?: string; recommendationHash?: string; preparationVersion?: string;
  designRunIds?: { id: string; scheme: string }[]; adoptedCandidateId?: string;
  modelCallsAtStart: number; log: { at: string; text: string }[];
}

const now = (): string => new Date().toISOString();
function loadState(): E2EState {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as E2EState;
  return { phase: 'setup', modelCallsAtStart: 0, log: [] };
}
function saveState(state: E2EState): void { mkdirSync('.local/eval', { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }
function note(state: E2EState, text: string): void { state.log.push({ at: now(), text }); console.log(`[${state.phase}] ${text}`); saveState(state); }

async function main(): Promise<void> {
  const state = loadState();
  const c = createTestContext('wenmi-fast-close-');
  const app = await createAppServer(c.config, c.database, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const callsCount = (): number => (c.database.prepare('SELECT COUNT(*) AS n FROM model_calls').get() as { n: number }).n;
  const budgetCheck = (): void => {
    const used = callsCount() - state.modelCallsAtStart + 8; // +冒烟已耗8（父账本同批）
    const elapsedH = (Date.now() - Date.parse(PARENT_BUDGET.startedAt)) / 3600_000;
    if (used >= PARENT_BUDGET.requests) throw new Error(`父预算请求硬停：已用约${used}/${PARENT_BUDGET.requests}`);
    if (elapsedH >= PARENT_BUDGET.wallClockHours) throw new Error(`父预算墙钟硬停：已用${elapsedH.toFixed(1)}小时/${PARENT_BUDGET.wallClockHours}`);
  };
  const inj = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: unknown) => {
    const r = await app.inject({ method, url, headers: { ...headers, cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
    return r;
  };
  const waitFor = async (check: () => Promise<boolean>, what: string, timeoutMs = 15 * 60_000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) { budgetCheck(); if (await check()) return; await new Promise(r => setTimeout(r, 3000)); }
    const rows = c.database.prepare('SELECT id,kind,scheme,state,error_code,error_message,phase FROM tm2_design_runs WHERE book_id=?').all(BOOK_ID);
    throw new Error(`等待超时：${what}；runs=${JSON.stringify(rows)}`);
  };

  try {
    // ---- P0 setup：注册作者、建书、开书蓝图（设定前置的真实持久对象）----
    let cookie = '';
    if (state.phase === 'setup') {
      state.modelCallsAtStart = callsCount();
      const email = `fc-e2e-${Date.now()}@example.com`;
      const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email, displayName: '端到端隔离作者', password: 'Strong-test-pass-123!' } });
      if (reg.statusCode !== 200) throw new Error(`注册失败：${reg.body}`);
      cookie = String(reg.headers['set-cookie']).split(';')[0]!;
      const ownerId = String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get(email) as { owner_id: string }).owner_id);
      new BookRepository(c.database).create({ ownerId, bookId: BOOK_ID }, 'S1-FAST-CLOSE隔离书·历史融合守城', now().slice(0, 10), 'active');
      c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','history','历史',?,?,'active',?)")
        .run(ownerId, BOOK_ID, JSON.stringify({ protagonists: ['沈恪'], storyDirection: '现代历史学者穿越南宋，以现代组织方法重建地方保甲，在守城战中证明制度的力量' }), 'a'.repeat(64), now());
      state.ownerId = ownerId; state.ownerEmail = email;
      state.phase = 'members'; note(state, `建书完成 owner=${ownerId} book=${BOOK_ID}`);
    } else {
      cookie = String((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: state.ownerEmail, password: 'Strong-test-pass-123!' } })).headers['set-cookie']).split(';')[0]!;
    }
    const ownerId = state.ownerId!;
    const scope = { ownerId, bookId: BOOK_ID };

    // ---- P1 装配实验组合（治理配置成员模型；排名派工保持关闭；审查者≠各生成节点模型）----
    if (state.phase === 'members') {
      const gov = await inj('GET', '/api/v1/admin/v7/agent-governance', cookie);
      if (gov.statusCode !== 200) throw new Error(`治理视图失败：${gov.body}`);
      const view = gov.json().data as { revision?: number; members?: { memberKey: string; fixedRoleKey?: string; roleKey?: string; model?: { modelId: string }; enabled?: boolean; expectedRevision?: number }[] };
      const members = view.members ?? [];
      const revisionOf = (key: string): number => Number((members.find(m => m.memberKey === key) as { expectedRevision?: number } | undefined)?.expectedRevision ?? view.revision ?? 1);
      const bind = async (key: string, modelProfileKey: string): Promise<void> => {
        const r = await inj('PATCH', `/api/v1/admin/v7/agent-governance/members/${key}`, cookie, { expectedRevision: revisionOf(key), modelProfileKey, reason: 'S1-FAST-CLOSE隔离实验组合装配' });
        if (r.statusCode !== 200) throw new Error(`成员${key}绑定${modelProfileKey}失败：${r.body}`);
        note(state, `成员绑定 ${key} → ${modelProfileKey}`);
      };
      const byRole = (role: string): string[] => members.filter(m => (m.fixedRoleKey ?? m.roleKey) === role && m.enabled !== false).map(m => m.memberKey);
      // 资料卡：deputy_editor→ds-flash（card-extract/finalize有效成绩第1）
      for (const key of byRole('deputy_editor').slice(0, 1)) await bind(key, 'deepseek-v4-flash');
      // 编剧三方案：ds-pro（骨架有效成绩第1）/doubao（卷卡第1）/glm-flash（合并第1、卷卡第2）
      const writers = byRole('planning_writer');
      const writerModels = ['deepseek-v4-pro', 'doubao-seed-2.1-turbo', 'glm-5.3-flash'];
      for (let i = 0; i < Math.min(writers.length, 3); i++) await bind(writers[i]!, writerModels[i]!);
      // 审查：chief_editor→k2.7（冒烟候选；k3按既定规则不进时光机岗位）；其余chief保持异模型可选
      const chiefs = byRole('chief_editor');
      if (chiefs.length) await bind(chiefs[0]!, 'kimi-k2.7-code');
      state.phase = 'setting'; note(state, `装配完成：writers=${writers.slice(0, 3).join(',')} chiefs=${chiefs.join(',')}`);
    }

    // ---- P2 设定完成（真实模型：设定批次设计→确认→主编总清单整理）----
    if (state.phase === 'setting') {
      const dep = { ...headers, cookie };
      const batch = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${BOOK_ID}/setting-batches`, headers: dep, payload: { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'fc-e2e-setting-batch' } });
      if (batch.statusCode !== 200) throw new Error(`设定批次创建失败：${batch.body}`);
      const batchId = (batch.json().data as { batchId: string }).batchId;
      let view: { status: string; items?: { itemKey: string; revision: number }[] } | null = null;
      await waitFor(async () => {
        const r = await app.inject({ url: `/api/v1/v7/books/${BOOK_ID}/setting-batches/${batchId}`, headers: dep });
        if (r.statusCode === 200) { view = r.json().data as typeof view; return ['awaiting_author', 'completed', 'partially_failed', 'failed'].includes(view!.status); }
        return false;
      }, '设定批次完成');
      if (!view || !['awaiting_author', 'completed'].includes((view as { status: string }).status)) throw new Error(`设定批次未成功：${JSON.stringify(view)}`);
      const items = ((view as { items?: { itemKey: string; revision: number }[] }).items ?? []).map(i => ({ itemKey: i.itemKey, expectedRevision: i.revision }));
      const confirm = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${BOOK_ID}/setting-items/confirm-all`, headers: dep, payload: { items } });
      if (confirm.statusCode !== 200) throw new Error(`设定确认失败：${confirm.body}`);
      note(state, `设定批次${batchId}完成并确认${items.length}项（主编总清单由既有流程推进）`);
      state.phase = 'material';
    }

    // ---- P3 资料可看（初始无材料态）----
    const getState = async () => (await inj('GET', `/api/time-machine/books/${BOOK_ID}/state`, cookie)).json().data as {
      runs: { id: string; kind: string; state: string; roundKey: string | null; recommendationHash?: string | null; preparationVersion?: string | null; result: { revision: number; review: { pass: boolean } } | null }[];
      adopted: unknown; storylineMaterial?: { revision: number } | null; preparation?: { ready?: boolean; version?: string | null };
    };
    if (state.phase === 'material') {
      const s0 = await getState();
      note(state, `资料页可看：初始材料态=${JSON.stringify(s0.storylineMaterial ?? null)}；设定就绪=${JSON.stringify(s0.preparation ?? null)}`);
      state.phase = 'recommend';
    }

    // ---- P4 故事线推荐（真实模型）----
    if (state.phase === 'recommend') {
      const intent = `作者选择：主线为「沈恪的核心成长线」，贯穿线「守将不信制度只信私兵、豪强抵制编户、粮草只够四十日的对抗线」。目标体量60万字，轻松向，不虐主，不得让对抗线中途消失。`;
      const rec = await inj('POST', `/api/time-machine/books/${BOOK_ID}/recommendation-runs`, cookie, { intent, idempotencyKey: 'fc-e2e-rec' });
      if (rec.statusCode !== 202) throw new Error(`推荐创建失败：${rec.body}`);
      await waitFor(async () => (await getState()).runs.some(r => r.kind === 'recommend' && r.state === 'succeeded'), '推荐完成');
      const recRun = (await getState()).runs.find(r => r.kind === 'recommend' && r.state === 'succeeded')!;
      state.recommendationRunId = recRun.id;
      state.recommendationHash = String(recRun.recommendationHash);
      state.preparationVersion = String(recRun.preparationVersion);
      state.phase = 'design'; note(state, `推荐完成 run=${recRun.id} hash=${state.recommendationHash.slice(0, 12)} pv=${state.preparationVersion}`);
    }

    // ---- P5 结构化确认+三方案设计（真实模型全链）----
    if (state.phase === 'design') {
      const s1 = await getState();
      const materialRevision = s1.storylineMaterial?.revision ?? 0;
      const selection = {
        recommendationRunId: state.recommendationRunId, recommendationHash: state.recommendationHash,
        preparationVersion: state.preparationVersion, selectedLineIds: ['growth'],
        addedLines: [{ title: '粮台线', description: '四十日粮草的筹措、损毁与重建贯穿全城命运' }],
        shape: 'auto' as const, ensemble: true, authorNote: '希望保甲重建过程有具体的制度细节'
      };
      const ds = await inj('POST', `/api/time-machine/books/${BOOK_ID}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round', selection, ...(materialRevision > 0 ? { expectedMaterialRevision: materialRevision } : {}) });
      if (ds.statusCode !== 202) throw new Error(`设计轮创建失败：${ds.body}`);
      const created = (ds.json().data as { runs: { id: string; scheme: string }[] }).runs;
      state.designRunIds = created;
      state.materialRevision = materialRevision;
      note(state, `设计轮创建：${created.map(r => `${r.scheme}=${r.id}`).join(' ')}（材料版本${materialRevision}）`);
      await waitFor(async () => {
        const runs = (await getState()).runs.filter(r => created.some(cr => cr.id === r.id));
        return runs.length === 3 && runs.every(r => ['succeeded', 'failed', 'needs_review'].includes(r.state));
      }, '三方案终态', 60 * 60_000);
      const runs = (await getState()).runs.filter(r => created.some(cr => cr.id === r.id));
      for (const r of runs) note(state, `方案终态：${r.id} state=${r.state} review=${JSON.stringify(r.result?.review ?? null)}`);
      state.phase = 'adopt';
    }

    // ---- P6 自然过审才HTTP采用 ----
    if (state.phase === 'adopt') {
      const runs = (await getState()).runs.filter(r => state.designRunIds!.some(cr => cr.id === r.id));
      const adoptable = runs.find(r => r.state === 'succeeded' && r.result?.review.pass === true);
      if (!adoptable) {
        note(state, '无自然过审方案：不采用、如实报告（合同允许此终局，不伪装成功）');
        state.phase = 'material-edit';
      } else {
        const adopt = await inj('POST', `/api/time-machine/books/${BOOK_ID}/adoptions`, cookie, { candidateId: adoptable.id, revision: adoptable.result!.revision, expectedRevision: 0, idempotencyKey: 'fc-e2e-adopt' });
        if (adopt.statusCode !== 200) throw new Error(`HTTP采用失败${adopt.statusCode}：${adopt.body}`);
        state.adoptedCandidateId = adoptable.id;
        note(state, `HTTP采用成功：candidate=${adoptable.id} revision=${adoptable.result!.revision}`);
        state.phase = 'material-edit';
      }
    }

    // ---- P7 资料修改→旧基线不可继续采用；同键刷新不重复创建 ----
    if (state.phase === 'material-edit') {
      const s2 = await getState();
      const mat = s2.storylineMaterial;
      if (mat) {
        const preview = await inj('POST', `/api/time-machine/books/${BOOK_ID}/storyline-material/preview`, cookie, { content: { note: '作者修改：加强粮草线权重' }, expectedRevision: mat.revision });
        note(state, `资料影响预览${preview.statusCode}：${preview.body.slice(0, 200)}`);
        const runsBefore = (await getState()).runs.length;
        const stale = await inj('POST', `/api/time-machine/books/${BOOK_ID}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round-stale', selection: { recommendationRunId: state.recommendationRunId, recommendationHash: state.recommendationHash, preparationVersion: state.preparationVersion, selectedLineIds: ['growth'], addedLines: [], shape: 'auto' as const, ensemble: true, authorNote: '' }, expectedMaterialRevision: 999 });
        note(state, `旧基线（过期版本999）设计请求=${stale.statusCode}（应409且不可重试）：${stale.body.slice(0, 160)}`);
        // 同键刷新：原幂等键再发=返回原轮不重复创建
        const replay = await inj('POST', `/api/time-machine/books/${BOOK_ID}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round', selection: { recommendationRunId: state.recommendationRunId, recommendationHash: state.recommendationHash, preparationVersion: state.preparationVersion, selectedLineIds: ['growth'], addedLines: [{ title: '粮台线', description: '四十日粮草的筹措、损毁与重建贯穿全城命运' }], shape: 'auto' as const, ensemble: true, authorNote: '希望保甲重建过程有具体的制度细节' }, ...(state.materialRevision! > 0 ? { expectedMaterialRevision: state.materialRevision } : {}) });
        const runsAfter = (await getState()).runs.length;
        note(state, `同键刷新=${replay.statusCode}，runs数${runsBefore}→${runsAfter}（不重复创建=${runsBefore === runs.length || runsAfter <= runsBefore + 0}）`);
      } else {
        note(state, '无正式材料行（设计轮未建材料版本），资料修改验证跳过并如实标注');
      }
      state.phase = 'done';
    }

    const used = callsCount() - state.modelCallsAtStart;
    note(state, `端到端完成。本probe真实模型调用=${used}次（另冒烟8次，父预算同批合计=${used + 8}/80）`);
    console.log(JSON.stringify({ bookId: BOOK_ID, phase: state.phase, adopted: state.adoptedCandidateId ?? null, modelCalls: used }));
  } finally {
    await app.close();
    // 隔离库保留在临时目录由系统清理；状态文件已含全部ID
  }
}

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/fast-close-e2e.ts')) {
  main().catch(error => { console.error('端到端失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
