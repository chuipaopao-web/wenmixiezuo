import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const markdownOutput = join(rootDir, 'docs', 'PROJECT_DOCUMENT_INDEX.md');
const htmlOutput = join(rootDir, 'docs', 'PROJECT_DOCUMENT_CENTER.html');
const bundleOutput = join(rootDir, 'docs', 'PROJECT_REFERENCE_BUNDLE.md');
const checkOnly = process.argv.includes('--check');

const currentPaths = [
  'HANDOFF.md', 'PROJECT_HANDBOOK.md', 'AGENTS.md', 'README.md', 'KNOWLEDGE.md', 'TASKS.md',
  'docs/PROJECT_CHARTER.md', 'docs/DECISIONS.md', 'docs/PRODUCT.md', 'docs/UI_UX_REDESIGN_DIRECTION.md',
  'docs/CREATION_WORKFLOW_V2_DESIGN.md', 'docs/FEATURE_IMPLEMENTATION_GUIDE.md', 'docs/ARCHITECTURE.md', 'docs/DATA_MODEL.md',
  'docs/LAYERED_CREATION_IMPLEMENTATION_AND_ACCEPTANCE.md',
  'docs/AGENT_SYSTEM.md', 'docs/MEMORY.md', 'docs/LONGFORM_QUALITY.md',
  'docs/HYBRID_RAG_DESIGN.md', 'docs/CHUNKING_DESIGN.md', 'docs/API.md',
  'docs/DEVELOPMENT_ROADMAP.md', 'docs/ACCEPTANCE.md', 'docs/ULTRA_LONGFORM_CONTINUITY.md',
  'docs/SECURITY_AND_OPERATIONS.md', 'docs/RUNTIME_WORKFLOWS.md', 'docs/USER_GUIDE.md',
  'docs/COVERAGE_MATRIX.md', 'docs/ROLE_PROMPTS.md', 'docs/EVALUATION_PROTOCOL.md',
  'docs/DESIGN_GOVERNANCE_AUDIT.md', 'docs/DEPLOY.md'
];
const generatedPaths = new Set(['docs/PROJECT_DOCUMENT_INDEX.md', 'docs/PROJECT_DOCUMENT_CENTER.html', 'docs/PROJECT_REFERENCE_BUNDLE.md']);

function normalizePath(value) {
  return value.split(sep).join('/');
}

function collectSkillDocuments(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSkillDocuments(fullPath));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(fullPath);
  }
  return files;
}

