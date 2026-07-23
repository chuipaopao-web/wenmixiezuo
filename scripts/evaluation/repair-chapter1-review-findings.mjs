const API = process.env.WENMI_VALIDATION_API ?? 'http://127.0.0.1:43111';
const ORIGIN = process.env.WENMI_VALIDATION_ORIGIN ?? 'http://127.0.0.1:43110';
const BOOK_ID = 'da2a9158-28ab-4c4a-ab2a-e3c4aae0fd77';
const CHAPTER_ID = 'bdef742e-729b-4a0b-9215-b961f8c9abd6';

let cookie = '';

async function request(path, options = {}) {
  if (cookie.length === 0) {
    const session = await fetch(`${API}/api/v1/runtime/session`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json'
      },
      body: '{}'
    });
    if (!session.ok) throw new Error(await session.text());
    cookie = session.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  }
  const method = options.method ?? 'GET';
  const headers = { cookie };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['sec-fetch-site'] = 'same-site';
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${API}${path}`, { ...options, method, headers });
  const body = JSON.parse(await response.text());
  if (!response.ok || body.error !== undefined) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.data;
}

// P0-1 / R07: 默认 dry-run，不连真实 API、不触发审校链。需显式 --apply 才执行。
const APPLY = new Set(process.argv.slice(2)).has('--apply');

const patches = [
  [
    '他悬在半空，看见锁链根部的水泥正在碎裂。\n\n不动，不拉，不回头。活命的规矩从来简单。',
    '他悬在半空，看见锁链根部的水泥正在碎裂。他顺着晃动荡回断梁，靴底落下时，膝盖被震得一软。\n\n不动，不拉，不回头。活命的规矩从来简单。'
  ],
  [
    '林砚望了一眼近在咫尺的天光，又看了一眼正在松脱的锁链根部，松手，转身向下。',
    '林砚望了一眼近在咫尺的天光，又看了一眼正在松脱的锁链根部，转身沿断梁向下。'
  ],
  [
    '林砚探身抓住钥匙，腰间最后一点火种却被气流吹灭。',
    '林砚探身抓住钥匙，腰间最后一点火苗被气流压到只剩暗红一点。'
  ],
  [
    '他将左肩凑近门面，让针尖扎进伤处翻裂的皮肉。血沿着铜座纹路渗入凹槽，四道浅纹依次亮起暗红微光。',
    '他将左肩凑近门面，让针尖扎进伤处翻裂的皮肉。铜座表面的细密沟槽把血从边缘引向中央，血线随即渗入凹槽，四道浅纹依次亮起暗红微光。'
  ]
];

if (!APPLY) {
  console.log(JSON.stringify({
    event: 'dry_run',
    reason: '默认 dry-run；需 --apply 才连真实 API 执行补丁并触发审校链',
    chapterId: CHAPTER_ID,
    patchCount: patches.length,
    previews: patches.map(([before, after]) => ({ before: before.slice(0, 40), after: after.slice(0, 40) }))
  }));
  process.exit(0);
}

const contentPath = `/api/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}/content`;
const current = await request(contentPath);
let content = current.content;

for (const [before, after] of patches) {
  const occurrences = content.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`patch precondition failed: expected 1 occurrence, got ${occurrences}: ${before.slice(0, 40)}`);
  }
  content = content.replace(before, after);
}

const saved = await request(`/api/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}/manuscripts/owner-drafts`, {
  method: 'POST',
  body: JSON.stringify({
    baseManuscriptVersionId: current.manuscriptVersionId,
    content,
    note: '根据最终三席审校修复火种时间线、断梁空间连续性与铜座导血机制，不改变剧情事实。'
  })
});
console.log(JSON.stringify({ event: 'owner_draft_saved', ...saved }));

const finalized = await request(`/api/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}/finalize`, {
  method: 'POST',
  body: JSON.stringify({ manuscriptVersionId: saved.manuscriptVersionId })
});
console.log(JSON.stringify({ event: 'owner_draft_finalized', ...finalized }));
