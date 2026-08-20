import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { loginEvaluationAccount } from './lib/evaluation-account.mjs';
import {
  assertReleaseReviewIsAcceptable as assertReleaseReviewGate,
  latestCompleteReleaseReview
} from './lib/release-review-gate.mjs';
import { batchStartupGate } from './lib/batch-circuit-breaker.mjs';
import { join, resolve } from 'node:path';
import { requireWorkflowScenario } from './current-workflow-scenarios.mjs';
import { selectResumableChapterTask } from './lib/resumable-chapter-task.mjs';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const RUN_KEY = String(process.argv[2] ?? 'nightly-v2').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const SCENARIO = requireWorkflowScenario(String(process.argv[3] ?? 'xianxia').trim().toLowerCase());
const EVENT_COUNT = SCENARIO.events.length;
const CHAPTERS_PER_EVENT = 10;
const TOTAL_CHAPTERS = EVENT_COUNT * CHAPTERS_PER_EVENT;
const RELEASE_TARGET_CHAPTERS = Number(process.env.WENMI_RELEASE_TARGET_CHAPTERS ?? String(TOTAL_CHAPTERS));
const TARGET_VOLUME_COUNT = Math.ceil(RELEASE_TARGET_CHAPTERS / TOTAL_CHAPTERS);
const TARGET_EVENT_COUNT = Math.ceil(RELEASE_TARGET_CHAPTERS / CHAPTERS_PER_EVENT);
const TARGET_COMPLETED_VOLUME_COUNT = Math.floor(RELEASE_TARGET_CHAPTERS / TOTAL_CHAPTERS);
const TEST_ID = `E2E-CURRENT-WORKFLOW-${TOTAL_CHAPTERS}-${SCENARIO.key.toUpperCase()}-${RUN_KEY.toUpperCase()}`;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const TEST_TOKEN_LIMIT = 25_000_000;
const REAL_RELEASE = process.env.WENMI_RELEASE_VALIDATION === '1';
const MANUAL_REVIEW = process.env.WENMI_RELEASE_MANUAL_REVIEW === '1';
const APPROVE_PENDING = process.env.WENMI_RELEASE_APPROVE_PENDING === '1';
const CONTINUOUS_MANUAL = process.env.WENMI_RELEASE_CONTINUOUS_MANUAL === '1';
const OWNER_AUTHORIZED_BOOK_ID = String(process.env.WENMI_RELEASE_OWNER_AUTHORIZED_BOOK_ID ?? '').trim();
const OWNER_AUTHORIZED_RELEASE = OWNER_AUTHORIZED_BOOK_ID.length > 0;
const OWNER_AUTHORIZED_BOOK_IDS = new Set([
  'ebc3b29e-c0d4-45e9-b839-bb0ee2999501',
  '9486c1fc-a03f-4fe9-b47a-da1a551e1809'
]);
const OWNER_AUTHORIZED_BATCH_CAP = 3;
const LEGACY_ROOT = resolve(`data/verification/current-workflow-${TOTAL_CHAPTERS}-chapters-${SCENARIO.key}-${RUN_KEY}`);
const TARGET_ROOT = resolve(`data/verification/current-workflow-${RELEASE_TARGET_CHAPTERS}-chapters-${SCENARIO.key}-${RUN_KEY}`);
const ROOT = resolveResumeRoot();
const STATE_FILE = join(ROOT, 'state.json');
const EVENT_FILE = join(ROOT, 'run-events.ndjson');
const ISSUE_FILE = join(ROOT, 'issues.md');
const FINAL_FILE = join(ROOT, 'final-evidence.json');

mkdirSync(ROOT, { recursive: true });