function cleanInlineMarkdown(value) {
  return value.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/[*_`>#|]/g, '').replace(/\s+/g, ' ').trim();
}

function extractMetadata(content, fallbackName) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const heading = lines.find((line) => /^#\s+\S/.test(line));
  const title = cleanInlineMarkdown(heading?.replace(/^#\s+/, '') || fallbackName);
  const summary = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|') && !line.startsWith('-') && line !== '---')
    .map(cleanInlineMarkdown)
    .find((line) => line.length >= 8) ?? '当前项目规则与使用说明。';
  return { title, summary: summary.slice(0, 180) };
}

function category(path) {
  if (path.startsWith('.agents/skills/')) return '项目 Skills';
  if (['AGENTS.md', 'KNOWLEDGE.md', 'TASKS.md'].includes(path)) return 'Codex 工作规则';
  return '当前正式文档';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function htmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

const skillDirectories = ['wenmi-longform-quality', 'wenmi-ui-ux'];
const discovered = [
  ...currentPaths.map((path) => join(rootDir, path)).filter(existsSync),
  ...skillDirectories.flatMap((name) => collectSkillDocuments(join(rootDir, '.agents', 'skills', name)))
];
const documents = [...new Set(discovered.map((path) => resolve(path)))]
  .filter((fullPath) => !generatedPaths.has(normalizePath(relative(rootDir, fullPath))))
  .sort((a, b) => normalizePath(relative(rootDir, a)).localeCompare(normalizePath(relative(rootDir, b)), 'zh-CN'))
  .map((fullPath, index) => {
    const path = normalizePath(relative(rootDir, fullPath));
    const content = readFileSync(fullPath, 'utf8').replace(/\r\n?/g, '\n');
    const fileStat = statSync(fullPath);
    return {
      ...extractMetadata(content, path.split('/').at(-1)),
      id: `document-${index + 1}`,
      path,
      category: category(path),
      content,
      bytes: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
      hash: createHash('sha256').update(content).digest('hex').slice(0, 12)
    };
  });
const documentIds = new Map(documents.map((document) => [document.path, document.id]));
const documentByPath = new Map(documents.map((document) => [document.path, document]));
const bundleGroups = [
  { title: '一、产品定位与完整工作流', paths: [
    'README.md', 'docs/PROJECT_CHARTER.md', 'docs/PRODUCT.md', 'docs/UI_UX_REDESIGN_DIRECTION.md',
    'docs/CREATION_WORKFLOW_V2_DESIGN.md', 'docs/FEATURE_IMPLEMENTATION_GUIDE.md', 'docs/USER_GUIDE.md',
    'docs/LAYERED_CREATION_IMPLEMENTATION_AND_ACCEPTANCE.md',
  ] },
  { title: '二、AI成员、上下文、检索与创作质量', paths: [
    'docs/AGENT_SYSTEM.md', 'docs/ROLE_PROMPTS.md', 'docs/MEMORY.md',
    'docs/HYBRID_RAG_DESIGN.md', 'docs/CHUNKING_DESIGN.md', 'docs/LONGFORM_QUALITY.md',
    'docs/ULTRA_LONGFORM_CONTINUITY.md', 'docs/EVALUATION_PROTOCOL.md'
  ] },
  { title: '三、系统架构、数据、接口与运行', paths: [
    'docs/ARCHITECTURE.md', 'docs/DATA_MODEL.md', 'docs/API.md',
    'docs/RUNTIME_WORKFLOWS.md', 'docs/SECURITY_AND_OPERATIONS.md', 'docs/DEPLOY.md'
  ] },
  { title: '四、当前决定、开发计划与验收', paths: [
    'docs/DECISIONS.md', 'docs/DEVELOPMENT_ROADMAP.md', 'docs/ACCEPTANCE.md',
    'docs/COVERAGE_MATRIX.md', 'docs/DESIGN_GOVERNANCE_AUDIT.md'
  ] },
  { title: '五、Codex开发协作与当前状态', paths: [
    'HANDOFF.md', 'PROJECT_HANDBOOK.md', 'AGENTS.md', 'KNOWLEDGE.md', 'TASKS.md'
  ] },
  { title: '六、项目 Skills', paths: documents
    .filter((document) => document.path.startsWith('.agents/skills/'))
    .map((document) => document.path) }
];
const assignedBundlePaths = bundleGroups.flatMap((group) => group.paths);
const missingBundlePaths = documents.map((document) => document.path).filter((path) => !assignedBundlePaths.includes(path));
const duplicateBundlePaths = assignedBundlePaths.filter((path, index) => assignedBundlePaths.indexOf(path) !== index);
if (missingBundlePaths.length > 0 || duplicateBundlePaths.length > 0
  || assignedBundlePaths.some((path) => !documentByPath.has(path))) {
  throw new Error('项目合订版目录不完整：missing=' + missingBundlePaths.join(',') + ' duplicate=' + duplicateBundlePaths.join(','));
}
function demoteHeadings(content) {
  return content.replace(/^\uFEFF/, '').replace(/^(#{1,6})\s+/gm, (_, hashes) => '#'.repeat(Math.min(6, hashes.length + 3)) + ' ').trim();
}
const markdownTick = String.fromCharCode(96);
const bundleToc = bundleGroups.map((group) => '- ' + group.title + '（' + group.paths.length + '份）').join('\n');
const bundleBody = bundleGroups.map((group) => {
  const sections = group.paths.map((path) => {
    const document = documentByPath.get(path);
    return '### ' + document.title + '\n\n> 当前源文件：' + markdownTick + document.path + markdownTick
      + ' · 指纹：' + markdownTick + document.hash + markdownTick + '\n\n' + demoteHeadings(document.content);
  }).join('\n\n---\n\n');
  return '## ' + group.title + '\n\n' + sections;
}).join('\n\n---\n\n');
const referenceBundle = '# 文秘写作当前项目完整合订版\n\n'
  + '本文件由当前文档白名单自动合并，只包含现版本生效的产品、流程、架构、数据、AI成员、上下文、检索、质量、开发与验收规则。'
  + '仅在专项外部评审需要完整上下文时使用；日常开发读取短入口和相关小节。\n\n'
  + '共 **' + documents.length + '** 份源文档，按以下六个目录合并：\n\n' + bundleToc
  + '\n\n> 权威说明：老板最新明确决定优先；本合订版由源文档自动生成，不单独手工维护。\n\n'
  + bundleBody + '\n';

function tokenStore() {
  const values = [];
  return {
    add(value) {
      const token = `@@WENMI_INLINE_${values.length}@@`;
      values.push(value);
      return token;
    },
    restore(value) {
      return values.reduce((result, item, index) => result.replaceAll(`@@WENMI_INLINE_${index}@@`, item), value);
    }
  };
}

function documentTarget(currentPath, target) {
  const clean = decodeURI(target.split('#')[0].split('?')[0]);
  if (!clean || /^[a-z]+:/i.test(clean)) return null;
  return posix.normalize(posix.join(posix.dirname(currentPath), clean));
}

function inlineMarkdown(value, currentPath) {
  const tokens = tokenStore();
  let source = value.replace(/`([^`]+)`/g, (_, code) => tokens.add(`<code>${htmlEscape(code)}</code>`));
  source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, target) => {
    const resolved = documentTarget(currentPath, target);
    const linkedId = resolved === null ? null : documentIds.get(resolved);
    if (linkedId !== undefined && linkedId !== null) {
      return tokens.add(`<button type="button" class="inline-doc-link" data-open-document="${linkedId}">${htmlEscape(label)}</button>`);
    }
    if (/^https?:\/\//i.test(target)) {
      return tokens.add(`<a href="${htmlEscape(target)}" target="_blank" rel="noreferrer">${htmlEscape(label)}</a>`);
    }
    return tokens.add(`<span class="document-reference">${htmlEscape(label)} · ${htmlEscape(target)}</span>`);
  });
  let escaped = htmlEscape(source);
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return tokens.restore(escaped);
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function markdownToHtml(markdown, currentPath) {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      blocks.push(`<details class="frontmatter"><summary>文档元数据</summary><pre>${htmlEscape(lines.slice(1, end).join('\n'))}</pre></details>`);
      index = end + 1;
    }
  }
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) { code.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      blocks.push(`<pre class="code-block"><code data-language="${htmlEscape(language)}">${htmlEscape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2], currentPath)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) { blocks.push('<hr>'); index += 1; continue; }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(`<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell, currentPath)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] ?? '', currentPath)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item, currentPath)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item, currentPath)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quotes = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) { quotes.push(lines[index].replace(/^>\s?/, '')); index += 1; }
      blocks.push(`<blockquote>${quotes.map((item) => inlineMarkdown(item, currentPath)).join('<br>')}</blockquote>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,6})\s+/.test(lines[index])
      && !/^```/.test(lines[index].trim())
      && !/^\s*[-*+]\s+/.test(lines[index])
      && !/^\s*\d+[.)]\s+/.test(lines[index])
      && !/^>\s?/.test(lines[index])
      && !/^\s*---+\s*$/.test(lines[index])) {
      if (paragraph.length > 0 && lines[index].includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length > 0) blocks.push(`<p>${inlineMarkdown(paragraph.join(' '), currentPath)}</p>`);
  }
  return blocks.join('');
}

