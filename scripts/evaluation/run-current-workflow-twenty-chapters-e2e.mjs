import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loginEvaluationAccount } from './lib/evaluation-account.mjs';
import { join, resolve } from 'node:path';
import { requireWorkflowScenario } from './current-workflow-scenarios.mjs';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const RUN_KEY = String(process.argv[2] ?? 'nightly-v2').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const SCENARIO = requireWorkflowScenario(String(process.argv[3] ?? 'xianxia').trim().toLowerCase());
const EVENT_COUNT = SCENARIO.events.length;
const CHAPTERS_PER_EVENT = 10;
const TOTAL_CHAPTERS = EVENT_COUNT * CHAPTERS_PER_EVENT;
const TEST_ID = `E2E-CURRENT-WORKFLOW-${TOTAL_CHAPTERS}-${SCENARIO.key.toUpperCase()}-${RUN_KEY.toUpperCase()}`;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const TEST_TOKEN_LIMIT = 25_000_000;
const ROOT = resolve(`data/verification/current-workflow-${TOTAL_CHAPTERS}-chapters-${SCENARIO.key}-${RUN_KEY}`);
const STATE_FILE = join(ROOT, 'state.json');
const EVENT_FILE = join(ROOT, 'run-events.ndjson');
const ISSUE_FILE = join(ROOT, 'issues.md');
const FINAL_FILE = join(ROOT, 'final-evidence.json');

mkdirSync(ROOT, { recursive: true });

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : {
      testId: TEST_ID,
      scenario: SCENARIO.key,
      releaseId: RELEASE_ID,
      createdAt: new Date().toISOString(),
      settledChapters: [],
      taskEvidence: []
    };