function resolveResumeRoot() {
  const verificationRoot = resolve('data/verification');
  const suffix = `-chapters-${SCENARIO.key}-${RUN_KEY}`;
  const candidates = existsSync(verificationRoot)
    ? readdirSync(verificationRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('current-workflow-') && entry.name.endsWith(suffix))
      .map((entry) => resolve(verificationRoot, entry.name))
      .filter((candidate) => existsSync(join(candidate, 'state.json')))
    : [];
  const ranked = candidates.flatMap((candidate) => {
    try {
      const candidateState = JSON.parse(readFileSync(join(candidate, 'state.json'), 'utf8'));
      if (candidateState.scenario !== SCENARIO.key || typeof candidateState.bookId !== 'string') return [];
      const score = (candidateState.settledChapters?.length ?? 0) * 10_000
        + (candidateState.taskEvidence?.length ?? 0) * 100
        + (candidateState.volumePlans ? Object.keys(candidateState.volumePlans).length : 0) * 10
        + (candidateState.bookId ? 1 : 0);
      return [{ candidate, score, createdAt: String(candidateState.createdAt ?? '') }];
    } catch {
      return [];
    }
  }).sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt));
  if (ranked[0] !== undefined) return ranked[0].candidate;
  return RELEASE_TARGET_CHAPTERS === TOTAL_CHAPTERS || existsSync(LEGACY_ROOT) ? LEGACY_ROOT : TARGET_ROOT;
}

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
let approvalConsumed = false;
let ownerAuthorizedBatchEnd = Number.POSITIVE_INFINITY;
const terminalFailures = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);
const noneTemplate = (scope) => ({
  selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
  scope, beats: [], customDirection: null
});

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function key(label) { return `${TEST_ID}:${label}`; }
function currentOutlineCandidate(outline) {
  return (outline?.versions ?? [])
    .filter((version) => version.status === 'candidate')
    .sort((left, right) => right.version - left.version)[0] ?? null;
}
function volumeLabel(volumeNumber, label) { return volumeNumber === 1 ? label : `volume-${volumeNumber}-${label}`; }
function globalEventIndex(volumeNumber, eventIndex) { return (volumeNumber - 1) * EVENT_COUNT + eventIndex; }
function eventChapterStart(volumeNumber, eventIndex) {
  return globalEventIndex(volumeNumber, eventIndex) * CHAPTERS_PER_EVENT + 1;
}
function volumeChapterRange(volumeNumber) {
  const chapterStart = (volumeNumber - 1) * TOTAL_CHAPTERS + 1;
  return { chapterStart, chapterEnd: chapterStart + TOTAL_CHAPTERS - 1 };
}
function volumeState(mapName, volumeNumber, legacyName) {
  return state[mapName]?.[volumeNumber] ?? (volumeNumber === 1 ? state[legacyName] : undefined);
}
function saveVolumeState(mapName, volumeNumber, value, legacyName) {
  const patch = { [mapName]: { ...(state[mapName] ?? {}), [volumeNumber]: value } };
  if (volumeNumber === 1 && legacyName) patch[legacyName] = value;
  save(patch);
}
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
  let recoverableRetryCount = 0;
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
      const recoverableUnknownResult = task.status === 'interrupted'
        && task.errorCode === 'MODEL_CALL_RESULT_UNKNOWN'
        && recoverableRetryCount < 3;
      if (recoverableUnknownResult) {
        recoverableRetryCount += 1;
        await request(`/api/v1/books/${bookId}/tasks/${taskId}/retry`, { method: 'POST', body: {} });
        log('task_recovered_after_unknown_model_result', {
          purpose, taskId, retry: recoverableRetryCount, maxRetries: 3
        });
        signature = '';
        await sleep(POLL_MS);
        continue;
      }
      recordTask(purpose, detail);
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${purpose} task ${taskId} exceeded ${TASK_TIMEOUT_MS / 60_000} minutes`);
}

function assertAuthorSafeGenerationView(view, purpose) {
  assert(view !== null && typeof view === 'object', `${purpose} did not return an author generation view`);
  assert(!('taskId' in view), `${purpose} leaked internal taskId through the author generation view`);
  assert(!('currentPhase' in view), `${purpose} leaked internal currentPhase through the author generation view`);
}

async function taskByIdempotency(bookId, idempotencyKey, taskType, required) {
  const tasks = await request(`/api/v1/books/${bookId}/tasks`);
  const exactMatches = tasks.filter((task) => task.idempotencyKey === idempotencyKey && task.taskType === taskType);
  const serviceScopedMatches = tasks.filter((task) => task.taskType === taskType
    && task.idempotencyKey.endsWith(`:${idempotencyKey}`));
  const matches = exactMatches.length > 0 ? exactMatches : serviceScopedMatches;
  assert(matches.length <= 1,
    `${taskType} has ${matches.length} tasks for exact idempotency key ${idempotencyKey}`);
  if (required) assert(matches.length === 1, `${taskType} task was not recoverable by its exact idempotency key`);
  return matches[0] ?? null;
}

async function startOrResumeAuthorGeneration(bookId, { path, body, taskType, purpose }) {
  const existing = await taskByIdempotency(bookId, body.idempotencyKey, taskType, false);
  if (existing !== null) {
    if (['failed', 'interrupted'].includes(existing.status)) {
      const retried = await request(`/api/v1/books/${bookId}/tasks/${existing.taskId}/retry`, {
        method: 'POST', body: {}
      });
      log('author_generation_task_retried', {
        purpose, taskType, taskId: retried.taskId, previousStatus: existing.status,
        preservedCandidateCheckpoint: true
      });
      return { taskId: retried.taskId, view: null, recovered: true, retried: true };
    }
    log('author_generation_task_recovered', {
      purpose, taskType, taskId: existing.taskId, status: existing.status, exactIdempotencyKey: true
    });
    return { taskId: existing.taskId, view: null, recovered: true, retried: false };
  }
  const view = await request(path, { method: 'POST', body });
  assertAuthorSafeGenerationView(view, purpose);
  const created = await taskByIdempotency(bookId, body.idempotencyKey, taskType, true);
  return { taskId: created.taskId, view, recovered: false, retried: false };
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
  assert(created.agentCount === 14, `expected 14 creative agents, got ${created.agentCount}`);
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
  const requiredSettingKeys = [...new Set([
    ...readiness.required,
    ...(SCENARIO.requiredSettingKeys ?? [])
  ])];
  for (const itemKey of requiredSettingKeys) {
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
    if (REAL_RELEASE) {
      const modelSignatures = proposals.flatMap((proposal) =>
        proposal.modelProvider && proposal.modelId ? [`${proposal.modelProvider}/${proposal.modelId}`] : []);
      if (modelSignatures.length > 0) {
        assert(new Set(modelSignatures).size === 3,
          `${item.itemKey} release proposals do not come from three distinct models: ${modelSignatures.join(', ')}`);
      } else {
        log('setting_model_details_redacted', { itemKey: item.itemKey, verification: 'scoped-production-audit' });
      }
    }
    log('setting_proposals_ready', {
      itemKey: item.itemKey,
      members: proposals.map((proposal) => ({ agentId: proposal.agentId }))
    });

    let synthesis = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/synthesize`, {
      method: 'POST', body: {
        proposalIds: proposals.map((proposal) => proposal.proposalId),
        authorInputId: authorInput.authorInputId,
        idempotencyKey: key(`setting-${item.itemKey}-synthesis`)
      }
    });
    const synthesisDetail = await request(`/api/v1/books/${bookId}/tasks/${synthesis.taskId}`);
    if (terminalFailures.has(synthesisDetail.task.status)) {
      synthesis = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/synthesize`, {
        method: 'POST', body: {
          proposalIds: proposals.map((proposal) => proposal.proposalId),
          authorInputId: authorInput.authorInputId,
          idempotencyKey: key(`setting-${item.itemKey}-synthesis-compact-recovery`)
        }
      });
      log('setting_synthesis_recreated', {
        itemKey: item.itemKey, taskId: synthesis.taskId, previousTaskId: synthesisDetail.task.taskId,
        previousStatus: synthesisDetail.task.status
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
  let quality = await request(`/api/v1/books/${bookId}/setting-baseline/quality-report`);
  const completedAuditAttempts = (state.taskEvidence ?? [])
    .filter((item) => item.purpose === 'setting-quality-audit'
      || /^setting-quality-audit-attempt-\d+$/u.test(String(item.purpose ?? ''))).length;
  if (!(quality.fresh && quality.report)) {
    for (let auditAttempt = completedAuditAttempts + 1; auditAttempt <= 4; auditAttempt += 1) {
      const auditPurpose = `setting-quality-audit-attempt-${auditAttempt}`;
      const audit = await request(`/api/v1/books/${bookId}/setting-baseline/quality-audit`, {
        method: 'POST', body: { idempotencyKey: key(auditPurpose) }
      });
      try {
        await waitForTask(bookId, audit.taskId, auditPurpose);
      } catch (error) {
        log('setting_quality_audit_attempt_failed', { auditAttempt, taskId: audit.taskId });
        if (auditAttempt === 4) throw error;
        continue;
      }
      quality = await request(`/api/v1/books/${bookId}/setting-baseline/quality-report`);
      if (quality.fresh && quality.report) {
        log('setting_quality_audit_attempt_succeeded', { auditAttempt, taskId: audit.taskId });
        break;
      }
    }
  }
  if (!(quality.fresh && quality.report)) {
    const remediationPurpose = 'setting-quality-audit-after-setting-remediation-1';
    const remediationAlreadyUsed = (state.taskEvidence ?? [])
      .some((item) => item.purpose === remediationPurpose);
    assert(!remediationAlreadyUsed, 'setting quality audit after setting remediation already ran without a fresh report');
    const remediationAudit = await request(`/api/v1/books/${bookId}/setting-baseline/quality-audit`, {
      method: 'POST', body: { idempotencyKey: key(remediationPurpose) }
    });
    await waitForTask(bookId, remediationAudit.taskId, remediationPurpose);
    quality = await request(`/api/v1/books/${bookId}/setting-baseline/quality-report`);
    log('setting_quality_audit_after_remediation_completed', {
      taskId: remediationAudit.taskId, fresh: quality.fresh, hasReport: Boolean(quality.report)
    });
  }
  assert(quality?.fresh && quality.report, 'setting quality audit does not cover the current confirmed settings');
  const hardIssues = quality.report.issues.filter((issue) => issue.severity === 'hard');
  assert(hardIssues.length === 0,
    `setting quality audit found ${hardIssues.length} unacknowledged hard issues: ${hardIssues.map((issue) => issue.id).join(', ')}`);
  log('setting_quality_audit_passed', {
    reportId: quality.report.reportId, verdict: quality.report.verdict,
    issueCount: quality.report.issues.length, hardIssueCount: hardIssues.length
  });
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

async function planVolume(bookId, volumeNumber) {
  activePhase = `volume-${volumeNumber}-plan`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  const rememberedPlanId = volumeState('volumePlanIds', volumeNumber, 'volumePlanId');
  let plan = plans.find((item) => item.volumePlanId === rememberedPlanId)
    ?? plans.find((item) => item.planNumber === volumeNumber) ?? null;
  if (plan === null) {
    plan = await request(`/api/v1/books/${bookId}/volume-plans`, {
      method: 'POST', body: {
        expectedWorkflowVersion: workflow.planningVersion, planNumber: volumeNumber,
        idempotencyKey: key(volumeLabel(volumeNumber, 'volume-plan'))
      }
    });
    saveVolumeState('volumePlanIds', volumeNumber, plan.volumePlanId, 'volumePlanId');
    log('volume_plan_created', { volumeNumber, volumePlanId: plan.volumePlanId, revision: plan.revision });
  }
  if (plan.activeVersionId !== null) {
    saveVolumeState('volumePlanIds', volumeNumber, plan.volumePlanId, 'volumePlanId');
    saveVolumeState('volumePlanVersionIds', volumeNumber, plan.activeVersionId, 'volumePlanVersionId');
    await ensureEventChain(bookId, plan, volumeNumber);
    return plan;
  }
  let ideaId = volumeState('volumeIdeaIds', volumeNumber, 'volumeIdeaId');
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'volume_plan', subjectType: 'volume_plan', subjectId: plan.volumePlanId,
      originalText: SCENARIO.volumeIdeaFor(volumeNumber),
      idempotencyLabel: volumeLabel(volumeNumber, 'volume-idea')
    });
    ideaId = idea.authorInputId;
    saveVolumeState('volumeIdeaIds', volumeNumber, ideaId, 'volumeIdeaId');
  }
  let generationTaskId = volumeState('volumeGenerationTaskIds', volumeNumber, 'volumeGenerationTaskId');
  if (generationTaskId) {
    const previousGeneration = await request(`/api/v1/books/${bookId}/tasks/${generationTaskId}`);
    if (terminalFailures.has(previousGeneration.task.status)) {
      const retried = await request(`/api/v1/books/${bookId}/tasks/${generationTaskId}/retry`, {
        method: 'POST', body: {}
      });
      generationTaskId = retried.taskId;
      saveVolumeState('volumeGenerationTaskIds', volumeNumber, generationTaskId, 'volumeGenerationTaskId');
      log('volume_generation_retried', {
        volumeNumber,
        taskId: generationTaskId,
        previousStatus: previousGeneration.task.status,
        preservedCandidateCheckpoint: true
      });
    }
  }
  if (!generationTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    const generation = await startOrResumeAuthorGeneration(bookId, {
      path: `/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`,
      taskType: 'volume_plan_generation', purpose: `volume-${volumeNumber}-generation`,
      body: {
        expectedPlanRevision: plan.revision, expectedActiveVersionId: plan.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('volume'),
        authorInputRefs: [ideaId], idempotencyKey: key(volumeLabel(volumeNumber, 'volume-generate'))
      }
    });
    generationTaskId = generation.taskId;
    saveVolumeState('volumeGenerationTaskIds', volumeNumber, generationTaskId, 'volumeGenerationTaskId');
    log('volume_generation_started', {
      volumeNumber, taskId: generation.taskId, members: generation.view?.members ?? [], recovered: generation.recovered
    });
  }
  await waitForTask(bookId, generationTaskId, `volume-${volumeNumber}-candidates-and-editor`);
  let versions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`);
  const candidates = ['candidate_a', 'candidate_b'].map((kind) =>
    versions.filter((item) => item.sourceTaskId === generationTaskId && item.candidateKind === kind).at(-1)
  );
  assert(candidates.every(Boolean), 'volume route generation did not create independent A and B candidates');
  const sources = candidates.map((item) => `${item.sourceTaskId}:${item.contentHash}`);
  assert(new Set(sources).size === 2, 'volume A and B candidates are not independently traceable');
  const currentLegacyVersionIds = new Set(candidates.map((item) => item.volumePlanVersionId));
  const allDirections = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/directions`);
  const directions = allDirections.filter((item) =>
    currentLegacyVersionIds.has(item.legacyVolumePlanVersionId)
  );
  assert(directions.length === 2, `expected two author-visible volume routes, got ${directions.length}`);
  assert(new Set(directions.map((item) => item.candidateKind)).size === 2,
    'author-visible volume routes do not preserve A/B identity');
  const chosenDirection = directions.find((item) => item.candidateKind === 'candidate_a') ?? directions[0];
  const selection = {
    selectionMode: 'whole', selectedProposalId: chosenDirection.proposalId,
    selectedVersionId: chosenDirection.volumeDirectionVersionId, fragments: [],
    authorNotes: '验收作者整份采用方案一，由主编整理确认稿。'
  };
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/route-selection`, {
    method: 'POST', body: {
      selection, idempotencyKey: key(volumeLabel(volumeNumber, 'volume-route-selection'))
    }
  });
  log('volume_route_selected', {
    volumeNumber, proposalId: chosenDirection.proposalId, candidateKind: chosenDirection.candidateKind
  });
  plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const fusionGeneration = await startOrResumeAuthorGeneration(bookId, {
    path: `/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`,
    taskType: 'volume_plan_generation', purpose: `volume-${volumeNumber}-fusion`,
    body: {
      expectedPlanRevision: plan.revision, expectedActiveVersionId: plan.activeVersionId,
      expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('volume'),
      authorInputRefs: [ideaId], selection,
      idempotencyKey: key(volumeLabel(volumeNumber, 'volume-fusion'))
    }
  });
  saveVolumeState('volumeFusionTaskIds', volumeNumber, fusionGeneration.taskId, 'volumeFusionTaskId');
  await waitForTask(bookId, fusionGeneration.taskId, `volume-${volumeNumber}-author-selection-fusion`);
  versions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`);
  const selected = versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'author selection did not create a chief-editor fusion candidate');
  assert(selected.content.eventSequence.length === 0,
    'volume direction incorrectly contains event or chapter planning');
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
  assert(confirmed.activeVersion?.content.eventSequence.length === 0,
    'confirmed volume direction must not contain event or chapter planning');
  if (volumeNumber === 1) assert(confirmed.activeVersion.content.firstVolumeLaunch,
    'confirmed first volume is missing the strong-launch contract');
  saveVolumeState('volumePlanIds', volumeNumber, confirmed.volumePlanId, 'volumePlanId');
  saveVolumeState('volumePlanVersionIds', volumeNumber, confirmed.activeVersionId, 'volumePlanVersionId');
  log('volume_plan_confirmed', { volumeNumber, volumePlanId: confirmed.volumePlanId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  await ensureEventChain(bookId, confirmed, volumeNumber);
  return confirmed;
}

async function ensureEventChain(bookId, plan, volumeNumber) {
  activePhase = `volume-${volumeNumber}-event-chain`;
  let chains = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains`);
  const active = chains.find((item) => item.status === 'active');
  if (active) {
    assert(active.content.events.length === EVENT_COUNT,
      `active event chain has ${active.content.events.length} events instead of ${EVENT_COUNT}`);
    return active;
  }
  const workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const generation = await startOrResumeAuthorGeneration(bookId, {
    path: `/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains/generate`,
    taskType: 'event_chain_generation', purpose: `volume-${volumeNumber}-event-chain-generation`,
    body: {
      expectedWorkflowVersion: workflow.planningVersion,
      idempotencyKey: key(volumeLabel(volumeNumber, 'event-chain-generation'))
    }
  });
  saveVolumeState('eventChainGenerationTaskIds', volumeNumber, generation.taskId, 'eventChainGenerationTaskId');
  await waitForTask(bookId, generation.taskId, `volume-${volumeNumber}-event-chain-generation`);
  chains = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains`);
  const candidate = [...chains].reverse().find((item) => item.status === 'candidate');
  assert(candidate, 'event-chain generation did not create an author-reviewable candidate');
  assert(candidate.content.events.length === EVENT_COUNT,
    `event-chain generation produced ${candidate.content.events.length} events instead of the author-requested ${EVENT_COUNT}`);
  if (volumeNumber === 1) {
    const launchResponsibilities = new Set(candidate.content.events.flatMap((event) =>
      event.firstVolumeResponsibilities
    ));
    assert(launchResponsibilities.size === 7,
      `first-volume event chain covers ${launchResponsibilities.size} strong-launch responsibilities instead of 7`);
  }
  const confirmed = await request(
    `/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/event-chains/${candidate.id}/confirm`,
    { method: 'POST', body: {} }
  );
  saveVolumeState('eventChainVersionIds', volumeNumber, confirmed.id, 'eventChainVersionId');
  log('event_chain_confirmed', {
    volumeNumber, eventChainVersionId: confirmed.id, eventCount: confirmed.content.events.length
  });
  return confirmed;
}

function eventPlanningIdea(event, volumeNumber, eventIndex) {
  if (volumeNumber === 1) return SCENARIO.eventIdea(eventIndex);
  const seed = event.latestVersion?.content ?? event.activeVersion?.content;
  assert(seed, `volume ${volumeNumber} event ${eventIndex + 1} has no volume seed`);
  const chapterStart = eventChapterStart(volumeNumber, eventIndex);
  const chapterEnd = chapterStart + CHAPTERS_PER_EVENT - 1;
  return `请在第${volumeNumber}卷已确认事件链约束下，设计事件“${seed.title}”，预计覆盖第${chapterStart}—${chapterEnd}章。它在本卷承担“${seed.volumeResponsibility}”，从“${seed.startingState}”出发，由“${seed.trigger}”触发，必须以人物的具体行动兑现“${seed.requiredResult}”。只承接上一事件真实结算和当前人物状态，不得重复第一卷已完成冲突，不得把未来计划写成既成事实。主要人物保持各自动机、选择和代价，对手根据已经公开的手段调整策略；结尾完成本事件承诺并自然引向下一事件。`;
}

async function planEvent(bookId, volumePlan, volumeNumber, eventIndex) {
  const globalIndex = globalEventIndex(volumeNumber, eventIndex);
  activePhase = `volume-${volumeNumber}-story-event-${eventIndex + 1}`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence/initialize`, {
      method: 'POST', body: {
        expectedWorkflowVersion: workflow.planningVersion,
        idempotencyKey: key(volumeLabel(volumeNumber, 'event-sequence'))
      }
    });
    log('event_sequence_initialized', { volumeNumber, revision: sequence.revision, eventCount: sequence.events.length });
  }
  assert(sequence.events.length === EVENT_COUNT, `expected ${EVENT_COUNT} events from confirmed volume, got ${sequence.events.length}`);
  let event = sequence.events[eventIndex];
  assert(event, `event ${eventIndex + 1} is missing`);
  save({ eventIds: { ...(state.eventIds ?? {}), [globalIndex]: event.eventId } });
  if (event.activeVersionId !== null) return event;
  let ideaId = state.eventIdeaIds?.[globalIndex];
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'event', subjectType: 'story_event', subjectId: event.eventId,
      originalText: eventPlanningIdea(event, volumeNumber, eventIndex),
      idempotencyLabel: volumeLabel(volumeNumber, `event-${eventIndex + 1}-idea`)
    });
    ideaId = idea.authorInputId;
    save({ eventIdeaIds: { ...(state.eventIdeaIds ?? {}), [globalIndex]: ideaId } });
  }
  let eventTaskId = state.eventGenerationTaskIds?.[globalIndex];
  if (!eventTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    const generation = await startOrResumeAuthorGeneration(bookId, {
      path: `/api/v1/books/${bookId}/story-events/${event.eventId}/generate`,
      taskType: 'story_event_generation',
      purpose: `volume-${volumeNumber}-event-${eventIndex + 1}-generation`,
      body: {
        expectedEventRevision: event.revision, expectedActiveVersionId: event.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('event'),
        authorInputRefs: [ideaId], idempotencyKey: key(volumeLabel(volumeNumber, `event-${eventIndex + 1}-generate`))
      }
    });
    eventTaskId = generation.taskId;
    save({ eventGenerationTaskIds: { ...(state.eventGenerationTaskIds ?? {}), [globalIndex]: eventTaskId } });
    log('event_generation_started', {
      volumeNumber, eventIndex: eventIndex + 1, globalEventIndex: globalIndex + 1,
      taskId: eventTaskId, members: generation.view?.members ?? [], recovered: generation.recovered
    });
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
  await waitForTask(bookId, eventTaskId, `volume-${volumeNumber}-event-${eventIndex + 1}-candidates-and-editor`);
  let versions = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`);
  assert(['candidate_a', 'candidate_b', 'fusion'].every((kind) => versions.some((item) => item.candidateKind === kind)),
    'event generation did not create A, B and fusion candidates');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'event fusion candidate missing');
  const finalEventContent = volumeNumber === 1 ? SCENARIO.events[eventIndex] : null;
  if (!REAL_RELEASE && finalEventContent !== null
    && (selected.candidateKind !== 'author_edit' || selected.content.title !== finalEventContent.title)) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    selected = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, candidateKind: 'author_edit',
        parentVersionId: selected.storyEventVersionId, sourceTaskId: eventTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('event'),
        content: finalEventContent,
        idempotencyKey: key(volumeLabel(volumeNumber, `event-${eventIndex + 1}-author-final`))
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
  save({ eventVersionIds: { ...(state.eventVersionIds ?? {}), [globalIndex]: confirmed.activeVersionId } });
  log('story_event_confirmed', { volumeNumber, eventIndex: eventIndex + 1, globalEventIndex: globalIndex + 1, eventId: confirmed.eventId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planChapterSequence(bookId, event, volumeNumber, eventIndex) {
  const globalIndex = globalEventIndex(volumeNumber, eventIndex);
  activePhase = `volume-${volumeNumber}-event-${eventIndex + 1}-chapter-sequence`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  if (sequence === null || !sequence.valid) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/initialize`, {
      method: 'POST', body: {
        expectedWorkflowVersion: workflow.planningVersion,
        idempotencyKey: key(volumeLabel(volumeNumber, `event-${eventIndex + 1}-chapter-sequence-init`))
      }
    });
    log('chapter_sequence_initialized', { sequenceId: sequence.sequenceId, revision: sequence.revision });
  }
  if (sequence.activeVersionId !== null) {
    assert(sequence.outlines.length === CHAPTERS_PER_EVENT, `active chapter sequence has ${sequence.outlines.length} chapters, expected ${CHAPTERS_PER_EVENT}`);
    return sequence;
  }
  const savedCandidate = sequence.versions.filter((item) => item.status === 'candidate')
    .sort((left, right) => right.version - left.version)
    .find((item) => item.content.chapters.length === CHAPTERS_PER_EVENT);
  if (savedCandidate) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/confirm`, {
      method: 'POST', body: {
        sequenceVersionId: savedCandidate.sequenceVersionId, expectedSequenceRevision: sequence.revision,
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    save({ chapterSequenceVersionIds: { ...(state.chapterSequenceVersionIds ?? {}), [globalIndex]: confirmed.activeVersionId } });
    log('saved_chapter_sequence_confirmed', { volumeNumber, eventIndex: eventIndex + 1,
      sequenceVersionId: confirmed.activeVersionId, chapterCount: confirmed.outlines.length });
    return confirmed;
  }
  let ideaId = state.chapterSequenceIdeaIds?.[globalIndex];
  if (!ideaId) {
    const chapterStart = eventChapterStart(volumeNumber, eventIndex);
    const chapterEnd = chapterStart + CHAPTERS_PER_EVENT - 1;
    const idea = await createIdea(bookId, {
      surface: 'chapter_outline', subjectType: 'event_chapter_sequence', subjectId: event.eventId,
      originalText: `请把当前事件拆成精确10章，章号连续为${chapterStart}—${chapterEnd}。每章只有一个清晰责任，相邻章状态必须衔接；至少四名主要角色各有主动行动，对手会根据前一章结果调整策略；最后一章覆盖当前事件全部结束条件并自然引出后续。不要提前写正文。`,
      idempotencyLabel: volumeLabel(volumeNumber, `event-${eventIndex + 1}-chapter-sequence-idea`)
    });
    ideaId = idea.authorInputId;
    save({ chapterSequenceIdeaIds: { ...(state.chapterSequenceIdeaIds ?? {}), [globalIndex]: ideaId } });
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    let taskId = state.chapterSequenceTaskIds?.[globalIndex]?.[attempt];
    if (taskId) {
      const existingDetail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
      const existingTask = existingDetail.task;
      if (terminalFailures.has(existingTask.status)) {
        log('chapter_sequence_generation_retry_ready', {
          volumeNumber, eventIndex: eventIndex + 1, attempt, previousTaskId: taskId, previousStatus: existingTask.status
        });
        const next = { ...(state.chapterSequenceTaskIds?.[globalIndex] ?? {}) };
        delete next[attempt];
        save({ chapterSequenceTaskIds: { ...(state.chapterSequenceTaskIds ?? {}), [globalIndex]: next } });
        continue;
      }
    }
    if (!taskId) {
      const generation = await startOrResumeAuthorGeneration(bookId, {
        path: `/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generate`,
        taskType: 'event_chapter_sequence_generation',
        purpose: `volume-${volumeNumber}-event-${eventIndex + 1}-chapter-sequence-${attempt}`,
        body: {
          expectedSequenceRevision: sequence.revision, expectedWorkflowVersion: workflow.planningVersion,
          authorInputRefs: [ideaId],
          idempotencyKey: key(volumeLabel(volumeNumber,
            `event-${eventIndex + 1}-chapter-sequence-generate-${attempt}-revision-${sequence.revision}`))
        }
      });
      taskId = generation.taskId;
      save({ chapterSequenceTaskIds: { ...(state.chapterSequenceTaskIds ?? {}), [globalIndex]: { ...(state.chapterSequenceTaskIds?.[globalIndex] ?? {}), [attempt]: taskId } } });
      log('chapter_sequence_generation_started', {
        volumeNumber, eventIndex: eventIndex + 1, globalEventIndex: globalIndex + 1,
        attempt, taskId, member: generation.view?.members?.[0] ?? null, recovered: generation.recovered
      });
    }
    try {
      await waitForTask(bookId, taskId, `volume-${volumeNumber}-event-${eventIndex + 1}-chapter-sequence-attempt-${attempt}`);
    } catch (error) {
      const detail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
      if (!terminalFailures.has(detail.task.status) || attempt === 5) throw error;
      log('chapter_sequence_generation_attempt_failed', {
        volumeNumber, eventIndex: eventIndex + 1, attempt, taskId,
        status: detail.task.status, errorCode: detail.task.errorCode
      });
      continue;
    }
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
    save({ chapterSequenceVersionIds: { ...(state.chapterSequenceVersionIds ?? {}), [globalIndex]: confirmed.activeVersionId } });
    log('chapter_sequence_confirmed', { volumeNumber, eventIndex: eventIndex + 1, globalEventIndex: globalIndex + 1, sequenceVersionId: confirmed.activeVersionId, chapterCount: confirmed.outlines.length });
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

async function pendingManuscriptForTask(bookId, taskId) {
  const taskDetail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
  const expectedVersionId = taskDetail.task?.checkpoint?.manuscriptVersionId
    ?? taskDetail.task?.brief?.manuscriptVersionId
    ?? null;
  assert(typeof expectedVersionId === 'string' && expectedVersionId.length > 0,
    `task ${taskId} does not expose its exact manuscript version`);
  const confirmations = await request(`/api/v1/books/${bookId}/confirmations`);
  const confirmation = confirmations.find((item) => item.status === 'pending'
    && item.target_type === 'manuscript'
    && item.target_id === expectedVersionId);
  assert(confirmation, `task ${taskId} waiting without an exact-version manuscript confirmation`);
  return confirmation;
}

async function acceptPendingManuscript(bookId, taskId) {
  const confirmation = await pendingManuscriptForTask(bookId, taskId);
  const chapter = (await chapterList(bookId)).find((item) => item.currentManuscriptVersionId === confirmation.target_id);
  assert(chapter, `task ${taskId} pending manuscript is not the chapter current version`);
  const detail = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`);
  assertReleaseReviewIsAcceptable(detail, confirmation.target_id, chapter.chapterNumber);
  await request(`/api/v1/books/${bookId}/confirmations/${confirmation.confirmation_id}/accept`, {
    method: 'POST', body: { expectedCanonRevision: confirmation.expected_canon_revision }
  });
  log('manuscript_confirmed', { taskId, confirmationId: confirmation.confirmation_id });
}

