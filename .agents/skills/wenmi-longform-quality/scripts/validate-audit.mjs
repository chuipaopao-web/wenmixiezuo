import { readFile } from 'node:fs/promises';
import process from 'node:process';

const filePath = process.argv[2];

if (!filePath) {
  console.error('用法: node validate-audit.mjs <审计文件.md>');
  process.exit(2);
}

let content;
try {
  content = await readFile(filePath, 'utf8');
} catch (error) {
  console.error(`无法读取审计文件: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const failures = [];
const heading = (title) => new RegExp(`^#{1,6}\\s+(?:\\d+[.、]\\s*)?${title}\\s*$`, 'mu');
const requiredSections = [
  ['明确结论与置信度', heading('明确结论与置信度')],
  ['当前事实基线', heading('当前事实基线')],
  ['能力追踪矩阵', heading('能力追踪矩阵')],
  ['最强替代方案与取舍', heading('最强替代方案与取舍')],
  ['预先验尸与反例', heading('预先验尸与反例')],
  ['修正后的最终设计', heading('修正后的最终设计')],
  ['测试与证据等级', heading('测试与证据等级')],
  ['剩余风险与未知项', heading('剩余风险与未知项')],
  ['停止、回滚和升级条件', heading('停止、回滚和升级条件')]
];

for (const [name, pattern] of requiredSections) {
  if (!pattern.test(content)) failures.push(`缺少章节: ${name}`);
}

const lines = content.split(/\r?\n/u);
const hasMarkdownTable = lines.some((line, index) =>
  /^\s*\|.+\|\s*$/u.test(line) &&
  /^\s*\|(?:\s*:?-{3,}:?\s*\|){2,}\s*$/u.test(lines[index + 1] ?? '')
);
if (!hasMarkdownTable) failures.push('缺少能力追踪表');

if (!/反例/u.test(content)) failures.push('缺少反例');
if (!/测试/u.test(content)) failures.push('缺少测试');
if (!/剩余风险/u.test(content)) failures.push('缺少剩余风险');

for (const level of ['E0', 'E1', 'E2', 'E3', 'E4']) {
  if (!content.includes(level)) failures.push(`缺少证据等级: ${level}`);
}

const placeholders = [
  ['TODO', /\bTODO\b/u],
  ['TBD', /\bTBD\b/u],
  ['placeholder', /\bplaceholder\b/iu],
  ['以后再做', /以后再做/u]
];

for (const [name, pattern] of placeholders) {
  if (pattern.test(content)) failures.push(`存在占位内容: ${name}`);
}

const overclaims = [
  /(?<!不|不能|无法)保证写好(?:所有)?长篇/u,
  /已经彻底解决长篇(?:小说)?(?:创作)?(?:质量)?问题/u,
  /百分之百解决长篇/u
];

if (overclaims.some((pattern) => pattern.test(content))) {
  failures.push('存在越界声明');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${filePath}`);