const groups = ['当前正式文档', 'Codex 工作规则', '项目 Skills'];
const markdownSections = groups.map((name) => {
  const items = documents.filter((item) => item.category === name);
  if (items.length === 0) return '';
  const rows = items.map((item) => `- **${item.title}** — ${item.summary} — \`${item.path}\` · ${formatBytes(item.bytes)} · \`${item.hash}\``).join('\n');
  return `## ${name}\n\n共 ${items.length} 份。桌面阅读中心可点击卡片直接阅读全文。\n\n${rows}`;
}).filter(Boolean).join('\n\n');

const markdown = `# 文秘写作当前文档目录\n\n本目录只收录当前版本实际生效的产品、工作流、架构、质量和 Codex 规则，共 **${documents.length}** 份。文档卡片与全文均由源文件实时生成。\n\n打开桌面的“文秘写作项目文档”，点击任意卡片即可在同一页面阅读全文。源文件路径和内容指纹用于核对版本。\n\n${markdownSections}\n`;

const buttons = groups.map((name) => {
  const count = documents.filter((item) => item.category === name).length;
  return count === 0 ? '' : `<button type="button" data-category="${htmlEscape(name)}">${htmlEscape(name)} <span>${count}</span></button>`;
}).join('');
const cards = documents.map((item) => {
  const search = `${item.title} ${item.summary} ${item.path} ${item.category}`.toLowerCase();
  return `<button type="button" class="card" data-category="${htmlEscape(item.category)}" data-search="${htmlEscape(search)}" data-open-document="${item.id}"><div class="card-top"><span class="tag">${htmlEscape(item.category)}</span><span class="meta">${formatBytes(item.bytes)} · ${item.hash}</span></div><h2>${htmlEscape(item.title)}</h2><p>${htmlEscape(item.summary)}</p><div class="card-footer"><span class="path">${htmlEscape(item.path)}</span><span class="read">阅读全文 →</span></div></button>`;
}).join('');
const templates = '<template id="project-reference-bundle" data-title="文秘写作当前项目完整合订版" data-path="docs/PROJECT_REFERENCE_BUNDLE.md" data-meta="六个目录 · '
  + documents.length + '份当前资料 · 可整页复制">' + markdownToHtml(referenceBundle, 'docs/PROJECT_REFERENCE_BUNDLE.md') + '</template>'
  + documents.map((item) => '<template id="' + item.id + '" data-title="' + htmlEscape(item.title)
    + '" data-path="' + htmlEscape(item.path) + '" data-meta="' + htmlEscape(item.category + ' · ' + formatBytes(item.bytes) + ' · ' + item.hash)
    + '">' + markdownToHtml(item.content, item.path) + '</template>').join('');