function assertReleaseReviewIsAcceptable(detail, manuscriptVersionId, chapterNumber) {
  assertReleaseReviewGate(detail, manuscriptVersionId, chapterNumber, REAL_RELEASE);
}

async function pauseForManualReading(bookId, taskId, chapterNumber) {
  const confirmation = await pendingManuscriptForTask(bookId, taskId);
  const chapter = (await chapterList(bookId)).find((item) => item.currentManuscriptVersionId === confirmation.target_id);
  assert(chapter, `chapter ${chapterNumber} is missing while waiting for manual reading`);
  const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
  const detail = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`);
  const latestReview = latestCompleteReleaseReview(detail, confirmation.target_id);
  assert(latestReview && latestReview.reports.length === 3,
    `chapter ${chapterNumber} latest pending manuscript does not have one complete three-seat review panel`);
  let releaseReadinessError = null;
  try {
    assertReleaseReviewIsAcceptable(detail, confirmation.target_id, chapterNumber);
  } catch (error) {
    releaseReadinessError = error instanceof Error ? error.message : String(error);
  }
  const reviewFile = join(ROOT, `pending-chapter-${chapterNumber}.json`);
  writeFileSync(reviewFile, `${JSON.stringify({
    generatedAt: now(), bookId, chapterNumber, chapterId: chapter.chapterId,
    title: chapter.title, taskId, confirmationId: confirmation.confirmation_id,
    manuscriptVersionId: confirmation.target_id, content,
    reviewPanelId: latestReview.panel.review_panel_id,
    releaseReady: releaseReadinessError === null,
    releaseReadinessError,
    reviews: latestReview.reports
  }, null, 2)}\n`, 'utf8');
  save({ waitingManualReading: { chapterNumber, chapterId: chapter.chapterId, taskId, reviewFile } });
  log(releaseReadinessError === null ? 'chapter_waiting_manual_reading' : 'chapter_needs_pm_revision', {
    chapterNumber, chapterId: chapter.chapterId, taskId, reviewFile,
    ...(releaseReadinessError === null ? {} : { reason: releaseReadinessError })
  });
  if (releaseReadinessError !== null) return { waitingManualReading: true, requiresRevision: true };
  if (CONTINUOUS_MANUAL) {
    const approvalFile = join(ROOT, `approve-chapter-${chapterNumber}.signal`);
    while (!existsSync(approvalFile)) await sleep(2_000);
    rmSync(approvalFile, { force: true });
    save({ waitingManualReading: null });
    log('chapter_manual_reading_approved', { chapterNumber, chapterId: chapter.chapterId, taskId });
    return { waitingManualReading: false, approved: true };
  }
  return { waitingManualReading: true };
}

async function chapterList(bookId) { return request(`/api/v1/books/${bookId}/chapters`); }
async function resumableChapterTask(bookId, chapterId) {
  return selectResumableChapterTask(await request(`/api/v1/books/${bookId}/tasks`), chapterId);
}

function formalCharacterCount(content) {
  return [...String(content ?? '')].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

const naturalLanguageLeakPattern = /(?:本章写作要求|事件触发条件|事件结束条件|结算实际结果|当前事件(?:大纲|章纲)?|章纲(?:要求|约束)|设定大纲|资料库(?:记录|条目)|正式来源|可核验来源|AI(?:成员|审查|点评)|内部检查说明)/u;

function narrativeLeak(text) {
  return naturalLanguageLeakPattern.exec(String(text ?? ''));
}

function assertReadableChapter(number, content) {
  const text = String(content.content ?? '');
  const effectiveCharacterCount = formalCharacterCount(text);
  assert(effectiveCharacterCount >= 2_350 && effectiveCharacterCount <= 3_650,
    `chapter ${number} effective length ${effectiveCharacterCount} outside 2350-3650 (raw ${content.totalLength})`);
  const internalMatch = /(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.exec(text);
  assert(internalMatch === null,
    `chapter ${number} exposes internal code or workflow fields: ${internalMatch?.[0]} near ${text.slice(Math.max(0, (internalMatch?.index ?? 0) - 80), (internalMatch?.index ?? 0) + 160)}`);
  const naturalLanguageMatch = narrativeLeak(text);
  assert(naturalLanguageMatch === null,
    `chapter ${number} exposes internal review or planning language: ${naturalLanguageMatch?.[0]}`);
  assert(!/(?:待补充|TODO|这里填写|示例正文|(?:^|\n)\s*[【\[]?系统提示[】\]]?\s*[：:])/u.test(text),
    `chapter ${number} contains placeholder text`);
  return effectiveCharacterCount;
}

function paragraphFingerprints(text) {
  return String(text).split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter((paragraph) => formalCharacterCount(paragraph) >= 40);
}

function characterTrigrams(text) {
  const normalized = String(text).replace(/[^\p{L}\p{N}]/gu, '');
  const values = new Set();
  for (let index = 0; index + 3 <= normalized.length; index += 1) values.add(normalized.slice(index, index + 3));
  return values;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function assertManuscriptIsNotTemplateCopies(chapters) {
  const occurrences = new Map();
  let maximumAdjacentSimilarity = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const seenInChapter = new Set();
    for (const paragraph of paragraphFingerprints(chapter.text)) {
      assert(!seenInChapter.has(paragraph), `chapter ${chapter.chapterNumber} repeats the same long paragraph`);
      seenInChapter.add(paragraph);
      const previous = occurrences.get(paragraph) ?? [];
      previous.push(chapter.chapterNumber);
      occurrences.set(paragraph, previous);
    }
    if (index > 0) {
      const previous = chapters[index - 1];
      const similarity = jaccard(characterTrigrams(previous.text), characterTrigrams(chapter.text));
      maximumAdjacentSimilarity = Math.max(maximumAdjacentSimilarity, similarity);
      assert(similarity < 0.72,
        `chapters ${previous.chapterNumber} and ${chapter.chapterNumber} are suspiciously similar (${similarity.toFixed(3)})`);
    }
  }
  const repeated = [...occurrences.entries()].filter(([, chapterNumbers]) => chapterNumbers.length >= 3);
  assert(repeated.length === 0,
    `manuscript repeats ${repeated.length} long paragraphs across three or more chapters; sample chapters: ${repeated[0]?.[1].join(',') ?? ''}`);
  return {
    repeatedLongParagraphs: repeated.length,
    maximumAdjacentSimilarity,
    dialogueChapterRatio: chapters.filter((chapter) => /“[^”]{2,}”/u.test(chapter.text)).length / chapters.length
  };
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
    if (REAL_RELEASE && MANUAL_REVIEW && OWNER_AUTHORIZED_RELEASE) {
      const ownerReview = await pauseForManualReading(bookId, task.taskId, chapterNumber);
      if (ownerReview.requiresRevision) return ownerReview;
      log('chapter_owner_authorized_release', {
        chapterNumber,
        taskId: task.taskId,
        manuscriptVersionId: review.task?.checkpoint?.manuscriptVersionId ?? null
      });
    } else if (REAL_RELEASE && MANUAL_REVIEW && (!APPROVE_PENDING || approvalConsumed)) {
      const manual = await pauseForManualReading(bookId, task.taskId, chapterNumber);
      if (manual.waitingManualReading) return manual;
    }
    if (REAL_RELEASE && MANUAL_REVIEW) approvalConsumed = true;
    await acceptPendingManuscript(bookId, task.taskId);
    save({ waitingManualReading: null });
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
  assertReleaseReviewIsAcceptable(detail, content.manuscriptVersionId, chapterNumber);
  save({ settledChapters: [...new Set([...state.settledChapters, chapterNumber])].sort((a, b) => a - b) });
  log('chapter_settled', {
    chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
    manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
    characterCount, reviewReportCount: detail.production.reviewReports.length
  });
}

async function prepareAndWriteEventChapters(bookId, event) {
  await saveExpressionProfile(bookId);
  const initialSequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  for (const outline of initialSequence.outlines.filter((item) => item.status === 'settled')) {
    if (outline.chapterNumber > ownerAuthorizedBatchEnd) return { batchCapReached: true };
    await generateChapter(bookId, outline.chapterNumber, outline);
  }
  for (let pass = 1; pass <= 30; pass += 1) {
    let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const unsettled = sequence.outlines.filter((item) => item.status !== 'settled')
      .sort((left, right) => left.chapterNumber - right.chapterNumber);
    if (unsettled.length === 0) return;
    const alreadyFrozen = unsettled.filter((item) => item.status === 'frozen').slice(0, 3);
    if (alreadyFrozen.length > 0) {
      for (const outline of alreadyFrozen) {
        if (outline.chapterNumber > ownerAuthorizedBatchEnd) return { batchCapReached: true };
        const result = await generateChapter(bookId, outline.chapterNumber, outline);
        if (result?.waitingManualReading) return result;
      }
      continue;
    }
    const targets = unsettled.slice(0, 3);
    const start = targets[0].chapterNumber;
    const end = targets.at(-1).chapterNumber;
    const lackingDetails = targets.some((item) => currentOutlineCandidate(item) === null);
    if (lackingDetails) {
      activePhase = `chapter-details-${start}-${end}`;
      const workflow = await request(`/api/v1/books/${bookId}/workflow`);
      const detailAttempt = `chapter-details-${start}-${end}-sequence-${sequence.revision}`;
      const priorAttempts = (state.taskEvidence ?? [])
        .filter((item) => String(item.purpose ?? '').startsWith(detailAttempt)).length;
      const requestAttempt = `${detailAttempt}-attempt-${priorAttempts + 1}`;
      const generation = await startOrResumeAuthorGeneration(bookId, {
        path: `/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/generate`,
        taskType: 'event_chapter_detail_generation', purpose: requestAttempt,
        body: {
          count: targets.length, expectedSequenceRevision: sequence.revision,
          expectedWorkflowVersion: workflow.planningVersion, authorInputRefs: [],
          idempotencyKey: key(requestAttempt)
        }
      });
      log('chapter_details_generation_started', {
        start, count: targets.length, taskId: generation.taskId,
        member: generation.view?.members?.[0] ?? null, recovered: generation.recovered
      });
      const purpose = requestAttempt;
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
    assert(freshTargets.every((item) => currentOutlineCandidate(item) !== null),
      `detailed outlines ${start}-${end} have no current candidate version`);
    const workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const frozen = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/freeze`, {
      method: 'POST', body: {
        items: freshTargets.map((item) => ({
          outlineId: item.outlineId, outlineVersionId: currentOutlineCandidate(item).outlineVersionId,
          expectedOutlineRevision: item.revision
        })),
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    log('chapter_outlines_frozen', { start, count: freshTargets.length, workflowStage: (await request(`/api/v1/books/${bookId}/workflow`)).stage });
    for (const target of freshTargets) {
      const outline = frozen.outlines.find((item) => item.outlineId === target.outlineId);
      assert(outline?.status === 'frozen', `chapter ${target.chapterNumber} outline was not frozen`);
      if (target.chapterNumber > ownerAuthorizedBatchEnd) return { batchCapReached: true };
      const result = await generateChapter(bookId, target.chapterNumber, outline);
      if (result?.waitingManualReading) return result;
    }
  }
  throw new Error('event chapter workflow exceeded 30 resumable passes');
}

async function settleEvent(bookId, event, volumeNumber, eventIndex) {
  const globalIndex = globalEventIndex(volumeNumber, eventIndex);
  activePhase = `volume-${volumeNumber}-event-${eventIndex + 1}-settlement`;
  const existing = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settlement`);
  if (existing !== null) {
    const expectedStart = eventChapterStart(volumeNumber, eventIndex);
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
  const expectedStart = eventChapterStart(volumeNumber, eventIndex);
  const expectedEnd = expectedStart + CHAPTERS_PER_EVENT - 1;
  assert(eventSettlement.chapterStart === expectedStart && eventSettlement.chapterEnd === expectedEnd,
    `event settlement range is not ${expectedStart}-${expectedEnd}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const expectedNextStage = eventIndex === EVENT_COUNT - 1 ? 'volume_settlement_in_progress' : 'event_sequence_in_progress';
  assert(workflow.stage === expectedNextStage, `expected ${expectedNextStage} after event settlement, got ${workflow.stage}`);
  save({ eventSettlementIds: { ...(state.eventSettlementIds ?? {}), [globalIndex]: eventSettlement.settlementId } });
  log('event_settled', { volumeNumber, eventIndex: eventIndex + 1, globalEventIndex: globalIndex + 1, settlementId: eventSettlement.settlementId, canonRevision: eventSettlement.canonRevision, nextStage: workflow.stage });
  return eventSettlement;
}

async function settleVolume(bookId, volumePlan, volumeNumber) {
  activePhase = `volume-${volumeNumber}-settlement`;
  const existing = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/settlement`);
  const range = volumeChapterRange(volumeNumber);
  if (existing !== null) {
    assert(existing.chapterStart === range.chapterStart && existing.chapterEnd === range.chapterEnd,
      `existing volume ${volumeNumber} settlement range is not ${range.chapterStart}-${range.chapterEnd}`);
    return { volumeSettlement: existing, workflow: await request(`/api/v1/books/${bookId}/workflow`) };
  }
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'volume_settlement_in_progress', `expected volume settlement stage, got ${workflow.stage}`);
  const volumeSettlement = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  assert(volumeSettlement.chapterStart === range.chapterStart && volumeSettlement.chapterEnd === range.chapterEnd,
    `volume ${volumeNumber} settlement range is not ${range.chapterStart}-${range.chapterEnd}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'ready_for_next_volume', `expected next-volume ready stage, got ${workflow.stage}`);
  saveVolumeState('volumeSettlementIds', volumeNumber, volumeSettlement.settlementId, 'volumeSettlementId');
  log('volume_settled', { volumeNumber, settlementId: volumeSettlement.settlementId, chapterStart: range.chapterStart, chapterEnd: range.chapterEnd, nextStage: workflow.stage });
  return { volumeSettlement, workflow };
}