let cookie = '';
let activePhase = 'startup';
const terminalFailures = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);
const noneTemplate = (scope) => ({
  selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
  scope, beats: [], customDirection: null
});

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function key(label) { return `${TEST_ID}:${label}`; }
function log(event, details = {}) {
  const entry = { at: now(), event, ...details };
  appendFileSync(EVENT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(JSON.stringify(entry));
}
function save(patch = {}) {
  Object.assign(state, patch, { updatedAt: now() });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
function issue(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  appendFileSync(ISSUE_FILE, `\n## ${now()} — ${activePhase}\n\n\`\`\`text\n${message}\n\`\`\`\n`, 'utf8');
  save({ stoppedAtPhase: activePhase, lastError: message.slice(0, 4_000) });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function issueSession() {
  cookie = await loginEvaluationAccount({ api: API, origin: ORIGIN });
}

async function request(path, { method = 'GET', body } = {}) {
  if (cookie.length === 0) await issueSession();
  const headers = { cookie };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['sec-fetch-site'] = 'same-site';
    headers['content-type'] = 'application/json';
  }
  let response = await fetch(`${API}${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (response.status === 401) {
    await issueSession();
    headers.cookie = cookie;
    response = await fetch(`${API}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch {
    throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok || payload.error !== undefined) {
    const detail = payload.error === undefined
      ? JSON.stringify(payload)
      : `${payload.error.code}: ${payload.error.message} ${JSON.stringify(payload.error.details ?? {})}`;
    throw new Error(`${method} ${path} failed ${response.status}: ${detail}`);
  }
  return payload.data;
}

function modelCallSummary(call) {
  return {
    modelCallId: call.model_call_id ?? call.modelCallId ?? null,
    agentId: call.agent_id ?? call.agentId ?? null,
    roleKey: call.role_key ?? call.roleKey ?? null,
    provider: call.provider ?? null,
    modelId: call.model_id ?? call.modelId ?? null,
    state: call.state ?? null,
    purpose: call.purpose ?? null,
    inputTokens: call.input_tokens ?? call.inputTokens ?? null,
    outputTokens: call.output_tokens ?? call.outputTokens ?? null
  };
}

function recordTask(purpose, detail) {
  const record = {
    purpose,
    taskId: detail.task.taskId,
    taskType: detail.task.taskType,
    status: detail.task.status,
    currentPhase: detail.task.currentPhase,
    modelCalls: (detail.modelCalls ?? []).map(modelCallSummary),
    contextPackCount: Array.isArray(detail.contextPacks) ? detail.contextPacks.length : null,
    completedAt: now()
  };
  const taskEvidence = [...(state.taskEvidence ?? []).filter((item) => item.taskId !== record.taskId), record];
  save({ taskEvidence });
  return record;
}

async function waitForTask(bookId, taskId, purpose) {
  const startedAt = Date.now();
  let signature = '';
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
    const task = detail.task;
    const working = (detail.modelCalls ?? [])
      .filter((call) => call.state === 'working')
      .map((call) => `${call.provider}/${call.model_id ?? call.modelId}`);
    const nextSignature = `${task.status}:${task.currentPhase}:${working.join(',')}`;
    if (nextSignature !== signature) {
      log('task_progress', { purpose, taskId, status: task.status, phase: task.currentPhase, workingModels: working });
      signature = nextSignature;
    }
    if (task.status === 'waiting_confirmation' || task.status === 'succeeded') {
      recordTask(purpose, detail);
      return detail;
    }
    if (terminalFailures.has(task.status)) {
      recordTask(purpose, detail);
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${purpose} task ${taskId} exceeded ${TASK_TIMEOUT_MS / 60_000} minutes`);
}

function blueprint(taxonomyVersion) {
  return SCENARIO.openingBlueprint(taxonomyVersion);
}

function answerFor(item, attempt = 1) {
  return SCENARIO.answerFor(item, attempt);
}

async function createBook() {
  if (state.bookId) return state.bookId;
  activePhase = 'create-book';
  const taxonomy = await request('/api/v1/opening-taxonomy');
  const openingBlueprint = blueprint(taxonomy.version);
  const title = SCENARIO.bookTitle;
  const draft = await request('/api/v1/books/drafts', {
    method: 'POST', body: { title, text: openingBlueprint.storyDirection, openingBlueprint }
  });
  const created = await request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST', body: { expectedVersion: draft.version }
  });
  assert(created.agentCount === 11, `expected 11 creative agents, got ${created.agentCount}`);
  save({ bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId, agentCount: created.agentCount });
  log('book_created', { bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId, agentCount: created.agentCount });
  if (created.kickoffTaskId) await waitForTask(created.bookId, created.kickoffTaskId, 'opening-reception');
  return created.bookId;
}

async function ensureTestBudget(bookId) {
  activePhase = 'test-budget';
  const budgets = await request(`/api/v1/books/${bookId}/budgets`);
  const active = budgets.find((budget) => budget.status === 'active') ?? budgets[0];
  assert(active, 'new book did not create a budget');
  if (active.token_limit >= TEST_TOKEN_LIMIT) return;
  const revised = await request(`/api/v1/books/${bookId}/budgets/${active.budget_id}`, {
    method: 'PATCH', body: { expectedTokenLimit: active.token_limit, tokenLimit: TEST_TOKEN_LIMIT }
  });
  assert(revised.cashLimitMicros === 0, 'test must not enable cash fallback');
  log('test_budget_revised', { budgetId: active.budget_id, tokenLimit: revised.tokenLimit, cashLimitMicros: revised.cashLimitMicros });
}

async function completeSettings(bookId) {
  if (state.settingsCompleted) return;
  activePhase = 'setting-outline';
  const readiness = await request(`/api/v1/books/${bookId}/setting-baseline/readiness`);
  for (const itemKey of readiness.required) {
    let items = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    let item = items.find((candidate) => candidate.itemKey === itemKey);
    assert(item, `required setting item ${itemKey} is missing from workspace`);
    if (item.status === '已确认') continue;

    const authorInput = await createIdea(bookId, {
      surface: 'setting', subjectType: 'setting_module', subjectId: item.itemKey,
      originalText: answerFor(item), scopeNotes: `用于“${item.label}”三席方案与融合`,
      idempotencyLabel: `setting-${item.itemKey}-idea`
    });
    const panel = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/start`, {
      method: 'POST', body: {
        authorInputId: authorInput.authorInputId,
        idempotencyKey: key(`setting-${item.itemKey}-panel`)
      }
    });
    await waitForTask(bookId, panel.taskId, `setting-${item.itemKey}-three-proposals`);
    const collaboration = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration`);
    const proposals = collaboration.panel?.proposals ?? [];
    assert(proposals.length === 3, `${item.itemKey} expected three independent proposals, got ${proposals.length}`);
    assert(new Set(proposals.map((proposal) => proposal.agentId)).size === 3,
      `${item.itemKey} proposals do not come from three distinct members`);
    log('setting_proposals_ready', {
      itemKey: item.itemKey,
      members: proposals.map((proposal) => ({ agentId: proposal.agentId, modelProvider: proposal.modelProvider, modelId: proposal.modelId }))
    });

    const synthesis = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/synthesize`, {
      method: 'POST', body: {
        proposalIds: proposals.map((proposal) => proposal.proposalId),
        authorInputId: authorInput.authorInputId,
        idempotencyKey: key(`setting-${item.itemKey}-synthesis`)
      }
    });
    const synthesisDetail = await request(`/api/v1/books/${bookId}/tasks/${synthesis.taskId}`);
    if (terminalFailures.has(synthesisDetail.task.status)) {
      await request(`/api/v1/books/${bookId}/tasks/${synthesis.taskId}/retry`, { method: 'POST', body: {} });
      log('setting_synthesis_retried', {
        itemKey: item.itemKey, taskId: synthesis.taskId, previousStatus: synthesisDetail.task.status
      });
    }
    await waitForTask(bookId, synthesis.taskId, `setting-${item.itemKey}-editor-synthesis`);
    items = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    item = items.find((candidate) => candidate.itemKey === itemKey);
    assert(item?.status === '候选待确认' && typeof item.content === 'string' && item.content.trim().length > 0,
      `${itemKey} synthesis did not produce a confirmable setting candidate`);
    const confirmed = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}`, {
      method: 'PUT', body: {
        groupTitle: item.groupTitle, label: item.label, prompt: item.prompt,
        sourceLabel: item.sourceLabel, status: '已确认', custom: item.custom,
        sortOrder: item.sortOrder, content: item.content
      }
    });
    assert(confirmed.status === '已确认', `${itemKey} did not become confirmed`);
    log('setting_confirmed', { itemKey: confirmed.itemKey, sourceDiscussionId: confirmed.sourceDiscussionId });
  }

  const ready = await request(`/api/v1/books/${bookId}/setting-baseline/readiness`);
  assert(ready.ready, `setting baseline is not ready: ${JSON.stringify({ missing: ready.missing, unresolved: ready.unresolved })}`);
  const workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmedBaseline = await request(`/api/v1/books/${bookId}/setting-baseline/confirm`, {
    method: 'POST', body: { expectedPlanningVersion: workflow.planningVersion }
  });
  assert(confirmedBaseline.stage === 'setting_ready', `setting baseline ended as ${confirmedBaseline.stage}`);
  const completedWorkflow = await request(`/api/v1/books/${bookId}/workflow`);
  save({ settingsCompleted: true, workflowAfterSettings: completedWorkflow });
  log('settings_ready', { stage: completedWorkflow.stage, planningVersion: completedWorkflow.planningVersion });
}

async function createIdea(bookId, input) {
  const created = await request(`/api/v1/books/${bookId}/author-planning-inputs`, {
    method: 'POST', body: {
      intentStrength: 'must', attachmentRefs: [], mentionedAgentIds: [], scopeNotes: null,
      idempotencyKey: key(input.idempotencyLabel), ...input
    }
  });
  log('author_idea_saved', {
    authorInputId: created.authorInputId, surface: created.surface, subjectType: created.subjectType,
    subjectId: created.subjectId, intentStrength: created.intentStrength
  });
  return created;
}

function forceExactEventPlan(content) {
  const first = content.eventSequence[0];
  assert(first, 'generated volume plan has no event');
  return { ...content, ...SCENARIO.volumeContent(first) };
}

async function planVolume(bookId) {
  activePhase = 'volume-plan';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  let plan = plans.find((item) => item.volumePlanId === state.volumePlanId) ?? plans.at(-1) ?? null;
  if (plan === null) {
    plan = await request(`/api/v1/books/${bookId}/volume-plans`, {
      method: 'POST', body: {
        expectedWorkflowVersion: workflow.planningVersion, planNumber: 1,
        idempotencyKey: key('volume-plan-1')
      }
    });
    save({ volumePlanId: plan.volumePlanId });
    log('volume_plan_created', { volumePlanId: plan.volumePlanId, revision: plan.revision });
  }
  if (plan.activeVersionId !== null) return plan;
  let ideaId = state.volumeIdeaId;
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'volume_plan', subjectType: 'volume_plan', subjectId: plan.volumePlanId,
      originalText: SCENARIO.volumeIdea,
      idempotencyLabel: 'volume-idea'
    });
    ideaId = idea.authorInputId;
    save({ volumeIdeaId: ideaId });
  }
  if (!state.volumeGenerationTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    const generation = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`, {
      method: 'POST', body: {
        expectedPlanRevision: plan.revision, expectedActiveVersionId: plan.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('volume'),
        authorInputRefs: [ideaId], idempotencyKey: key('volume-generate')
      }
    });
    save({ volumeGenerationTaskId: generation.taskId });
    log('volume_generation_started', { taskId: generation.taskId, members: generation.members });
  }
  await waitForTask(bookId, state.volumeGenerationTaskId, 'volume-candidates-and-editor');
  let versions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`);
  const candidates = ['candidate_a', 'candidate_b', 'fusion'].map((kind) => versions.find((item) => item.candidateKind === kind));
  assert(candidates.every(Boolean), 'volume generation did not create A, B and fusion candidates');
  const sources = candidates.slice(0, 2).map((item) => `${item.sourceTaskId}:${item.contentHash}`);
  assert(new Set(sources).size === 2, 'volume A and B candidates are not independently traceable');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'volume fusion candidate missing');
  if (selected.content.eventSequence.length !== EVENT_COUNT
    || selected.content.eventSequence.some((event) => event.estimatedChapterRange?.likely !== CHAPTERS_PER_EVENT)) {
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    selected = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`, {
      method: 'POST', body: {
        expectedPlanRevision: plan.revision, candidateKind: 'author_edit',
        parentVersionId: selected.volumePlanVersionId, sourceTaskId: state.volumeGenerationTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('volume'),
        content: forceExactEventPlan(selected.content), idempotencyKey: key('volume-author-final')
      }
    });
    log('volume_author_adjustment_saved', { volumePlanVersionId: selected.volumePlanVersionId, reason: `${SCENARIO.key}-${EVENT_COUNT}-event-${TOTAL_CHAPTERS}-chapter-test-scope` });
  }
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/impact-preview`, {
    method: 'POST', body: { volumePlanVersionId: selected.volumePlanVersionId }
  });
  plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmed = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/confirm`, {
    method: 'POST', body: {
      volumePlanVersionId: selected.volumePlanVersionId, expectedPlanRevision: plan.revision,
      expectedActiveVersionId: plan.activeVersionId, expectedWorkflowVersion: workflow.planningVersion
    }
  });
  assert(confirmed.activeVersion?.content.eventSequence.length === EVENT_COUNT, `confirmed volume does not contain exactly ${EVENT_COUNT} events`);
  save({ volumePlanId: confirmed.volumePlanId, volumePlanVersionId: confirmed.activeVersionId });
  log('volume_plan_confirmed', { volumePlanId: confirmed.volumePlanId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planEvent(bookId, volumePlan, eventIndex) {
  activePhase = `story-event-${eventIndex + 1}`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key('event-sequence') }
    });
    log('event_sequence_initialized', { revision: sequence.revision, eventCount: sequence.events.length });
  }
  assert(sequence.events.length === EVENT_COUNT, `expected ${EVENT_COUNT} events from confirmed volume, got ${sequence.events.length}`);
  let event = sequence.events[eventIndex];
  assert(event, `event ${eventIndex + 1} is missing`);
  save({ eventIds: { ...(state.eventIds ?? {}), [eventIndex]: event.eventId } });
  if (event.activeVersionId !== null) return event;
  let ideaId = state.eventIdeaIds?.[eventIndex];
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'event', subjectType: 'story_event', subjectId: event.eventId,
      originalText: SCENARIO.eventIdea(eventIndex),
      idempotencyLabel: `event-${eventIndex + 1}-idea`
    });
    ideaId = idea.authorInputId;
    save({ eventIdeaIds: { ...(state.eventIdeaIds ?? {}), [eventIndex]: ideaId } });
  }
  let eventTaskId = state.eventGenerationTaskIds?.[eventIndex];
  if (!eventTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/generate`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, expectedActiveVersionId: event.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('event'),
        authorInputRefs: [ideaId], idempotencyKey: key(`event-${eventIndex + 1}-generate`)
      }
    });
    eventTaskId = generation.taskId;
    save({ eventGenerationTaskIds: { ...(state.eventGenerationTaskIds ?? {}), [eventIndex]: eventTaskId } });
    log('event_generation_started', { eventIndex: eventIndex + 1, taskId: eventTaskId, members: generation.members });
  }
  const eventTaskDetail = await request(`/api/v1/books/${bookId}/tasks/${eventTaskId}`);
  if (terminalFailures.has(eventTaskDetail.task.status)) {
    await request(`/api/v1/books/${bookId}/tasks/${eventTaskId}/retry`, { method: 'POST', body: {} });
    log('event_generation_retried', {
      eventIndex: eventIndex + 1,
      taskId: eventTaskId,
      previousStatus: eventTaskDetail.task.status,
      previousErrorCode: eventTaskDetail.task.errorCode
    });
  }
  await waitForTask(bookId, eventTaskId, `event-${eventIndex + 1}-candidates-and-editor`);
  let versions = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`);
  assert(['candidate_a', 'candidate_b', 'fusion'].every((kind) => versions.some((item) => item.candidateKind === kind)),
    'event generation did not create A, B and fusion candidates');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'event fusion candidate missing');
  const finalEventContent = SCENARIO.events[eventIndex];
  if (selected.candidateKind !== 'author_edit' || selected.content.title !== finalEventContent.title) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    selected = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, candidateKind: 'author_edit',
        parentVersionId: selected.storyEventVersionId, sourceTaskId: eventTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('event'),
        content: finalEventContent,
        idempotencyKey: key(`event-${eventIndex + 1}-author-final`)
      }
    });
    log('event_author_adjustment_saved', { eventIndex: eventIndex + 1, storyEventVersionId: selected.storyEventVersionId, reason: `confirmed-${SCENARIO.key}-event-contract` });
  }
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/impact-preview`, {
    method: 'POST', body: { versionId: selected.storyEventVersionId }
  });
  sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  event = sequence.events[eventIndex];
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/confirm`, {
    method: 'POST', body: {
      versionId: selected.storyEventVersionId, expectedEventRevision: event.revision,
      expectedWorkflowVersion: workflow.planningVersion
    }
  });
  save({ eventVersionIds: { ...(state.eventVersionIds ?? {}), [eventIndex]: confirmed.activeVersionId } });
  log('story_event_confirmed', { eventIndex: eventIndex + 1, eventId: confirmed.eventId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planChapterSequence(bookId, event, eventIndex) {
  activePhase = `event-${eventIndex + 1}-chapter-sequence`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key(`event-${eventIndex + 1}-chapter-sequence-init`) }
    });
    log('chapter_sequence_initialized', { sequenceId: sequence.sequenceId, revision: sequence.revision });
  }
  if (sequence.activeVersionId !== null) {
    assert(sequence.outlines.length === CHAPTERS_PER_EVENT, `active chapter sequence has ${sequence.outlines.length} chapters, expected ${CHAPTERS_PER_EVENT}`);
    return sequence;
  }
  let ideaId = state.chapterSequenceIdeaIds?.[eventIndex];
  if (!ideaId) {
    const chapterStart = eventIndex * CHAPTERS_PER_EVENT + 1;
    const chapterEnd = chapterStart + CHAPTERS_PER_EVENT - 1;
    const idea = await createIdea(bookId, {
      surface: 'chapter_outline', subjectType: 'event_chapter_sequence', subjectId: event.eventId,
      originalText: `请把当前事件拆成精确10章，章号连续为${chapterStart}—${chapterEnd}。每章只有一个清晰责任，相邻章状态必须衔接；至少四名主要角色各有主动行动，对手会根据前一章结果调整策略；最后一章覆盖当前事件全部结束条件并自然引出后续。不要提前写正文。`,
      idempotencyLabel: `event-${eventIndex + 1}-chapter-sequence-idea`
    });
    ideaId = idea.authorInputId;
    save({ chapterSequenceIdeaIds: { ...(state.chapterSequenceIdeaIds ?? {}), [eventIndex]: ideaId } });
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    let taskId = state.chapterSequenceTaskIds?.[eventIndex]?.[attempt];
    if (!taskId) {
      const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generate`, {
        method: 'POST', body: {
          expectedSequenceRevision: sequence.revision, expectedWorkflowVersion: workflow.planningVersion,
          authorInputRefs: [ideaId], idempotencyKey: key(`event-${eventIndex + 1}-chapter-sequence-generate-${attempt}`)
        }
      });
      taskId = generation.taskId;
      save({ chapterSequenceTaskIds: { ...(state.chapterSequenceTaskIds ?? {}), [eventIndex]: { ...(state.chapterSequenceTaskIds?.[eventIndex] ?? {}), [attempt]: taskId } } });
      log('chapter_sequence_generation_started', { eventIndex: eventIndex + 1, attempt, taskId, member: generation.member });
    }
    await waitForTask(bookId, taskId, `event-${eventIndex + 1}-chapter-sequence-attempt-${attempt}`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const candidate = sequence.versions.filter((item) => item.status === 'candidate')
      .sort((left, right) => right.version - left.version)[0];
    assert(candidate, `chapter sequence attempt ${attempt} produced no candidate`);
    log('chapter_sequence_candidate', { attempt, sequenceVersionId: candidate.sequenceVersionId, chapterCount: candidate.content.chapters.length });
    if (candidate.content.chapters.length !== CHAPTERS_PER_EVENT) continue;
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/confirm`, {
      method: 'POST', body: {
        sequenceVersionId: candidate.sequenceVersionId, expectedSequenceRevision: sequence.revision,
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    assert(confirmed.outlines.length === CHAPTERS_PER_EVENT, 'confirmed chapter sequence does not contain ten outlines');
    save({ chapterSequenceVersionIds: { ...(state.chapterSequenceVersionIds ?? {}), [eventIndex]: confirmed.activeVersionId } });
    log('chapter_sequence_confirmed', { eventIndex: eventIndex + 1, sequenceVersionId: confirmed.activeVersionId, chapterCount: confirmed.outlines.length });
    return confirmed;
  }
  throw new Error('AI did not produce an exact ten-chapter sequence after five author-directed attempts');
}

async function saveExpressionProfile(bookId) {
  const existing = await request(`/api/v1/books/${bookId}/expression-profile`);
  if (existing?.status === 'confirmed') return existing;
  const confirmed = await request(`/api/v1/books/${bookId}/expression-profile`, {
    method: 'POST', body: {
      ...SCENARIO.expressionProfile
    }
  });
  log('expression_profile_confirmed', { expressionProfileId: confirmed.expressionProfileId, version: confirmed.version });
  return confirmed;
}

async function acceptPendingManuscript(bookId, taskId) {
  const confirmations = await request(`/api/v1/books/${bookId}/confirmations`);
  const confirmation = confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript' && item.task_id === taskId)
    ?? confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript');
  assert(confirmation, `task ${taskId} waiting without pending manuscript confirmation`);
  await request(`/api/v1/books/${bookId}/confirmations/${confirmation.confirmation_id}/accept`, {
    method: 'POST', body: { expectedCanonRevision: confirmation.expected_canon_revision }
  });
  log('manuscript_confirmed', { taskId, confirmationId: confirmation.confirmation_id });
}

async function chapterList(bookId) { return request(`/api/v1/books/${bookId}/chapters`); }
const chapterPhaseRank = new Map([
  ['pending', 0], ['preflight', 1], ['context', 2], ['draft', 3], ['hard_check', 4],
  ['review', 5], ['revise', 6], ['waiting_confirmation', 7], ['settlement', 8], ['completed', 9]
]);

async function resumableChapterTask(bookId, chapterId) {
  const candidates = (await request(`/api/v1/books/${bookId}/tasks`))
    .filter((task) => task.chapterId === chapterId && task.taskType === 'chapter_creation')
    .filter((task) => ['queued', 'working', 'waiting_confirmation', 'failed', 'blocked', 'interrupted'].includes(task.status));
  return candidates.sort((left, right) => {
    const phaseDifference = (chapterPhaseRank.get(right.currentPhase) ?? -1) - (chapterPhaseRank.get(left.currentPhase) ?? -1);
    return phaseDifference !== 0 ? phaseDifference : right.attemptCount - left.attemptCount;
  })[0] ?? null;
}

function formalCharacterCount(content) {
  return [...String(content ?? '')].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function assertReadableChapter(number, content) {
  const text = String(content.content ?? '');
  const effectiveCharacterCount = formalCharacterCount(text);
  assert(effectiveCharacterCount >= 2_350 && effectiveCharacterCount <= 3_650,
    `chapter ${number} effective length ${effectiveCharacterCount} outside 2350-3650 (raw ${content.totalLength})`);
  const internalMatch = /(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.exec(text);
  assert(internalMatch === null,
    `chapter ${number} exposes internal code or workflow fields: ${internalMatch?.[0]} near ${text.slice(Math.max(0, (internalMatch?.index ?? 0) - 80), (internalMatch?.index ?? 0) + 160)}`);
  assert(!/(?:待补充|TODO|这里填写|示例正文|(?:^|\n)\s*[【\[]?系统提示[】\]]?\s*[：:])/u.test(text),
    `chapter ${number} contains placeholder text`);
  return effectiveCharacterCount;
}

async function generateChapter(bookId, chapterNumber, outline) {
  const existing = (await chapterList(bookId)).find((chapter) => chapter.chapterNumber === chapterNumber);
  if (existing?.settlementStatus === 'settled') {
    const content = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    const internalMatch = /(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.exec(content.content);
    if (internalMatch !== null) {
      const revision = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/rewrite`, {
        method: 'POST', body: {
          manuscriptVersionId: content.manuscriptVersionId,
          instruction: '完整重写并清除正文中泄露的JSON、字段名、版本号、来源编号和工作流载荷；保持原有情节、人物选择、章末状态和2700至3200有效字符。'
        }
      });
      log('settled_chapter_repair_started', { chapterNumber, taskId: revision.taskId, matched: internalMatch[0] });
      const review = await waitForTask(bookId, revision.taskId, `chapter-${chapterNumber}-repair`);
      if (review.task.status === 'waiting_confirmation') {
        await acceptPendingManuscript(bookId, revision.taskId);
        await waitForTask(bookId, revision.taskId, `chapter-${chapterNumber}-repair-settlement`);
      }
      const repaired = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
      assertReadableChapter(chapterNumber, repaired);
      log('settled_chapter_repaired', { chapterNumber, manuscriptVersionId: repaired.manuscriptVersionId, contentHash: repaired.contentHash });
    } else {
      assertReadableChapter(chapterNumber, content);
    }
    if (!state.settledChapters.includes(chapterNumber)) {
      save({ settledChapters: [...state.settledChapters, chapterNumber].sort((a, b) => a - b) });
    }
    return;
  }
  activePhase = `chapter-${chapterNumber}`;
  const title = String(outline.activeVersion?.content?.title ?? outline.planned?.title ?? `第${chapterNumber}章`);
  let task = existing?.chapterId === undefined ? null : await resumableChapterTask(bookId, existing.chapterId);
  if (task !== null && task.status === 'blocked' && task.errorCode === 'QUALITY_BLOCKED' && existing?.chapterId) {
    const current = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    assert(current.manuscriptVersionId, `chapter ${chapterNumber} quality block has no manuscript`);
    if (task.currentPhase === 'review') {
      task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/finalize`, {
        method: 'POST', body: { manuscriptVersionId: current.manuscriptVersionId }
      });
      log('chapter_review_reopened', { chapterNumber, taskId: task.taskId });
    } else {
      task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/rewrite`, {
        method: 'POST', body: {
          manuscriptVersionId: current.manuscriptVersionId,
          instruction: '保留人物选择、证据闭环和章末状态，完整重写；删去重复解释，正文严格控制在2700至3200有效字符。'
        }
      });
      log('chapter_quality_rewrite_started', { chapterNumber, taskId: task.taskId, phase: task.currentPhase });
    }
  } else if (task !== null && ['failed', 'interrupted'].includes(task.status)) {
    task = await request(`/api/v1/books/${bookId}/tasks/${task.taskId}/retry`, { method: 'POST', body: {} });
    log('chapter_task_retried', { chapterNumber, taskId: task.taskId });
  }
  if (task === null) {
    const run = await request(`/api/v1/books/${bookId}/writing-runs`, {
      method: 'POST', body: { chapterTitle: title }
    });
    assert(Array.isArray(run.taskIds) && run.taskIds.length === 1, `chapter ${chapterNumber} did not create one task`);
    task = { taskId: run.taskIds[0] };
    log('chapter_scheduled', { chapterNumber, title, taskId: task.taskId });
  }
  save({ chapterTaskIds: { ...(state.chapterTaskIds ?? {}), [chapterNumber]: task.taskId } });
  const review = await waitForTask(bookId, task.taskId, `chapter-${chapterNumber}-production`);
  if (review.task.status === 'waiting_confirmation') {
    await acceptPendingManuscript(bookId, task.taskId);
    const settled = await waitForTask(bookId, task.taskId, `chapter-${chapterNumber}-settlement`);
    assert(settled.task.status === 'succeeded', `chapter ${chapterNumber} did not settle`);
  } else {
    assert(review.task.status === 'succeeded', `chapter ${chapterNumber} ended as ${review.task.status}`);
  }
  const chapter = (await chapterList(bookId)).find((item) => item.chapterNumber === chapterNumber);
  assert(chapter?.settlementStatus === 'settled', `chapter ${chapterNumber} is not settled`);
  const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
  const characterCount = assertReadableChapter(chapterNumber, content);
  const detail = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`);
  assert((detail.production?.reviewReports?.length ?? 0) >= 3, `chapter ${chapterNumber} has fewer than three review reports`);
  assert((detail.production?.reviewPanels?.length ?? 0) >= 1, `chapter ${chapterNumber} has no review panel`);
  save({ settledChapters: [...new Set([...state.settledChapters, chapterNumber])].sort((a, b) => a - b) });
  log('chapter_settled', {
    chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
    manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
    characterCount, reviewReportCount: detail.production.reviewReports.length
  });
}

async function prepareAndWriteEventChapters(bookId, event) {
  await saveExpressionProfile(bookId);
  const existingSettled = (await chapterList(bookId)).filter((chapter) => chapter.settlementStatus === 'settled')
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
  for (const chapter of existingSettled) await generateChapter(bookId, chapter.chapterNumber, null);
  for (let pass = 1; pass <= 30; pass += 1) {
    let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const unsettled = sequence.outlines.filter((item) => item.status !== 'settled')
      .sort((left, right) => left.chapterNumber - right.chapterNumber);
    if (unsettled.length === 0) return;
    const alreadyFrozen = unsettled.filter((item) => item.status === 'frozen').slice(0, 3);
    if (alreadyFrozen.length > 0) {
      for (const outline of alreadyFrozen) await generateChapter(bookId, outline.chapterNumber, outline);
      continue;
    }
    const targets = unsettled.slice(0, 3);
    const start = targets[0].chapterNumber;
    const end = targets.at(-1).chapterNumber;
    const lackingDetails = targets.some((item) => item.versions.length === 0);
    if (lackingDetails) {
      activePhase = `chapter-details-${start}-${end}`;
      const workflow = await request(`/api/v1/books/${bookId}/workflow`);
      const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/generate`, {
        method: 'POST', body: {
          count: targets.length, expectedSequenceRevision: sequence.revision,
          expectedWorkflowVersion: workflow.planningVersion, authorInputRefs: [],
          idempotencyKey: key(`chapter-details-${start}-${end}`)
        }
      });
      log('chapter_details_generation_started', { start, count: targets.length, taskId: generation.taskId, member: generation.member });
      const purpose = `chapter-details-${start}-${end}`;
      try {
        await waitForTask(bookId, generation.taskId, purpose);
      } catch (error) {
        const detail = await request(`/api/v1/books/${bookId}/tasks/${generation.taskId}`);
        if (!['failed', 'interrupted'].includes(detail.task.status)) throw error;
        await request(`/api/v1/books/${bookId}/tasks/${generation.taskId}/retry`, { method: 'POST', body: {} });
        log('chapter_details_task_retried', { start, taskId: generation.taskId, previousErrorCode: detail.task.errorCode });
        await waitForTask(bookId, generation.taskId, `${purpose}-retry`);
      }
    }
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const targetIds = new Set(targets.map((item) => item.outlineId));
    const freshTargets = sequence.outlines.filter((item) => targetIds.has(item.outlineId));
    assert(freshTargets.every((item) => item.versions.length > 0), `detailed outlines ${start}-${end} are incomplete`);
    const workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const frozen = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/freeze`, {
      method: 'POST', body: {
        items: freshTargets.map((item) => ({
          outlineId: item.outlineId, outlineVersionId: item.versions[0].outlineVersionId,
          expectedOutlineRevision: item.revision
        })),
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    log('chapter_outlines_frozen', { start, count: freshTargets.length, workflowStage: (await request(`/api/v1/books/${bookId}/workflow`)).stage });
    for (const target of freshTargets) {
      const outline = frozen.outlines.find((item) => item.outlineId === target.outlineId);
      assert(outline?.status === 'frozen', `chapter ${target.chapterNumber} outline was not frozen`);
      await generateChapter(bookId, target.chapterNumber, outline);
    }
  }
  throw new Error('event chapter workflow exceeded 30 resumable passes');
}

async function settleEvent(bookId, event, eventIndex) {
  activePhase = `event-${eventIndex + 1}-settlement`;
  const existing = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settlement`);
  if (existing !== null) {
    const expectedStart = eventIndex * CHAPTERS_PER_EVENT + 1;
    const expectedEnd = expectedStart + CHAPTERS_PER_EVENT - 1;
    assert(existing.chapterStart === expectedStart && existing.chapterEnd === expectedEnd,
      `existing event settlement range is not ${expectedStart}-${expectedEnd}`);
    return existing;
  }
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'event_settlement_in_progress', `expected event settlement stage, got ${workflow.stage}`);
  const eventSettlement = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  const expectedStart = eventIndex * CHAPTERS_PER_EVENT + 1;
  const expectedEnd = expectedStart + CHAPTERS_PER_EVENT - 1;
  assert(eventSettlement.chapterStart === expectedStart && eventSettlement.chapterEnd === expectedEnd,
    `event settlement range is not ${expectedStart}-${expectedEnd}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const expectedNextStage = eventIndex === EVENT_COUNT - 1 ? 'volume_settlement_in_progress' : 'event_sequence_in_progress';
  assert(workflow.stage === expectedNextStage, `expected ${expectedNextStage} after event settlement, got ${workflow.stage}`);
  save({ eventSettlementIds: { ...(state.eventSettlementIds ?? {}), [eventIndex]: eventSettlement.settlementId } });
  log('event_settled', { eventIndex: eventIndex + 1, settlementId: eventSettlement.settlementId, canonRevision: eventSettlement.canonRevision, nextStage: workflow.stage });
  return eventSettlement;
}

async function settleVolume(bookId, volumePlan) {
  activePhase = 'volume-settlement';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'volume_settlement_in_progress', `expected volume settlement stage, got ${workflow.stage}`);
  const volumeSettlement = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  assert(volumeSettlement.chapterStart === 1 && volumeSettlement.chapterEnd === TOTAL_CHAPTERS, `volume settlement range is not 1-${TOTAL_CHAPTERS}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'ready_for_next_volume', `expected next-volume ready stage, got ${workflow.stage}`);
  save({ volumeSettlementId: volumeSettlement.settlementId });
  log('volume_settled', { settlementId: volumeSettlement.settlementId, nextStage: workflow.stage });
  return { volumeSettlement, workflow };
}

async function collectEvidence(bookId, volumePlan, events, settlements) {
  activePhase = 'final-evidence';
  const [book, profile, workflow, settings, chapters, workspace, volumePlans, eventSequence, ideas, ...chapterSequences] = await Promise.all([
    request(`/api/v1/books/${bookId}`), request(`/api/v1/books/${bookId}/book-profile`),
    request(`/api/v1/books/${bookId}/workflow`), request(`/api/v1/books/${bookId}/setting-outline-workspace`),
    chapterList(bookId), request(`/api/v1/books/${bookId}/workspace`),
    request(`/api/v1/books/${bookId}/volume-plans`),
    request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`),
    request(`/api/v1/books/${bookId}/author-planning-inputs`),
    ...events.map((event) => request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`))
  ]);
  assert(workspace.agents.length === 11, `workspace has ${workspace.agents.length} agents instead of 11`);
  assert(new Set(workspace.agents.map((agent) => agent.roleKey)).size === 11, 'agent role keys are not unique');
  const settled = chapters.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
  assert(settled.length === TOTAL_CHAPTERS, `expected exactly ${TOTAL_CHAPTERS} settled chapters, got ${settled.length}`);
  assert(settled.every((chapter, index) => chapter.chapterNumber === index + 1), `settled chapters are not contiguous 1-${TOTAL_CHAPTERS}`);
  const chapterEvidence = [];
  const manuscriptTexts = [];
  for (const chapter of settled) {
    const [content, detail] = await Promise.all([
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`),
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`)
    ]);
    manuscriptTexts.push(content.content);
    chapterEvidence.push({
      chapterNumber: chapter.chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
      manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
      characterCount: assertReadableChapter(chapter.chapterNumber, content),
      reviewPanelCount: detail.production.reviewPanels.length,
      reviewReportCount: detail.production.reviewReports.length,
      approvalGateCount: detail.production.approvalGates.length,
      preview: content.content.slice(0, 240)
    });
  }
  const wholeManuscript = manuscriptTexts.join('\n');
  for (const requiredName of SCENARIO.requiredNames) {
    assert(wholeManuscript.includes(requiredName), `${TOTAL_CHAPTERS}-chapter manuscript is missing active character ${requiredName}`);
  }
  for (const requiredStoryTerm of SCENARIO.requiredTerms) {
    assert(wholeManuscript.includes(requiredStoryTerm), `${TOTAL_CHAPTERS}-chapter manuscript is missing ${SCENARIO.key} story term ${requiredStoryTerm}`);
  }
  assert(SCENARIO.forbiddenTerms.every((term) => !wholeManuscript.includes(term)), `${SCENARIO.key} manuscript leaked unrelated story terms`);
  assert(events.map((event) => event.activeVersion?.content.title).join('|') === SCENARIO.events.map((event) => event.title).join('|'),
    `confirmed events are not the ${EVENT_COUNT} required ${SCENARIO.key} event contracts`);
  const ideaEvidence = ideas.map((idea) => ({
    authorInputId: idea.authorInputId, surface: idea.surface, subjectType: idea.subjectType,
    intentStrength: idea.intentStrength, status: idea.status, handlingReason: idea.handlingReason,
    appliedToRefs: idea.appliedToRefs
  }));
  const modelParticipants = [...new Map((state.taskEvidence ?? []).flatMap((task) => task.modelCalls)
    .filter((call) => call.provider && call.modelId)
    .map((call) => [`${call.agentId}:${call.provider}:${call.modelId}`, call])).values()];
  const evidence = {
    testId: TEST_ID, scenario: SCENARIO.key, scenarioName: SCENARIO.displayName,
    releaseId: RELEASE_ID, completedAt: now(), evidenceLevel: `E2-current-workflow-${TOTAL_CHAPTERS}-chapters-${SCENARIO.key}`,
    limitation: `${TOTAL_CHAPTERS}章本地确定性流程只证明当前对象链、任务、审查、正文与事件结算可运行和可追溯；不代表真实套餐模型文学质量，也不等于1000章以上长期质量已经得到证明。`,
    book: { bookId, title: book.title, status: book.status, canonRevision: book.canonRevision },
    profile, workflow, settings: settings.map((item) => ({ itemKey: item.itemKey, label: item.label, status: item.status })),
    team: workspace.agents.map((agent) => ({
      agentId: agent.agentId, roleKey: agent.roleKey, displayName: agent.displayName,
      provider: agent.provider, modelId: agent.modelId, activationState: agent.activationState
    })),
    modelParticipants, taskEvidence: state.taskEvidence,
    volumePlan: volumePlans.find((item) => item.volumePlanId === volumePlan.volumePlanId),
    eventSequence, chapterSequences, authorIdeas: ideaEvidence,
    chapters: chapterEvidence, settlements
  };
  writeFileSync(FINAL_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  save({ completedAt: evidence.completedAt, stoppedAtPhase: null, lastError: null });
  log('e2e_completed', {
    bookId, title: book.title, canonRevision: book.canonRevision,
    chapterCount: chapterEvidence.length, eventCount: events.length, agentCount: workspace.agents.length,
    modelParticipantCount: modelParticipants.length, finalStage: workflow.stage, evidenceFile: FINAL_FILE
  });
}

try {
  await issueSession();
  const healthEnvelope = await fetch(`${API}/health`).then((response) => response.json());
  const health = healthEnvelope.data ?? healthEnvelope;
  assert(health.status === 'ok' && health.releaseId === RELEASE_ID, `API health mismatch: ${JSON.stringify(health)}`);
  const bookId = await createBook();
  await ensureTestBudget(bookId);
  await completeSettings(bookId);
  const volumePlan = await planVolume(bookId);
  const events = [];
  const eventSettlements = [];
  for (let eventIndex = 0; eventIndex < EVENT_COUNT; eventIndex += 1) {
    const event = await planEvent(bookId, volumePlan, eventIndex);
    events.push(event);
    await planChapterSequence(bookId, event, eventIndex);
    await prepareAndWriteEventChapters(bookId, event);
    eventSettlements.push(await settleEvent(bookId, event, eventIndex));
  }
  const volumeSettlement = await settleVolume(bookId, volumePlan);
  await collectEvidence(bookId, volumePlan, events, { eventSettlements, ...volumeSettlement });
} catch (error) {
  issue(error);
  console.error(error);
  process.exitCode = 1;
}
