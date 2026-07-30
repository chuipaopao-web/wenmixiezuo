import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = mkdtempSync(join(tmpdir(), 'wenmi-book-create-e2e-'));
const apiPort = 43221;
const webOrigin = 'http://127.0.0.1:43220';
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WENMI_DATA_DIR: dataDir,
    WENMI_API_PORT: String(apiPort),
    WENMI_WEB_ORIGIN: webOrigin,
    WENMI_MODEL_MODE: 'deterministic'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

let cookie = '';
try {
  const health = await waitForHealth(`http://127.0.0.1:${apiPort}/health`);
  assert(health.ok, `health failed: ${health.status}`);
  const session = await fetch(`http://127.0.0.1:${apiPort}/api/v1/runtime/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webOrigin, 'sec-fetch-site': 'same-site' },
    body: '{}'
  });
  assert(session.ok, `session failed: ${session.status}`);
  cookie = session.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert(cookie.length > 0, 'runtime session cookie missing');

  const taxonomy = await request('/api/v1/opening-taxonomy');
  const boundaryCount = taxonomy.boundaryGroups.reduce((total, group) => total + group.options.length, 0);
  assert(taxonomy.boundaryGroups.length === 4 && boundaryCount === 24, 'must-follow catalog is incomplete');

  const maleBlueprint = blueprint({
    taxonomyVersion: taxonomy.version,
    channel: 'male',
    categoryKey: 'male-fantasy-brain',
    role: 'male_lead',
    name: '陆沉',
    mainTags: ['玄幻', '成长'],
    mustFollow: ['不写后宫', '不靠误会强推剧情']
  });
  const femaleBlueprint = blueprint({
    taxonomyVersion: taxonomy.version,
    channel: 'female',
    categoryKey: 'female-modern-brain',
    role: 'female_lead',
    name: '沈簪',
    mainTags: ['现言', '脑洞'],
    mustFollow: ['无额外限制']
  });

  await expectStatus('/api/v1/books/drafts', 400, {
    method: 'POST',
    body: { text: maleBlueprint.fullBookOutline, openingBlueprint: maleBlueprint }
  }, 'missing title');
  await expectStatus('/api/v1/books/drafts', 400, {
    method: 'POST',
    body: {
      title: '跨频道错误书',
      text: maleBlueprint.fullBookOutline,
      openingBlueprint: { ...maleBlueprint, categoryKey: 'female-modern-brain' }
    }
  }, 'cross-channel category');
  await expectStatus('/api/v1/books/drafts', 400, {
    method: 'POST',
    body: {
      title: '边界过量错误书',
      text: maleBlueprint.fullBookOutline,
      openingBlueprint: { ...maleBlueprint, mustFollow: Array.from({ length: 16 }, (_, index) => `边界${index + 1}`) }
    }
  }, 'too many must-follow rules');

  const male = await createAndConfirm('端到端测试书·男频', maleBlueprint);
  const female = await createAndConfirm('端到端测试书·女频', femaleBlueprint);
  assert(male.agentCount === 11 && female.agentCount === 11, 'team creation count mismatch');
  assert(Boolean(male.kickoffTaskId) && Boolean(female.kickoffTaskId), 'chief-editor kickoff task missing');
  assert(Boolean(male.openingBlueprintId) && Boolean(female.openingBlueprintId), 'opening blueprint snapshot missing');

  const staleDraft = await request('/api/v1/books/drafts', {
    method: 'POST',
    body: { title: '错误版本不应建书', text: maleBlueprint.fullBookOutline, openingBlueprint: maleBlueprint }
  });
  const staleConfirmation = await expectStatus(`/api/v1/book-drafts/${staleDraft.draftId}/confirm`, 409, {
    method: 'POST',
    body: { expectedVersion: staleDraft.version + 1 }
  }, 'stale draft confirmation');
  assert(staleConfirmation.error?.code === 'BOOK_VERSION_CONFLICT', 'stale confirmation error code mismatch');
  assert(staleConfirmation.error?.retryable === true, 'stale confirmation must tell the client it can retry');

  const books = await request('/api/v1/books');
  assert(books.length === 2, `expected 2 created books, got ${books.length}`);
  for (const created of [male, female]) {
    const book = await request(`/api/v1/books/${created.bookId}`);
    const agents = await request(`/api/v1/books/${created.bookId}/agents`);
    const workspace = await request(`/api/v1/books/${created.bookId}/workspace`);
    const messages = await request(`/api/v1/books/${created.bookId}/messages`);
    assert(book.status === 'active' && book.canonRevision === 0, `book ${created.bookId} state invalid`);
    assert(agents.length === 11, `book ${created.bookId} agent count invalid`);
    assert(workspace.messageCount === 0, `book ${created.bookId} exposes internal onboarding trigger`);
    assert(messages.length === 0, `book ${created.bookId} has a forged visible message`);
  }

  const database = new DatabaseSync(join(dataDir, 'database', 'wenmi.sqlite'), { readOnly: true });
  try {
    const counts = {
      books: scalar(database, 'SELECT COUNT(*) FROM books'),
      blueprints: scalar(database, 'SELECT COUNT(*) FROM book_opening_blueprints'),
      protagonists: scalar(database, 'SELECT COUNT(*) FROM protagonist_profiles'),
      agents: scalar(database, 'SELECT COUNT(*) FROM agent_instances'),
      kickoffTasks: scalar(database, "SELECT COUNT(*) FROM tasks WHERE task_type = 'conversation_reply' AND status = 'queued'"),
      internalTriggers: scalar(database, "SELECT COUNT(*) FROM messages WHERE message_type = 'onboarding_trigger'"),
      staleTitleBooks: scalar(database, "SELECT COUNT(*) FROM books WHERE title = '错误版本不应建书'"),
      canonRevisionSum: scalar(database, 'SELECT COALESCE(SUM(canon_revision), 0) FROM books'),
      foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all().length
    };
    assert(counts.books === 2, 'book transaction count mismatch');
    assert(counts.blueprints === 2 && counts.protagonists === 2, 'opening snapshots are incomplete');
    assert(counts.agents === 22 && counts.kickoffTasks === 2 && counts.internalTriggers === 2, 'team or kickoff transaction is incomplete');
    assert(counts.staleTitleBooks === 0, 'stale confirmation created a partial book');
    assert(counts.canonRevisionSum === 0, 'book creation polluted canon');
    assert(counts.foreignKeyViolations === 0, 'foreign key violations detected');
    console.log(JSON.stringify({
      smoke: 'passed',
      schemaVersion: 25,
      validBooksCreated: 2,
      rejectedInputs: 4,
      boundaryGroups: taxonomy.boundaryGroups.length,
      boundaryOptions: boundaryCount,
      ...counts
    }));
  } finally {
    database.close();
  }
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => undefined);
  }
  const target = resolve(dataDir);
  const temporaryRoot = resolve(tmpdir());
  if (!target.startsWith(`${temporaryRoot}\\`)) throw new Error('refusing unsafe book-create smoke cleanup');
  rmSync(target, { recursive: true, force: true });
}

async function createAndConfirm(title, openingBlueprint) {
  const draft = await request('/api/v1/books/drafts', {
    method: 'POST',
    body: { title, text: openingBlueprint.fullBookOutline, openingBlueprint }
  });
  return request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST',
    body: { expectedVersion: draft.version }
  });
}

function blueprint({ taxonomyVersion, channel, categoryKey, role, name, mainTags, mustFollow }) {
  return {
    taxonomyVersion,
    channel,
    categoryKey,
    protagonists: [{
      role,
      name,
      age: '二十岁',
      background: '在故事发生地生活多年，因一封异常来信卷入主线。',
      personalities: ['冷静', '坚韧']
    }],
    worldBackground: '城邦、商会与地方议会维持脆弱秩序，公开规则与地下契约并存。',
    openingBackground: '主角收到一封不可能出现的来信，旧日案件因此重新启动。',
    stageOne: {
      start: '主角确认来信指向一项尚未发生的事件。',
      development: '主角联合伙伴调查事件，发现多方势力隐瞒同一事实。',
      end: '主角阻止第一次危机，并确认幕后冲突将持续影响全书主线。'
    },
    fullBookOutline: '主角追查异常来信背后的长期阴谋，最终重建公开规则并承担选择的代价。',
    mainTags,
    auxiliaryTags: [],
    storyTraits: ['群像', '成长'],
    customTags: ['阶段悬念'],
    initialMap: '旧城区、档案馆与北门车站构成开篇活动范围。',
    mustFollow
  };
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method,
    headers: {
      cookie,
      origin: webOrigin,
      'sec-fetch-site': 'same-site',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed ${response.status}: ${payload.error?.message ?? 'unknown error'}`);
  return payload.data;
}

async function expectStatus(path, expectedStatus, { method, body }, label) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method,
    headers: {
      cookie,
      origin: webOrigin,
      'sec-fetch-site': 'same-site',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function scalar(database, sql) {
  const row = database.prepare(sql).get();
  return Number(Object.values(row)[0]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth(url) {
  let response;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // API is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return response ?? { ok: false, status: 0 };
}