async function collectEvidence(bookId, runVolumePlans, events, settlements) {
  activePhase = 'final-evidence';
  const [book, profile, workflow, settings, chapters, workspace, volumePlans, ideas] = await Promise.all([
    request(`/api/v1/books/${bookId}`), request(`/api/v1/books/${bookId}/book-profile`),
    request(`/api/v1/books/${bookId}/workflow`), request(`/api/v1/books/${bookId}/setting-outline-workspace`),
    chapterList(bookId), request(`/api/v1/books/${bookId}/workspace`),
    request(`/api/v1/books/${bookId}/volume-plans`),
    request(`/api/v1/books/${bookId}/author-planning-inputs`)
  ]);
  const [eventSequences, chapterSequences] = await Promise.all([
    Promise.all(runVolumePlans.map((volumePlan) =>
      request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`))),
    Promise.all(events.map((event) =>
      request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`)))
  ]);
  assert(workspace.agents.length === 14, `workspace has ${workspace.agents.length} agents instead of 14`);
  assert(new Set(workspace.agents.map((agent) => agent.roleKey)).size === 14, 'agent role keys are not unique');
  const settled = chapters.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
  assert(settled.length === RELEASE_TARGET_CHAPTERS,
    `expected exactly ${RELEASE_TARGET_CHAPTERS} settled chapters, got ${settled.length}`);
  assert(settled.every((chapter, index) => chapter.chapterNumber === index + 1),
    `settled chapters are not contiguous 1-${RELEASE_TARGET_CHAPTERS}`);
  assert(runVolumePlans.length === TARGET_VOLUME_COUNT,
    `expected ${TARGET_VOLUME_COUNT} confirmed volume plans, got ${runVolumePlans.length}`);
  assert(events.length === TARGET_EVENT_COUNT,
    `expected ${TARGET_EVENT_COUNT} confirmed events, got ${events.length}`);
  assert(eventSequences.every((sequence) => sequence?.events.length === EVENT_COUNT),
    `each volume must contain exactly ${EVENT_COUNT} events`);
  assert(chapterSequences.every((sequence) => sequence?.outlines.length === CHAPTERS_PER_EVENT),
    `each event must contain exactly ${CHAPTERS_PER_EVENT} chapter outlines`);
  assert(settlements.eventSettlements.length === TARGET_EVENT_COUNT,
    `expected ${TARGET_EVENT_COUNT} event settlements, got ${settlements.eventSettlements.length}`);
  assert(settlements.volumeSettlements.length === TARGET_COMPLETED_VOLUME_COUNT,
    `expected ${TARGET_COMPLETED_VOLUME_COUNT} volume settlements, got ${settlements.volumeSettlements.length}`);
  const chapterEvidence = [];
  const manuscriptTexts = [];
  const manuscriptChapters = [];
  for (const chapter of settled) {
    const [content, detail] = await Promise.all([
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`),
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`)
    ]);
    manuscriptTexts.push(content.content);
    manuscriptChapters.push({ chapterNumber: chapter.chapterNumber, text: content.content });
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
  const manuscriptOriginality = assertManuscriptIsNotTemplateCopies(manuscriptChapters);
  for (const requiredName of SCENARIO.requiredNames) {
    assert(wholeManuscript.includes(requiredName), `${RELEASE_TARGET_CHAPTERS}-chapter manuscript is missing active character ${requiredName}`);
  }
  for (const requiredStoryTerm of SCENARIO.requiredTerms) {
    assert(wholeManuscript.includes(requiredStoryTerm), `${RELEASE_TARGET_CHAPTERS}-chapter manuscript is missing ${SCENARIO.key} story term ${requiredStoryTerm}`);
  }
  assert(SCENARIO.forbiddenTerms.every((term) => !wholeManuscript.includes(term)), `${SCENARIO.key} manuscript leaked unrelated story terms`);
  if (!REAL_RELEASE) {
    assert(events.slice(0, EVENT_COUNT).map((event) => event.activeVersion?.content.title).join('|') === SCENARIO.events.map((event) => event.title).join('|'),
      `confirmed events are not the ${EVENT_COUNT} required ${SCENARIO.key} event contracts`);
  }
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
    releaseId: RELEASE_ID, completedAt: now(), evidenceLevel: `E2-current-workflow-${RELEASE_TARGET_CHAPTERS}-chapters-${SCENARIO.key}`,
    limitation: `${RELEASE_TARGET_CHAPTERS}章流程证据证明当前对象链、任务、审查、正文与结算可运行和可追溯；自动指标只能拦截明显重复、泄漏和结构故障，发布级文学质量仍需要人工通读确认。`,
    book: { bookId, title: book.title, status: book.status, canonRevision: book.canonRevision },
    profile, workflow, settings: settings.map((item) => ({ itemKey: item.itemKey, label: item.label, status: item.status })),
    team: workspace.agents.map((agent) => ({
      agentId: agent.agentId, roleKey: agent.roleKey, displayName: agent.displayName,
      provider: agent.provider, modelId: agent.modelId, activationState: agent.activationState
    })),
    modelParticipants, taskEvidence: state.taskEvidence,
    volumePlans: runVolumePlans.map((runPlan) => volumePlans.find((item) => item.volumePlanId === runPlan.volumePlanId)),
    eventSequences, chapterSequences, authorIdeas: ideaEvidence,
    chapters: chapterEvidence, manuscriptOriginality, settlements
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
  assert(!REAL_RELEASE || [20, 50, 100, 200].includes(RELEASE_TARGET_CHAPTERS),
    '真实发布级门禁只允许20、50、100或200章；200章必须由两个完整百章卷组成');
  assert(!REAL_RELEASE || MANUAL_REVIEW,
    '真实发布级运行必须开启逐章人工阅读，不能自动确认模型正文');
  assert(!OWNER_AUTHORIZED_RELEASE || REAL_RELEASE,
    '老板统一授权模式只允许用于真实发布级专用测试书');
  assert(!OWNER_AUTHORIZED_RELEASE || RELEASE_TARGET_CHAPTERS === 200,
    '老板统一授权模式只允许本轮两本200章专用测试书');
  assert(!OWNER_AUTHORIZED_RELEASE || OWNER_AUTHORIZED_BOOK_IDS.has(OWNER_AUTHORIZED_BOOK_ID),
    '当前书未列入本轮老板统一授权白名单');
  await issueSession();
  const healthEnvelope = await fetch(`${API}/health`).then((response) => response.json());
  const health = healthEnvelope.data ?? healthEnvelope;
  assert(health.status === 'ok' && health.releaseId === RELEASE_ID, `API health mismatch: ${JSON.stringify(health)}`);
  const bookId = await createBook();
  assert(!OWNER_AUTHORIZED_RELEASE || bookId === OWNER_AUTHORIZED_BOOK_ID,
    '当前运行书籍与老板统一授权的精确书籍ID不一致');
  if (OWNER_AUTHORIZED_RELEASE) {
    const currentChapters = await chapterList(bookId);
    const settledAtStart = currentChapters
      .filter((chapter) => chapter.settlementStatus === 'settled')
      .reduce((maximum, chapter) => Math.max(maximum, Number(chapter.chapterNumber ?? 0)), 0);
    const remaining = Math.max(0, RELEASE_TARGET_CHAPTERS - settledAtStart);
    const plannedChapters = Math.min(OWNER_AUTHORIZED_BATCH_CAP, remaining);
    const startup = batchStartupGate({ packageBalanceUnknown: true, plannedChapters });
    assert(startup.allow, `本轮真实调用超过套餐余额未知时的单次${startup.evidence.cap}章上限`);
    ownerAuthorizedBatchEnd = Math.min(RELEASE_TARGET_CHAPTERS, settledAtStart + OWNER_AUTHORIZED_BATCH_CAP);
    log('owner_authorized_batch_started', {
      settledAtStart,
      batchEnd: ownerAuthorizedBatchEnd,
      targetChapters: RELEASE_TARGET_CHAPTERS,
      cap: OWNER_AUTHORIZED_BATCH_CAP
    });
  }
  if (OWNER_AUTHORIZED_RELEASE && state.waitingManualReading !== undefined && state.waitingManualReading !== null) {
    save({ waitingManualReading: null });
    log('stale_manual_pause_cleared', { reason: 'owner_authorized_exact_book' });
  }
  await ensureTestBudget(bookId);
  await completeSettings(bookId);
  const volumePlans = [];
  const events = [];
  const eventSettlements = [];
  const volumeSettlements = [];
  let ownerBatchCapReached = false;
  for (let volumeNumber = 1; volumeNumber <= TARGET_VOLUME_COUNT; volumeNumber += 1) {
    const volumePlan = await planVolume(bookId, volumeNumber);
    volumePlans.push(volumePlan);
    for (let eventIndex = 0; eventIndex < EVENT_COUNT; eventIndex += 1) {
      const chapterStart = eventChapterStart(volumeNumber, eventIndex);
      if (chapterStart > RELEASE_TARGET_CHAPTERS) break;
      const event = await planEvent(bookId, volumePlan, volumeNumber, eventIndex);
      events.push(event);
      await planChapterSequence(bookId, event, volumeNumber, eventIndex);
      const writing = await prepareAndWriteEventChapters(bookId, event);
      if (writing?.batchCapReached) {
        ownerBatchCapReached = true;
        log('owner_authorized_batch_completed', {
          completedThroughChapter: ownerAuthorizedBatchEnd,
          targetChapters: RELEASE_TARGET_CHAPTERS
        });
        break;
      }
      if (writing?.waitingManualReading) {
        log('release_run_paused', {
          reason: 'manual_reading', volumeNumber, eventIndex: eventIndex + 1,
          globalEventIndex: globalEventIndex(volumeNumber, eventIndex) + 1,
          waiting: state.waitingManualReading
        });
        break;
      }
      eventSettlements.push(await settleEvent(bookId, event, volumeNumber, eventIndex));
    }
    if (ownerBatchCapReached) break;
    if (state.waitingManualReading !== undefined && state.waitingManualReading !== null) break;
    const range = volumeChapterRange(volumeNumber);
    if (RELEASE_TARGET_CHAPTERS < range.chapterEnd) {
      log('release_gate_completed', { chapters: RELEASE_TARGET_CHAPTERS, volumeNumber, plannedVolumeChapters: TOTAL_CHAPTERS });
      break;
    }
    volumeSettlements.push(await settleVolume(bookId, volumePlan, volumeNumber));
  }
  if (ownerBatchCapReached) process.exit(0);
  if (state.waitingManualReading !== undefined && state.waitingManualReading !== null) process.exit(0);
  assert(volumeSettlements.length === TARGET_COMPLETED_VOLUME_COUNT,
    `expected ${TARGET_COMPLETED_VOLUME_COUNT} completed volume settlements, got ${volumeSettlements.length}`);
  await collectEvidence(bookId, volumePlans, events, { eventSettlements, volumeSettlements });
} catch (error) {
  issue(error);
  console.error(error);
  process.exitCode = 1;
}