const latestSourceTime = Math.max(...documents.map((document) => document.modifiedAt));
const generatedAt = new Date(latestSourceTime).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate"><title>文秘写作当前文档中心</title><style>:root{--ink:#17211b;--muted:#667269;--paper:#f4f5f0;--panel:#fff;--line:#d9ded8;--accent:#1f6b4f;--accent2:#134b37;--soft:#e3f0e9;--shadow:0 24px 70px rgba(18,42,31,.18)}*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:var(--ink);background:var(--paper)}header{padding:42px clamp(20px,5vw,72px) 28px;background:#fff;border-bottom:1px solid var(--line)}h1{font-size:clamp(30px,5vw,50px);margin:0 0 12px}.intro{max-width:920px;color:var(--muted);line-height:1.8}.version{margin-top:10px;color:var(--accent);font-size:13px}main{padding:24px clamp(18px,5vw,72px) 56px}.bundle-banner{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 22px;padding:24px 28px;border:1px solid #9fc5b2;border-radius:20px;background:linear-gradient(135deg,#e8f4ed,#fff)}.bundle-banner h2{margin:0 0 8px;font-size:24px}.bundle-banner p{margin:0;color:var(--muted);line-height:1.7}.bundle-button,.copy-reader{border:0;border-radius:12px;background:var(--accent);color:#fff;font:inherit;font-weight:800;padding:13px 18px;cursor:pointer;white-space:nowrap}.copy-reader{position:absolute;right:76px;top:20px;background:#fff;color:var(--accent);border:1px solid #8eb7a4;padding:10px 14px}.reader-head h2{margin-right:190px!important}.toolbar{position:sticky;top:0;padding:12px 0 16px;background:var(--paper);z-index:2}input{width:100%;max-width:760px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;font-size:16px;background:#fff}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.filters button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 12px;cursor:pointer}.filters button.active{color:#fff;background:var(--accent)}button span{opacity:.78}.status{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.card{padding:20px;min-height:225px;background:var(--panel);border:1px solid var(--line);border-radius:18px;text-align:left;color:inherit;font:inherit;cursor:pointer;display:flex;flex-direction:column;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}.card:hover,.card:focus-visible{transform:translateY(-2px);border-color:#8eb7a4;box-shadow:0 12px 30px rgba(31,107,79,.12);outline:none}.card-top,.card-footer{display:flex;justify-content:space-between;align-items:center;gap:12px}.tag{color:var(--accent);background:var(--soft);border-radius:999px;padding:5px 9px;font-size:12px}.meta,.path{color:var(--muted);font:12px/1.5 Consolas,monospace}.card h2{font-size:20px;margin:20px 0 10px}.card p{color:var(--muted);line-height:1.65;margin:0 0 18px}.card-footer{margin-top:auto}.read{color:var(--accent);font-weight:700;white-space:nowrap}.hidden{display:none}dialog{width:min(1120px,calc(100vw - 28px));height:min(92vh,980px);border:0;border-radius:22px;padding:0;background:#fff;box-shadow:var(--shadow)}dialog::backdrop{background:rgba(12,22,17,.58);backdrop-filter:blur(3px)}.reader-shell{height:100%;display:grid;grid-template-rows:auto 1fr}.reader-head{position:relative;padding:24px clamp(22px,5vw,58px) 20px;border-bottom:1px solid var(--line);background:#fbfcfa}.reader-head h2{font-size:clamp(24px,4vw,38px);margin:0 56px 8px 0}.reader-meta{color:var(--muted);font:13px/1.5 Consolas,monospace}.close{position:absolute;right:20px;top:20px;width:42px;height:42px;border:1px solid var(--line);background:#fff;border-radius:50%;font-size:25px;cursor:pointer}.document{overflow:auto;padding:30px clamp(22px,6vw,72px) 70px;line-height:1.82;font-size:17px}.document>*{max-width:900px;margin-left:auto;margin-right:auto}.document h1{font-size:38px;margin-top:0}.document h2{font-size:29px;margin-top:2.1em;padding-top:.2em;border-bottom:1px solid var(--line);padding-bottom:.35em}.document h3{font-size:23px;margin-top:1.7em}.document h4{font-size:19px;margin-top:1.4em}.document p{margin:1em auto}.document ul,.document ol{padding-left:1.5em}.document li{margin:.48em 0}.document code{font-family:Consolas,monospace;background:#edf1ed;border-radius:6px;padding:.12em .35em;font-size:.9em}.code-block{overflow:auto;background:#17211b;color:#e8f2eb;padding:18px;border-radius:13px;line-height:1.6}.code-block code{background:transparent;color:inherit;padding:0}.table-scroll{overflow:auto;max-width:100%;margin-top:1.2em;margin-bottom:1.2em}.document table{border-collapse:collapse;width:100%;min-width:620px}.document th,.document td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}.document th{background:#edf4ef}.document blockquote{border-left:4px solid var(--accent);background:#f2f7f4;padding:12px 18px;color:#425348}.frontmatter{max-width:900px;background:#f5f6f3;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.inline-doc-link{border:0;background:none;color:var(--accent);font:inherit;font-weight:700;padding:0;cursor:pointer;text-decoration:underline}.document-reference{color:var(--accent2)}@media(max-width:700px){header{padding-top:26px}.grid{grid-template-columns:1fr}.document{font-size:16px}.card{min-height:190px}}</style></head><body><header><h1>文秘写作当前文档中心</h1><div class="intro">这里只展示当前版本正在生效的产品流程、架构、上下文、AI协作、质量与开发约束。点击任意卡片即可在本页阅读全文，不再依赖浏览器直接打开 Markdown 文件。</div><div class="version">本次生成：${htmlEscape(generatedAt)} · 共 ${documents.length} 份当前资料</div></header><main><section class="bundle-banner" aria-label="项目合订版"><div><h2>一页看完当前项目</h2><p>全部当前文档已按六个目录自动合并，可在同一页阅读并复制全文给 DeepSeek。</p></div><button type="button" class="bundle-button" data-open-document="project-reference-bundle">打开项目合订版 · 复制全文</button></section><section class="toolbar"><input id="search" type="search" placeholder="搜索功能、流程、AI成员、上下文或约束"><div class="filters"><button type="button" class="active" data-category="全部">全部 <span>${documents.length}</span></button>${buttons}</div><div class="status" id="status">显示 ${documents.length} 份文档</div></section><section class="grid">${cards}</section></main><dialog id="reader"><div class="reader-shell"><header class="reader-head"><button type="button" class="copy-reader" id="copy-reader">复制全文</button><button type="button" class="close" id="close-reader" aria-label="关闭">×</button><h2 id="reader-title"></h2><div class="reader-meta" id="reader-meta"></div></header><article class="document" id="reader-content"></article></div></dialog>${templates}<script>const input=document.querySelector('#search'),filterButtons=[...document.querySelectorAll('.filters button')],cards=[...document.querySelectorAll('.card')],status=document.querySelector('#status'),reader=document.querySelector('#reader'),readerTitle=document.querySelector('#reader-title'),readerMeta=document.querySelector('#reader-meta'),readerContent=document.querySelector('#reader-content');const copyReader=document.querySelector('#copy-reader');let category='全部';function filter(){const q=input.value.trim().toLowerCase();let n=0;for(const card of cards){const show=(category==='全部'||card.dataset.category===category)&&(!q||card.dataset.search.includes(q));card.classList.toggle('hidden',!show);if(show)n++}status.textContent='显示 '+n+' / ${documents.length} 份文档'}function openDocument(id,updateHash=true){const template=document.getElementById(id);if(!template)return;readerTitle.textContent=template.dataset.title;readerMeta.textContent=template.dataset.meta+' · '+template.dataset.path;readerContent.replaceChildren(template.content.cloneNode(true));readerContent.scrollTop=0;if(!reader.open)reader.showModal();if(updateHash){try{history.replaceState(null,'',location.href.split('#')[0]+'#doc='+encodeURIComponent(template.dataset.path))}catch{}}}async function copyCurrent(){const value=readerContent.innerText.trim();if(!value)return;try{if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(value);else throw new Error('clipboard unavailable');copyReader.textContent='已复制全文';}catch{const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();copyReader.textContent='已复制全文';}setTimeout(()=>{copyReader.textContent='复制全文'},1800)}function closeReader(){if(reader.open)reader.close();try{history.replaceState(null,'',location.href.split('#')[0])}catch{}}input.addEventListener('input',filter);for(const button of filterButtons)button.addEventListener('click',()=>{category=button.dataset.category;for(const item of filterButtons)item.classList.toggle('active',item===button);filter()});document.addEventListener('click',(event)=>{const target=event.target.closest('[data-open-document]');if(target)openDocument(target.dataset.openDocument)});copyReader.addEventListener('click',copyCurrent);document.querySelector('#close-reader').addEventListener('click',closeReader);reader.addEventListener('click',(event)=>{if(event.target===reader)closeReader()});reader.addEventListener('cancel',(event)=>{event.preventDefault();closeReader()});const requested=new URLSearchParams(location.hash.slice(1)).get('doc');if(requested){const template=[...document.querySelectorAll('template[data-path]')].find((item)=>item.dataset.path===requested);if(template)openDocument(template.id,false)}</script></body></html>`;

function ensureCurrent(path, expected) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === expected) return true;
  if (!checkOnly) writeFileSync(path, expected, 'utf8');
  return false;
}

const markdownCurrent = ensureCurrent(markdownOutput, markdown);
const htmlCurrent = ensureCurrent(htmlOutput, html);
const bundleCurrent = ensureCurrent(bundleOutput, referenceBundle);
if (checkOnly && (!markdownCurrent || !htmlCurrent || !bundleCurrent)) {
  console.error('项目文档中心已过期，请运行 npm run docs:sync。');
  process.exitCode = 1;
} else if (checkOnly) console.log(`项目文档中心正常，共 ${documents.length} 份当前资料。`);
else console.log(`项目文档中心已同步，共 ${documents.length} 份当前资料。`);
