#!/usr/bin/env tsx
/**
 * S1-FAST-CLOSE隔离新书端到端（合同步骤4-5）：
 *   tsx scripts/evaluation/fast-close-e2e.ts --book fc-e2e-book-1
 * 固定隔离库（.local/eval/fast-close-runtime）+真实模型通道+真实HTTP（app.inject）：
 * 设定完成→故事线推荐→结构化确认→三方案全书设计→真实异模型审查（必要修订走现有一次流程）
 * →自然通过→HTTP采用；资料页可看可改、过期版本409、同键刷新不重复创建。
 * 断点：阶段状态写 .local/eval/fast-close-e2e-state.json，重跑从已完成阶段继续（幂等键固定）。
 * 父预算：与冒烟共用 s1-fast-close 80请求/300万token/4小时（按model_calls计数自查，超限即停）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import { V7AgentGovernanceRepository } from '../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { readReleaseId } from '../../apps/api/src/infrastructure/project-root.js';
import type { RuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const BOOK_KEY = process.argv.includes('--book') ? process.argv[process.argv.indexOf('--book') + 1]! : 'fc-e2e-book-1';
const STATE_PATH = '.local/eval/fast-close-e2e-state.json';
const PARENT_BUDGET = { requests: 80, tokens: 3_000_000, wallClockHours: 4, startedAt: '2026-09-17T02:33:18Z' };
const SMOKE_SPENT = 21; // 冒烟三轮+8000复验在父账本已耗（19实际+2未知）
const TARGET_WORDS = 600000;

type Phase = 'setup' | 'members' | 'setting' | 'material' | 'recommend' | 'design' | 'adopt' | 'material-edit' | 'done';
interface E2EState {
  phase: Phase; ownerId?: string; ownerEmail?: string; bookId?: string; materialRevision?: number;
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
  const root = resolve('.local/eval/fast-close-runtime');
  const dataDir = resolve(root, 'data');
  mkdirSync(resolve(dataDir, 'database'), { recursive: true });
  const config: RuntimeConfig = {
    apiHost: '127.0.0.1', apiPort: 43111, dataDir,
    databasePath: resolve(dataDir, 'database', 'wenmi.sqlite'),
    projectRoot: process.cwd(), releaseId: readReleaseId(process.cwd()),
    ownerId: 'owner-local-boss', webOrigin: 'http://127.0.0.1:43110', adminOrigin: null,
    workerToken: 'fast-close-worker-token-00000000000000000000000000',
    promptViewPassword: 'fast-close-prompt-view',
    modelRuntime: loadModelRuntimeConfig(), publicOrigin: null
  };
  const database: DatabaseSync = openDatabase(config.databasePath);
  bootstrapDatabase(database, config);
  const app = await createAppServer(config, database, { timeMachineWindowTokens: 64000 });
  const headers = { host: '127.0.0.1:43111', origin: config.webOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const callsCount = (): number => (database.prepare('SELECT COUNT(*) AS n FROM model_calls').get() as { n: number }).n;
  const budgetCheck = (): void => {
    const used = callsCount() - state.modelCallsAtStart + SMOKE_SPENT;
    const elapsedH = (Date.now() - Date.parse(PARENT_BUDGET.startedAt)) / 3600_000;
    if (used >= PARENT_BUDGET.requests) throw new Error(`父预算请求硬停：已用约${used}/${PARENT_BUDGET.requests}`);
    if (elapsedH >= PARENT_BUDGET.wallClockHours) throw new Error(`父预算墙钟硬停：已用${elapsedH.toFixed(1)}小时/${PARENT_BUDGET.wallClockHours}`);
  };
  const inj = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: unknown) =>
    app.inject({ method, url, headers: { ...headers, cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const bookIdOf = (): string => state.bookId ?? BOOK_KEY;
  const waitFor = async (check: () => Promise<boolean>, what: string, timeoutMs = 15 * 60_000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) { budgetCheck(); if (await check()) return; await new Promise(r => setTimeout(r, 3000)); }
    const rows = database.prepare('SELECT id,kind,scheme,state,error_code,error_message,phase FROM tm2_design_runs WHERE book_id=?').all(bookIdOf());
    throw new Error(`等待超时：${what}；runs=${JSON.stringify(rows)}`);
  };

  try {
    // ---- P0 setup：注册作者、V7开书包建书（真实HTTP，time-machine与设定共用此书）----
    let cookie = '';
    if (state.phase === 'setup') {
      state.modelCallsAtStart = callsCount();
      const email = `fc-e2e-${Date.now()}@example.com`;
      const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email, displayName: '端到端隔离作者', password: 'Strong-test-pass-123!' } });
      if (reg.statusCode !== 200) throw new Error(`注册失败：${reg.body}`);
      cookie = String(reg.headers['set-cookie']).split(';')[0]!;
      const ownerId = String((database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get(email) as { owner_id: string }).owner_id);
      const openingPackage = {
        title: '孤城保甲',
        positioning: {
          publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['成长'],
          coreAppeal: '现代组织方法在古代守城战中证明制度的力量。', targetReaders: '喜欢长篇成长和制度流的男频读者',
          expectedTotalWords: TARGET_WORDS, volumePlan: { minimum: 4, recommended: 6, maximum: 8 },
          retentionPositioning: '开篇快速建立围城处境，逐卷兑现保甲重建与三大矛盾化解。'
        },
        backgrounds: { eraAndWorld: '南宋末年边城：蒙古大军压境，城内保甲废弛、粮仓空虚、豪强各自为政', openingSituation: '沈恪在城头醒来，城外连营十里' },
        protagonists: [{ name: '沈恪', age: '28岁', identity: '现代历史学者穿越者', background: '现代组织方法研究者', familyBackground: '普通出身', careerBackground: '', goldenFinger: '现代组织与制度知识', goal: '在四十日粮草内守住孤城', dilemma: '守将不信制度只信私兵、豪强抵制编户', personality: ['谨慎', '务实'], boundary: '不以未来知识直接变出物资' }],
        opening: { startingSituation: '城头醒来，城外连营十里', incitingIncident: '接手保甲册发现三分之一名字已不在城中', immediateConflict: '守将不信制度只信私兵', readerPromise: '看组织方法而非蛮勇守城' },
        longTermDirection: { centralConflict: '制度与旧秩序的冲突', progression: '从重建保甲到制度被全军承认', relationshipDirection: '逐步赢得守将、民众与同僚信任', storyPotential: '三大矛盾逐卷升级化解' },
        possibleEnding: { direction: '制度力量被证明并可外推', price: '承担真实代价', openness: '保留续卷空间' },
        authorNotes: [], mustFollow: ['轻松向，不虐主', '不得让对抗线中途消失']
      };
      const createBook = await inj('POST', '/api/v1/v7/opening-books', cookie, { openingPackage, idempotencyKey: BOOK_KEY });
      if (createBook.statusCode !== 200) throw new Error(`V7建书失败：${createBook.body}`);
      state.ownerId = ownerId; state.ownerEmail = email;
      state.bookId = String((createBook.json().data as { bookId: string }).bookId);
      state.phase = 'members'; note(state, `V7建书完成 owner=${ownerId} book=${state.bookId}`);
    } else {
      const login = await inj('POST', '/api/v1/auth/login', cookie, { email: state.ownerEmail, password: 'Strong-test-pass-123!' });
      if (login.statusCode !== 200) throw new Error(`登录失败：${login.body}`);
      cookie = String(login.headers['set-cookie']).split(';')[0]!;
    }
    const bookId = bookIdOf();

    // ---- P1 装配实验组合（治理仓储直改=隔离装配，非真实链路；审查者≠各生成节点模型）----
    const registry = new V7AgentGovernanceRepository(database);
    registry.ensureSeeded(now());
    let designMemberKey = 'planner-deepseek-v4-pro';
    if (state.phase === 'members') {
      const bind = (memberKey: string, modelProfileKey: string): void => {
        try {
          registry.updateCandidateSlot({ memberKey, modelProfileKey, expectedRevision: registry.snapshot().revision, actorId: 'k3-fast-close', eventId: randomUUID(), reason: 'S1-FAST-CLOSE隔离实验组合装配', now: now() });
        } catch {
          registry.updateMember({ memberKey, expectedRevision: registry.snapshot().revision, modelProfileKey, actorId: 'k3-fast-close', eventId: randomUUID(), reason: 'S1-FAST-CLOSE隔离实验组合装配', now: now() });
        }
        note(state, `成员绑定 ${memberKey} → ${modelProfileKey}`);
      };
      const roster = registry.snapshot().members.filter(m => m.enabled && m.model.plan !== 'image');
      const byRole = (role: string) => roster.filter(m => m.fixedRoleKey === role).sort((a, b) => Number(b.defaultForRole) - Number(a.defaultForRole) || a.fallbackPriority - b.fallbackPriority);
      const deputy = byRole('deputy_editor')[0];
      if (deputy) bind(deputy.memberKey, 'deepseek-v4-flash'); // 资料卡（card-extract/finalize有效成绩第1）
      const writers = byRole('planning_writer');
      const writerModels = ['deepseek-v4-pro', 'doubao-seed-2.1-turbo', 'glm-5.3-flash']; // 骨架第1/卷卡第1/合并第1
      writers.slice(0, 3).forEach((m, i) => bind(m.memberKey, writerModels[i]!));
      const chiefs = byRole('chief_editor');
      if (chiefs[0]) bind(chiefs[0].memberKey, 'kimi-k2.7-code'); // 审查实验候选（k3按既定规则不进时光机岗位）
      designMemberKey = writers[0]?.memberKey ?? designMemberKey;
      state.phase = 'setting';
      note(state, `装配完成：deputy=${deputy?.memberKey ?? '无'} writers=${writers.slice(0, 3).map(m => m.memberKey).join(',')} chiefs=${chiefs.map(m => m.memberKey).join(',')}`);
    } else {
      const writers = registry.snapshot().members.filter(m => m.enabled && m.fixedRoleKey === 'planning_writer');
      designMemberKey = writers[0]?.memberKey ?? designMemberKey;
    }

    // ---- 状态读取（time-machine state，P2起各阶段共用）----
    const getState = async () => (await inj('GET', `/api/time-machine/books/${bookId}/state`, cookie)).json().data as {
      runs: { id: string; kind: string; state: string; roundKey: string | null; recommendationHash?: string | null; preparationVersion?: string | null; result: { revision: number; review: { pass: boolean } } | null }[];
      adopted: unknown; storylineMaterial?: { revision: number } | null; preparation?: { ready?: boolean; version?: string | null };
    };

    // ---- P2 设定完成（真实模型：设定批次设计→确认→主编总清单统一整理）----
    if (state.phase === 'setting') {
      const readyNow = (await getState()).preparation?.ready === true;
      if (!readyNow) {
        const batch = await inj('POST', `/api/v1/v7/books/${bookId}/setting-batches`, cookie, { selectedItemKeys: ['world-stage'], designMemberKey, idempotencyKey: 'fc-e2e-setting-batch' });
        if (batch.statusCode !== 200) throw new Error(`设定批次创建失败：${batch.body}`);
        const batchId = (batch.json().data as { batchId: string }).batchId;
        let view: { status: string; items?: { itemKey: string; revision: number }[] } | null = null;
        await waitFor(async () => {
          const r = await inj('GET', `/api/v1/v7/books/${bookId}/setting-batches/${batchId}`, cookie);
          if (r.statusCode === 200) { view = r.json().data as typeof view; return !['queued', 'working'].includes(view!.status); }
          return false;
        }, '设定批次完成');
        if (!view || !['awaiting_author', 'completed'].includes((view as { status: string }).status)) throw new Error(`设定批次未成功：${JSON.stringify(view)}`);
        const items = ((view as { items?: { itemKey: string; revision: number }[] }).items ?? []).map(i => ({ itemKey: i.itemKey, expectedRevision: i.revision }));
        const confirm = await inj('POST', `/api/v1/v7/books/${bookId}/setting-items/confirm-all`, cookie, { items });
        if (confirm.statusCode !== 200) throw new Error(`设定确认失败：${confirm.body}`);
        note(state, `设定批次${batchId}完成并确认${items.length}项`);
      }
      // 主编总清单统一整理（final review，真实模型调用）
      const review = await inj('POST', `/api/v1/v7/books/${bookId}/setting-final-reviews`, cookie, { idempotencyKey: 'fc-e2e-setting-review' });
      if (![200, 201, 202, 409].includes(review.statusCode)) throw new Error(`总清单整理发起失败${review.statusCode}：${review.body}`);
      await waitFor(async () => (await getState()).preparation?.ready === true, '设定总清单整理完成', 20 * 60_000);
      note(state, '设定总清单统一整理完成，时光机前置就绪');
      state.phase = 'material';
    }

    // ---- P3 资料可看（初始材料态）----
    if (state.phase === 'material') {
      const s0 = await getState();
      note(state, `资料页可看：初始材料态=${JSON.stringify(s0.storylineMaterial ?? null)}；设定就绪=${JSON.stringify(s0.preparation ?? null)}`);
      state.phase = 'recommend';
    }

    // ---- P4 故事线推荐（真实模型）----
    if (state.phase === 'recommend') {
      const intent = `作者选择：主线为「沈恪的核心成长线」，贯穿线「守将不信制度只信私兵、豪强抵制编户、粮草只够四十日的对抗线」。目标体量60万字，轻松向，不虐主，不得让对抗线中途消失。`;
      const rec = await inj('POST', `/api/time-machine/books/${bookId}/recommendation-runs`, cookie, { intent, idempotencyKey: 'fc-e2e-rec' });
      if (rec.statusCode !== 202) throw new Error(`推荐创建失败：${rec.body}`);
      await waitFor(async () => (await getState()).runs.some(r => r.kind === 'recommend' && r.state === 'succeeded'), '推荐完成');
      const recRun = (await getState()).runs.find(r => r.kind === 'recommend' && r.state === 'succeeded')!;
      state.recommendationRunId = recRun.id;
      state.recommendationHash = String(recRun.recommendationHash);
      state.preparationVersion = String(recRun.preparationVersion);
      state.phase = 'design'; note(state, `推荐完成 run=${recRun.id} pv=${state.preparationVersion}`);
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
      const ds = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round', selection, ...(materialRevision > 0 ? { expectedMaterialRevision: materialRevision } : {}) });
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
        const adopt = await inj('POST', `/api/time-machine/books/${bookId}/adoptions`, cookie, { candidateId: adoptable.id, revision: adoptable.result!.revision, expectedRevision: 0, idempotencyKey: 'fc-e2e-adopt' });
        if (adopt.statusCode !== 200) throw new Error(`HTTP采用失败${adopt.statusCode}：${adopt.body}`);
        state.adoptedCandidateId = adoptable.id;
        note(state, `HTTP采用成功：candidate=${adoptable.id} revision=${adoptable.result!.revision}`);
        state.phase = 'material-edit';
      }
    }

    // ---- P7 资料修改：过期版本409+同键刷新不重复创建 ----
    if (state.phase === 'material-edit') {
      const s2 = await getState();
      const mat = s2.storylineMaterial;
      const runsBefore = (await getState()).runs.length;
      if (mat) {
        const preview = await inj('POST', `/api/time-machine/books/${bookId}/storyline-material/preview`, cookie, { content: { note: '作者修改：加强粮草线权重' }, expectedRevision: mat.revision });
        note(state, `资料影响预览${preview.statusCode}：${preview.body.slice(0, 200)}`);
      }
      const stale = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round-stale', selection: { recommendationRunId: state.recommendationRunId, recommendationHash: state.recommendationHash, preparationVersion: state.preparationVersion, selectedLineIds: ['growth'], addedLines: [], shape: 'auto' as const, ensemble: true, authorNote: '' }, expectedMaterialRevision: 999 });
      note(state, `过期版本999设计请求=${stale.statusCode}（应409且不可重试）：${stale.body.slice(0, 160)}`);
      const replay = await inj('POST', `/api/time-machine/books/${bookId}/design-runs`, cookie, { idempotencyKey: 'fc-e2e-round', selection: { recommendationRunId: state.recommendationRunId, recommendationHash: state.recommendationHash, preparationVersion: state.preparationVersion, selectedLineIds: ['growth'], addedLines: [{ title: '粮台线', description: '四十日粮草的筹措、损毁与重建贯穿全城命运' }], shape: 'auto' as const, ensemble: true, authorNote: '希望保甲重建过程有具体的制度细节' }, ...(state.materialRevision! > 0 ? { expectedMaterialRevision: state.materialRevision } : {}) });
      const runsAfter = (await getState()).runs.length;
      note(state, `同键刷新=${replay.statusCode}，runs数${runsBefore}→${runsAfter}（不重复创建=${runsAfter === runsBefore}）`);
      state.phase = 'done';
    }

    const used = callsCount() - state.modelCallsAtStart;
    note(state, `端到端完成。本probe真实模型调用=${used}次（父预算同批合计=${used + SMOKE_SPENT}/80）`);
    console.log(JSON.stringify({ bookId, phase: state.phase, adopted: state.adoptedCandidateId ?? null, modelCalls: used }));
  } finally {
    await app.close();
    database.close();
  }
}

if (process.argv[1]?.replace(/\\/gu, '/').endsWith('/scripts/evaluation/fast-close-e2e.ts')) {
  main().catch(error => { console.error('端到端失败：', error instanceof Error ? error.message : error); process.exit(1); });
}
