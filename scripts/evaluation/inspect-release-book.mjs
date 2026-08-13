import { loginEvaluationAccount } from './lib/evaluation-account.mjs';
import { DatabaseSync } from 'node:sqlite';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const title = String(process.argv[2] ?? '').trim();
const view = String(process.argv[3] ?? 'settings').trim();
const targetId = String(process.argv[4] ?? '').trim();

if (!title) throw new Error('book title is required');

const cookie = await loginEvaluationAccount({ api: API, origin: ORIGIN });

async function request(path) {
  const response = await fetch(`${API}${path}`, { headers: { cookie } });
  const payload = await response.json();
  if (!response.ok || payload.error !== undefined) {
    throw new Error(`${path} failed: ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.data;
}

const books = await request('/api/v1/books');
const book = books.find((candidate) => candidate.title === title);
if (book === undefined) throw new Error(`book not found: ${title}`);
const bookId = book.bookId ?? book.book_id;

if (view === 'settings') {
  const settings = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
  console.log(JSON.stringify({
    bookId,
    title,
    settings: settings
      .filter((item) => item.status === '已确认')
      .map((item) => ({ itemKey: item.itemKey, label: item.label, content: item.content }))
  }, null, 2));
} else if (view === 'workflow') {
  const workflow = await request(`/api/v1/books/${bookId}/workflow`);
  console.log(JSON.stringify({ bookId, title, workflow }, null, 2));
} else if (view === 'task') {
  if (!targetId) throw new Error('task id is required for task view');
  const task = await request(`/api/v1/books/${bookId}/tasks/${targetId}`);
  console.log(JSON.stringify({ bookId, title, task }, null, 2));
} else if (view === 'task-outputs') {
  if (!targetId) throw new Error('task id is required for task-outputs view');
  const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
  const outputs = database.prepare(`
    SELECT m.phase_key, m.provider, m.model_id, m.state, m.error_class,
      r.output_text, r.input_tokens, r.output_tokens
    FROM model_calls m
    LEFT JOIN model_call_results r ON r.request_id = m.request_id
    WHERE m.owner_id = ? AND m.book_id = ? AND m.task_id = ?
    ORDER BY m.created_at, m.request_id
  `).all((database.prepare('SELECT owner_id FROM books WHERE book_id = ?').get(bookId)).owner_id, bookId, targetId);
  database.close();
  console.log(JSON.stringify({ bookId, title, outputs }, null, 2));
} else if (view === 'tasks') {
  const tasks = await request(`/api/v1/books/${bookId}/tasks`);
  const active = tasks.filter((task) => !['succeeded', 'failed', 'cancelled'].includes(task.status));
  const details = [];
  for (const task of active) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${task.taskId}`);
    details.push({
      task: detail.task,
      unresolvedModelCalls: (detail.modelCalls ?? []).filter((call) => ['pending', 'working', 'interrupted'].includes(call.state))
    });
  }
  console.log(JSON.stringify({ bookId, title, activeTasks: details }, null, 2));
} else if (view === 'reconciliation') {
  const reconciliation = await request(`/api/v1/books/${bookId}/budgets/reconciliation`);
  console.log(JSON.stringify({ bookId, title, reconciliation }, null, 2));
} else if (view === 'unresolved-calls') {
  const tasks = await request(`/api/v1/books/${bookId}/tasks`);
  const unresolved = [];
  for (const task of tasks) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${task.taskId}`);
    for (const call of detail.modelCalls ?? []) {
      if (['pending', 'working', 'interrupted'].includes(call.state)) {
        unresolved.push({ task: detail.task, call });
      }
    }
  }
  console.log(JSON.stringify({ bookId, title, unresolved }, null, 2));
} else if (view === 'workspace') {
  const workspace = await request(`/api/v1/books/${bookId}/workspace`);
  console.log(JSON.stringify({
    bookId,
    title,
    agents: workspace.agents.map((agent) => ({
      agentId: agent.agentId,
      displayName: agent.displayName,
      roleKey: agent.roleKey,
      provider: agent.provider,
      modelId: agent.modelId,
      state: agent.state
    }))
  }, null, 2));
} else if (view === 'audit') {
  const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
  const ownerId = database.prepare('SELECT owner_id FROM books WHERE book_id = ?').get(bookId).owner_id;
  const scoped = (sql) => database.prepare(sql).all(ownerId, bookId);
  const chapters = scoped(`SELECT chapter_number, title, plan_status, generation_status, settlement_status
    FROM chapters WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number`);
  const events = scoped(`SELECT sequence_order, status FROM story_events
    WHERE owner_id = ? AND book_id = ? ORDER BY sequence_order`);
  const outlines = scoped(`SELECT o.chapter_number, o.status, v.content_json
    FROM event_chapter_outlines o
    LEFT JOIN event_chapter_outline_versions v
      ON v.event_chapter_outline_version_id = o.active_version_id
      AND v.owner_id = o.owner_id AND v.book_id = o.book_id
    WHERE o.owner_id = ? AND o.book_id = ? ORDER BY o.chapter_number`)
    .map((outline) => ({
      chapterNumber: outline.chapter_number,
      status: outline.status,
      title: outline.content_json === null || outline.content_json === undefined
        ? null
        : JSON.parse(outline.content_json).title ?? null
    }));
  const artifacts = scoped(`SELECT artifact_type, status, COUNT(1) AS count FROM artifacts
    WHERE owner_id = ? AND book_id = ? GROUP BY artifact_type, status ORDER BY artifact_type, status`);
  const tasks = scoped(`SELECT task_type, status, COUNT(1) AS count FROM tasks
    WHERE owner_id = ? AND book_id = ? GROUP BY task_type, status ORDER BY task_type, status`);
  database.close();
  const library = await request(`/api/v1/books/${bookId}/library`);
  console.log(JSON.stringify({
    bookId, title, ownerId, chapters, events, outlines, artifacts, tasks,
    library: {
      summary: library.summary,
      supportingCharacters: library.supportingCharacterProfiles?.map((profile) => profile.name),
      organizations: library.organizationProfiles?.map((profile) => profile.name),
      locations: library.locationProfiles?.map((profile) => profile.name),
      items: library.itemResourceProfiles?.map((profile) => profile.name),
      timeline: library.timeline?.map((entry) => ({ title: entry.title, chapterRange: entry.chapterRange, storyTime: entry.storyTime })),
      worldMap: library.worldMap,
      protagonists: library.protagonists
    }
  }, null, 2));
} else {
  throw new Error(`unsupported view: ${view}`);
}
