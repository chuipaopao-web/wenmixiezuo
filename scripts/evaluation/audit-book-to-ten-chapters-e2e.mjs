import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RUN_KEY = (process.env.WENMI_E2E_RUN_KEY ?? 'v1')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'v1';
const ROOT = resolve(
  RUN_KEY === 'v1'
    ? 'data/verification/book-to-ten-chapters-e2e'
    : `data/verification/book-to-ten-chapters-e2e-${RUN_KEY}`,
);
const FINAL_FILE = join(ROOT, 'final-evidence.json');
const AUDIT_FILE = join(ROOT, 'full-content-audit.json');
const FULL_TEXT_FILE = join(ROOT, 'chapters-full.md');

mkdirSync(ROOT, { recursive: true });
const evidence = JSON.parse(readFileSync(FINAL_FILE, 'utf8'));
const bookId = evidence.book.bookId;
let cookie = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/gu, '').trim();
}

function sameTextSet(left, right) {
  const normalized = (items) => [...new Set((items ?? []).map(normalizedText))].sort();
  const a = normalized(left);
  const b = normalized(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function assertStageFinalOutline(masterStage, outline) {
  assert(outline?.chapterNumber === masterStage.chapterRange.end,
    'stage-final outline is missing or has the wrong chapter number');
  assert(outline.sourceStage?.stageNumber === masterStage.stageNumber
    && normalizedText(outline.sourceStage?.title) === normalizedText(masterStage.title)
    && outline.sourceStage?.chapterRange?.start === masterStage.chapterRange.start
    && outline.sourceStage?.chapterRange?.end === masterStage.chapterRange.end,
  'stage-final outline does not cite the selected master stage exactly');
  assert(outline.stageBoundary?.mustCloseStage === true,
    'stage-final outline does not require stage closure');
  assert(normalizedText(outline.stageBoundary?.resolution) === normalizedText(masterStage.mainline.resolution)
    && normalizedText(outline.stageBoundary?.result) === normalizedText(masterStage.mainline.result),
  'stage-final outline changed the selected stage resolution or result');
  assert(sameTextSet(outline.stageBoundary?.pendingThreads, masterStage.pendingThreads),
    'stage-final outline changed the selected pending-thread set');
}

function formalCharacterCount(value) {
  return [...value.normalize('NFKC')].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function paragraphs(value) {
  return value
    .split(/\r?\n\s*\r?\n/u)
    .map((item) => item.replace(/\s+/gu, ' ').trim())
    .filter((item) => item.length >= 24);
}

function internalLeakMatches(value) {
  const patterns = [
    /confirmed_decisions/giu,
    /sourceId\s*[:=]/giu,
    /manuscriptVersionId/giu,
    /canonRevision/giu,
    /reviewerRole/giu,
    /contextPack/giu,
    /```json/giu,
    /\\"(?:title|goal|beats|hook)\\"/giu,
    /\{\s*"(?:title|goal|beats|hook)"\s*:/giu
  ];
  return patterns.flatMap((pattern) => [...value.matchAll(pattern)].map((match) => match[0]));
}

async function issueSession() {
  const response = await fetch(`${API}/api/v1/runtime/session`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
    body: '{}'
  });
  assert(response.ok, `runtime session failed: ${response.status} ${await response.text()}`);
  cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert(cookie.length > 0, 'runtime session did not return cookie');
}

async function request(path, { method = 'GET', body } = {}) {
  if (cookie.length === 0) await issueSession();
  const headers = { cookie };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['sec-fetch-site'] = 'same-site';
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok || payload.error !== undefined) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.data;
}

const publicViews = {};
const viewRequests = {
  book: `/api/v1/books/${bookId}`,
  profile: `/api/v1/books/${bookId}/book-profile`,
  workspace: `/api/v1/books/${bookId}/workspace`,
  planning: `/api/v1/books/${bookId}/planning-state`,
  settingOutline: `/api/v1/books/${bookId}/setting-outline-workspace`,
  artifacts: `/api/v1/books/${bookId}/artifacts`,
  chapters: `/api/v1/books/${bookId}/chapters`,
  messages: `/api/v1/books/${bookId}/messages?limit=500`,
  library: `/api/v1/books/${bookId}/library`,
  projections: `/api/v1/books/${bookId}/projections`,
  protagonists: `/api/v1/books/${bookId}/protagonists`
};

for (const [name, path] of Object.entries(viewRequests)) {
  publicViews[name] = await request(path);
}

const selectedMaster = publicViews.artifacts.find((item) => item.artifact_type === 'master_outline'
  && item.active_version_status === 'selected')?.active_content;
assert(selectedMaster?.outlineSchema === 'stage_master_v2', 'public artifacts do not expose the selected stage master');
assert(selectedMaster.majorStages?.length === 1, 'public selected stage master must contain exactly one stage');
const selectedStage = selectedMaster.majorStages[0];
const selectedStageFinalOutline = publicViews.artifacts.find((item) => item.artifact_type === 'chapter_outline'
  && item.active_version_status === 'selected'
  && Number(item.active_content?.chapterNumber) === selectedStage.chapterRange.end)?.active_content;
assertStageFinalOutline(selectedStage, selectedStageFinalOutline);

// This is the exact entry call used by the chat page. All settings in this
// completed test book are confirmed, so the endpoint must be idempotent and
// must not create a new creative discussion.
const conversationEntry = await request(`/api/v1/books/${bookId}/conversation-entry`, {
  method: 'POST',
  body: {}
});

const chapterCatalog = [...publicViews.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber);
const chapterAudits = [];
const globalParagraphOwners = new Map();
const crossChapterDuplicates = [];
const markdown = [`# 《${publicViews.book.title}》十章全文验收`, '', `书籍 ID：${bookId}`, ''];

for (const chapter of chapterCatalog.filter((item) => item.chapterNumber <= 10)) {
  const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
  const chapterParagraphs = paragraphs(content.content);
  const localDuplicates = [];
  const seen = new Map();
  for (const paragraph of chapterParagraphs) {
    const key = paragraph.normalize('NFKC');
    if (seen.has(key)) localDuplicates.push(key.slice(0, 160));
    else seen.set(key, true);
    const priorChapter = globalParagraphOwners.get(key);
    if (priorChapter !== undefined && priorChapter !== chapter.chapterNumber) {
      crossChapterDuplicates.push({ priorChapter, chapterNumber: chapter.chapterNumber, preview: key.slice(0, 160) });
    } else {
      globalParagraphOwners.set(key, chapter.chapterNumber);
    }
  }
  const audit = {
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    chapterId: chapter.chapterId,
    settlementStatus: chapter.settlementStatus,
    manuscriptVersionId: content.manuscriptVersionId,
    contentHash: content.contentHash,
    rawCharacterCount: content.totalLength,
    formalCharacterCount: formalCharacterCount(content.content),
    paragraphCount: chapterParagraphs.length,
    localDuplicateParagraphs: localDuplicates,
    internalLeakMatches: internalLeakMatches(content.content),
    opening: content.content.slice(0, 500),
    ending: content.content.slice(-700)
  };
  chapterAudits.push(audit);
  markdown.push(`## 第 ${chapter.chapterNumber} 章 ${chapter.title}`, '', content.content.trim(), '');
}

assert(chapterAudits.length === 10, `public chapter catalog returned ${chapterAudits.length} chapters instead of 10`);
assert(chapterAudits.every((chapter) => chapter.settlementStatus === 'settled'), 'one or more public chapters are not settled');
assert(chapterAudits.every((chapter) => chapter.formalCharacterCount >= 2350 && chapter.formalCharacterCount <= 3650),
  'one or more public chapters violate the formal production length contract');
assert(chapterAudits.every((chapter) => chapter.localDuplicateParagraphs.length === 0), 'duplicate paragraph found inside a chapter');
assert(crossChapterDuplicates.length === 0, 'identical long paragraph found across chapters');
assert(chapterAudits.every((chapter) => chapter.internalLeakMatches.length === 0), 'internal structured fields leaked into formal prose');

const audit = {
  testId: evidence.testId,
  auditedAt: new Date().toISOString(),
  book: { bookId, title: publicViews.book.title, canonRevision: publicViews.book.canonRevision },
  conversationEntry,
  publicViewSummary: {
    profileKeys: Object.keys(publicViews.profile ?? {}),
    workspaceKeys: Object.keys(publicViews.workspace ?? {}),
    planning: publicViews.planning,
    settingCount: Array.isArray(publicViews.settingOutline) ? publicViews.settingOutline.length : null,
    artifactCount: Array.isArray(publicViews.artifacts) ? publicViews.artifacts.length : null,
    chapterCount: chapterCatalog.length,
    messageCount: Array.isArray(publicViews.messages) ? publicViews.messages.length : null,
    libraryKeys: Object.keys(publicViews.library ?? {}),
    libraryCounts: Object.fromEntries(Object.entries(publicViews.library ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : null])),
    projectionCount: Array.isArray(publicViews.projections) ? publicViews.projections.length : null,
    protagonistKeys: Object.keys(publicViews.protagonists ?? {})
  },
  chapterAudits,
  crossChapterDuplicates,
  publicViews
};

writeFileSync(AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
writeFileSync(FULL_TEXT_FILE, `${markdown.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({
  auditFile: AUDIT_FILE,
  fullTextFile: FULL_TEXT_FILE,
  book: audit.book,
  conversationEntry,
  publicViewSummary: audit.publicViewSummary,
  chapters: chapterAudits.map(({ chapterNumber, title, formalCharacterCount, rawCharacterCount, paragraphCount }) => ({
    chapterNumber, title, formalCharacterCount, rawCharacterCount, paragraphCount
  }))
}, null, 2));
