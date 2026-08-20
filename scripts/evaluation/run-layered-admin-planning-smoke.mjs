import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loginEvaluationAccount } from './lib/evaluation-account.mjs';

const API = process.env.WENMI_VALIDATION_API ?? 'http://127.0.0.1:43111';
const ORIGIN = process.env.WENMI_VALIDATION_ORIGIN ?? 'http://127.0.0.1:43110';
const RUN_KEY = String(process.argv[2] ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, '-');
const OUTPUT = resolve(process.env.WENMI_VALIDATION_OUTPUT
  ?? `data/verification/layered-admin-planning-${RUN_KEY}.json`);
const POLL_MS = Number(process.env.WENMI_VALIDATION_POLL_MS ?? 250);
const TIMEOUT_MS = Number(process.env.WENMI_VALIDATION_TIMEOUT_MS ?? 120_000);
const noTemplate = (scope) => ({
  selectionMode: 'none', templateKey: null, templateVersion: null,
  templateHash: null, scope, beats: [], customDirection: null
});

let cookie = '';
const evidence = { schemaVersion: 'layered-admin-planning-smoke-v1', runKey: RUN_KEY,
  api: API, startedAt: new Date().toISOString(), checks: [] };

function record(name, details = {}) {
  evidence.checks.push({ name, at: new Date().toISOString(), ...details });
}
function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function request(path, { method = 'GET', body } = {}) {
  if (!cookie) cookie = await loginEvaluationAccount({ api: API, origin: ORIGIN });
  const headers = { cookie };
  if (method !== 'GET') Object.assign(headers, {
    origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json'
  });
  const response = await fetch(`${API}${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`${method} ${path} ${response.status}: ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.data;
}

async function waitTask(bookId, taskId, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
    if (['waiting_confirmation', 'succeeded'].includes(detail.task.status)) {
      record(label, { state: detail.task.status, phase: detail.task.currentPhase,
        modelCallCount: detail.modelCalls?.length ?? 0 });
      return detail;
    }
    if (['failed', 'blocked', 'cancelled', 'interrupted'].includes(detail.task.status)) {
      throw new Error(`${label} failed: ${detail.task.status}/${detail.task.errorCode ?? 'unknown'}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${label} timed out`);
}

async function waitGeneration(path, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const view = await request(path);
    if (view?.isCompleted) {
      assert(!('taskId' in view), `${label} leaked taskId`);
      assert(!('currentPhase' in view), `${label} leaked currentPhase`);
      record(label, { stateText: view.stateText, phaseText: view.phaseText,
        memberCount: view.members?.length ?? 0 });
      return view;
    }
    if (view && !view.isRunning && view.errorMessage) throw new Error(`${label}: ${view.errorMessage}`);
    await sleep(POLL_MS);
  }
  throw new Error(`${label} timed out`);
}

function openingBlueprint(taxonomyVersion) {
  return {
    styleIntent: { languageTones: ['自然有力'], emotionalTones: ['热血'],
      pacingAndPayoff: ['有效变化密集'], atmospheres: ['沉浸'], custom: [] },
    taxonomyVersion, channel: 'male', categoryKey: 'male-fantasy-brain',
    targetAudience: '喜欢人物主动选择、清晰代价和连续追读动力的男频读者',
    protagonists: [{ role: 'male_lead', name: '陆衡', age: '十九岁',
      background: '雾城最低阶的守门学徒，能听见旧城墙残留的回声。', personalities: ['冷静', '有责任感'] }],
    storyDirection: '陆衡从一次错误城门警报入手，发现雾城的安全规则正被人利用；他必须在失去身份与放任灾难之间作出选择。',
    worldBackground: '城邦依靠会记录誓言的城墙维持秩序，使用城墙力量必须付出记忆代价。',
    openingBackground: '雾城连续出现只有陆衡能听见的错误警报。',
    stageOne: { start: '错误警报把陆衡推到失职审判前。', development: '他主动核验警报并发现有人篡改誓言。', end: '他守住第一道城门，却失去守门学徒身份。' },
    fullBookOutline: '陆衡追查誓言体系被篡改的源头，并在一次次有代价的选择中重建城邦信任。',
    mainTags: ['玄幻', '成长'], auxiliaryTags: [], storyTraits: ['智斗'],
    customTags: ['城邦规则', '悬疑'], initialMap: '雾城南门、旧誓墙与守门人驻地。', mustFollow: ['力量必须有来源和代价']
  };
}

async function main() {
  const me = await request('/api/v1/auth/me');
  assert(me.role === 'admin', 'evaluation account is not the first administrator');
  record('管理员会话', { role: me.role });

  const taxonomy = await request('/api/v1/opening-taxonomy');
  const blueprint = openingBlueprint(taxonomy.version);
  const draft = await request('/api/v1/books/drafts', { method: 'POST', body: {
    title: `雾城回声-${RUN_KEY.slice(-4)}`, text: blueprint.storyDirection, openingBlueprint: blueprint
  } });
  const book = await request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST', body: { expectedVersion: draft.version }
  });
  const bookId = book.bookId;
  record('管理员开书', { bookId, kickoffTaskId: book.kickoffTaskId ?? null });
  assert(book.kickoffTaskId === null, 'opening unexpectedly started formal setting AI');

  const workspace = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
  const readiness = await request(`/api/v1/books/${bookId}/setting-baseline/readiness`);
  assert(readiness.required.length === 4, `expected four core settings, got ${readiness.required.length}`);
  const settingAnswers = {
    'world-foundation': '誓墙记录公开誓言，城邦秩序依赖可追溯的承诺与证据。',
    'protagonist-foundation': '陆衡谨慎但不逃避责任；他能听见誓墙回声，每次使用都会失去一段近期记忆。',
    'rules-costs': '任何力量都必须有可追溯来源；调用誓墙会损失近期记忆，不能临时免除。',
    'boundaries-blanks': '不写无代价升级；幕后篡改者的终极动机暂时留白，允许事件层逐步发现。'
  };
  for (const itemKey of readiness.required) {
    const item = workspace.find((candidate) => candidate.itemKey === itemKey);
    assert(item, `missing workspace item ${itemKey}`);
    await request(`/api/v1/books/${bookId}/setting-outline-workspace/${itemKey}`, { method: 'PUT', body: {
      groupTitle: item.groupTitle, label: item.label, prompt: item.prompt, sourceLabel: item.sourceLabel,
      status: '已确认', custom: item.custom, sortOrder: item.sortOrder,
      content: settingAnswers[itemKey] ?? `${item.label}只描述书籍骨架，不提前规定卷剧情。`
    } });
  }
  record('四项核心设定', { required: readiness.required });

  const audit = await request(`/api/v1/books/${bookId}/setting-baseline/quality-audit`, {
    method: 'POST', body: { idempotencyKey: `layered-admin-audit-${RUN_KEY}` }
  });
  await waitTask(bookId, audit.taskId, '设定主编质检');
  const planningBefore = await request(`/api/v1/books/${bookId}/planning-state`);
  const baseline = await request(`/api/v1/books/${bookId}/setting-baseline/confirm`, {
    method: 'POST', body: { expectedPlanningVersion: planningBefore.version }
  });
  record('设定基线确认', { stage: baseline.stage, version: baseline.version });

  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let plan = await request(`/api/v1/books/${bookId}/volume-plans`, { method: 'POST', body: {
    expectedWorkflowVersion: workflow.planningVersion, planNumber: 1,
    idempotencyKey: `layered-admin-volume-${RUN_KEY}`
  } });
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`, { method: 'POST', body: {
    expectedPlanRevision: plan.revision, expectedActiveVersionId: null,
    expectedWorkflowVersion: (await request(`/api/v1/books/${bookId}/workflow`)).planningVersion,
    template: noTemplate('volume'), authorInputRefs: [], idempotencyKey: `layered-admin-routes-${RUN_KEY}`
  } });
  await waitGeneration(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generation`, '卷双路线生成');
  const directions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/directions`);
  assert(directions.length === 2, `expected two routes, got ${directions.length}`);
  const chosen = directions[0];
  const selection = { selectionMode: 'whole', selectedProposalId: chosen.proposalId,
    selectedVersionId: chosen.volumeDirectionVersionId, fragments: [], authorNotes: '采用这条路线，由主编整理成确认稿。' };
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/route-selection`, {
    method: 'POST', body: { selection, idempotencyKey: `layered-admin-selection-${RUN_KEY}` }
  });
  plan = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`, { method: 'POST', body: {
    expectedPlanRevision: plan.revision, expectedActiveVersionId: plan.activeVersionId,
    expectedWorkflowVersion: workflow.planningVersion, template: noTemplate('volume'), authorInputRefs: [],
    selection, idempotencyKey: `layered-admin-fusion-${RUN_KEY}`
  } });
  await waitGeneration(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generation`, '作者选择后主编融合');
  const volumeVersions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`);
  const fusion = volumeVersions.filter((version) => version.candidateKind === 'fusion').at(-1);
  assert(fusion, 'volume fusion candidate missing');
  plan = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  plan = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/confirm`, { method: 'POST', body: {
    volumePlanVersionId: fusion.volumePlanVersionId, expectedPlanRevision: plan.revision,
    expectedActiveVersionId: plan.activeVersionId, expectedWorkflowVersion: workflow.planningVersion
  } });
  assert(plan.activeVersion.content.firstVolumeLaunch, 'first volume launch contract missing');
  record('首卷路线确认', { routeCount: directions.length, selectedProposalId: chosen.proposalId,
    hasFirstVolumeLaunch: true });

  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains/generate`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion,
      idempotencyKey: `layered-admin-chain-${RUN_KEY}` }
  });
  await waitGeneration(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains/generation`, '事件链生成');
  const chains = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains`);
  const chain = chains.filter((candidate) => candidate.status === 'candidate').at(-1);
  assert(chain, 'event chain candidate missing');
  assert(new Set(chain.content.events.flatMap((event) => event.firstVolumeResponsibilities)).size === 7,
    'first-volume event responsibilities are incomplete');
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains/${chain.id}/confirm`, {
    method: 'POST', body: {}
  });
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const eventSequence = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-sequence/initialize`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion,
      idempotencyKey: `layered-admin-event-sequence-${RUN_KEY}` }
  });
  const event = eventSequence.events[0];
  record('事件链确认并拆事件', { eventCount: eventSequence.events.length, firstEventId: event.eventId });

  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/generate`, { method: 'POST', body: {
    expectedEventRevision: event.revision, expectedActiveVersionId: event.activeVersionId,
    expectedWorkflowVersion: workflow.planningVersion, template: noTemplate('event'), authorInputRefs: [],
    idempotencyKey: `layered-admin-event-${RUN_KEY}`
  } });
  await waitGeneration(`/api/v1/books/${bookId}/story-events/${event.eventId}/generation`, '第一事件设计');
  const eventVersions = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`);
  const eventFusion = eventVersions.filter((version) => version.candidateKind === 'fusion').at(-1);
  assert(eventFusion, 'event fusion candidate missing');
  const currentEvents = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-sequence`);
  const currentEvent = currentEvents.events[0];
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/confirm`, { method: 'POST', body: {
    versionId: eventFusion.storyEventVersionId, expectedEventRevision: currentEvent.revision,
    expectedWorkflowVersion: workflow.planningVersion
  } });
  record('第一事件确认', { candidateCount: eventVersions.length });

  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let chapterSequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/initialize`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion,
      idempotencyKey: `layered-admin-chapter-init-${RUN_KEY}` }
  });
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generate`, { method: 'POST', body: {
    expectedSequenceRevision: chapterSequence.revision, expectedWorkflowVersion: workflow.planningVersion,
    authorInputRefs: [], idempotencyKey: `layered-admin-chapter-sequence-${RUN_KEY}`
  } });
  await waitGeneration(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generation?kind=sequence`, '黄金三章与事件章链');
  chapterSequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  const sequenceCandidate = chapterSequence.versions.filter((version) => version.status === 'candidate').at(-1);
  assert(sequenceCandidate, 'chapter sequence candidate missing');
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  chapterSequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/confirm`, {
    method: 'POST', body: { sequenceVersionId: sequenceCandidate.sequenceVersionId,
      expectedSequenceRevision: chapterSequence.revision, expectedWorkflowVersion: workflow.planningVersion }
  });
  const firstPlanned = chapterSequence.outlines[0];
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/generate`, { method: 'POST', body: {
    count: 1, expectedSequenceRevision: chapterSequence.revision,
    expectedWorkflowVersion: workflow.planningVersion, authorInputRefs: [],
    idempotencyKey: `layered-admin-chapter-detail-${RUN_KEY}`
  } });
  await waitGeneration(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generation?kind=details`, '第一章详细章纲');
  chapterSequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  const firstOutline = chapterSequence.outlines.find((outline) => outline.outlineId === firstPlanned.outlineId);
  const outlineCandidate = firstOutline.versions.filter((version) => version.status === 'candidate').at(-1);
  assert(outlineCandidate, 'first chapter outline candidate missing');
  assert(outlineCandidate.content.firstChapterLaunch, 'first chapter launch contract missing');
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/freeze`, {
    method: 'POST', body: { items: [{ outlineId: firstOutline.outlineId,
      outlineVersionId: outlineCandidate.outlineVersionId, expectedOutlineRevision: firstOutline.revision }],
      expectedWorkflowVersion: workflow.planningVersion }
  });
  record('第一章章纲冻结', { chapterNumber: firstOutline.chapterNumber,
    hasFirst500Contract: true, chapterCount: chapterSequence.outlines.length });

  evidence.bookId = bookId;
  evidence.finishedAt = new Date().toISOString();
  evidence.result = 'passed';
  mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ result: 'passed', bookId, output: OUTPUT, checks: evidence.checks.length }));
}

main().catch((error) => {
  evidence.finishedAt = new Date().toISOString();
  evidence.result = 'failed';
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.error(evidence.error);
  process.exitCode = 1;
});
