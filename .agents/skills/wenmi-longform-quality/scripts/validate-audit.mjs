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
  ['创造性与输出质量保护', heading('创造性与输出质量保护')],
  ['测试与证据等级', heading('测试与证据等级')],
  ['剩余风险与未知项', heading('剩余风险与未知项')],
  ['停止、回滚和升级条件', heading('停止、回滚和升级条件')]
];

for (const [name, pattern] of requiredSections) {
  if (!pattern.test(content)) failures.push(`缺少章节: ${name}`);
}

const lines = content.split(/\r?\n/u);
const sectionBody = (title) => {
  const pattern = heading(title);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start === -1) return '';
  const next = lines.findIndex((line, index) => index > start && /^#{1,6}\s+/u.test(line));
  return lines.slice(start + 1, next === -1 ? lines.length : next).join('\n');
};
const hasMarkdownTable = lines.some((line, index) =>
  /^\s*\|.+\|\s*$/u.test(line) &&
  /^\s*\|(?:\s*:?-{3,}:?\s*\|){2,}\s*$/u.test(lines[index + 1] ?? '')
);
if (!hasMarkdownTable) failures.push('缺少能力追踪表');

if (!/反例/u.test(content)) failures.push('缺少反例');
if (!/测试/u.test(content)) failures.push('缺少测试');
if (!/剩余风险/u.test(content)) failures.push('缺少剩余风险');

const creativitySection = sectionBody('创造性与输出质量保护');
const creativityRequirements = [
  ['自由创作区', /自由创作区/u],
  ['非劣效', /非劣效/u],
  ['基线', /基线/u],
  ['盲评', /盲评/u]
];

for (const [name, pattern] of creativityRequirements) {
  if (!pattern.test(creativitySection)) failures.push(`缺少创造性保护字段: ${name}`);
}

for (const level of ['E0', 'E1', 'E2', 'E3', 'E4']) {
  if (!content.includes(level)) failures.push(`缺少证据等级: ${level}`);
}

const coversLayeredDesign = /分层创作|故事总线|首卷强启动|内部结构路线/u.test(content);
if (coversLayeredDesign) {
  const layeredRequirements = [
    ['计划与已发生分离', /计划.{0,20}已发生|已发生.{0,20}计划/su],
    ['前500有效字', /前\s*500.{0,12}有效/u],
    ['黄金三章', /黄金三章/u],
    ['10万字高潮', /10\s*万.{0,20}高潮/u],
    ['手机端证据', /360|390|430|手机端/u],
    ['148项追踪', /148\s*项/u]
  ];
  for (const [name, pattern] of layeredRequirements) {
    if (!pattern.test(content)) failures.push(`缺少分层创作证据: ${name}`);
  }
}

if (/作者.{0,16}(?:选择|勾选).{0,24}(?:救猫咪|三幕式|五幕式|英雄之旅)/su.test(content)) {
  failures.push('作者界面仍要求选择内部叙事方法');
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

const claimSections = [sectionBody('明确结论与置信度'), sectionBody('修正后的最终设计')].join('\n');
if (overclaims.some((pattern) => pattern.test(claimSections))) {
  failures.push('存在越界声明');
}

const overconstraints = [
  /所有(?:章节|创作|写作).{0,20}(?:必须)?严格遵守(?:章纲|大纲).{0,20}不得偏离/su,
  /创造性.{0,12}(?:服从|让位于)(?:一致性|规则|大纲)/su
];

if (overconstraints.some((pattern) => pattern.test(sectionBody('修正后的最终设计')))) {
  failures.push('存在压制创造性的绝对约束');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${filePath}`);
