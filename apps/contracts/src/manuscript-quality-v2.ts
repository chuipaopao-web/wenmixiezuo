export interface ManuscriptMetaNarrationIssue {
  code: string;
  evidence: string;
}

export interface ManuscriptMetaNarrationAssessment {
  passed: boolean;
  issues: ManuscriptMetaNarrationIssue[];
}

export interface ManuscriptParagraphReuseAssessment {
  passed: boolean;
  sharedParagraphs: number;
  currentParagraphs: number;
  referenceParagraphs: number;
  ratio: number;
}

export const MANUSCRIPT_QUALITY_POLICY_VERSION = 'manuscript-quality-v2';

const META_NARRATION_RULES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'workflow-result', pattern: /(?:本章|本事件|当前阶段).{0,24}(?:结算|记录).{0,16}(?:正文实际发生|正式状态|下一接口)/u },
  { code: 'source-audit', pattern: /(?:资料|内容|证据).{0,10}(?:能够|可以|必须)?回查|可回查的证据链/u },
  { code: 'formal-conclusion', pattern: /(?:推测|猜测|怀疑).{0,18}(?:写成|写进|变成).{0,8}(?:正式结论|正式事实|正式状态|正史)/u },
  { code: 'chapter-handoff', pattern: /(?:下一章必须从这个状态继续|让下一章承接真实状态|留给下一章|替下一章.{0,10}写死答案)/u },
  { code: 'planning-explanation', pattern: /规划仍是未来|已经发生的只有正文|正文中能回查/u },
  { code: 'quality-rationale', pattern: /(?:胜利|成长|关系变化).{0,24}(?:不是|不能|没有).{0,20}(?:一行数值|一段总结|写在设定里|一句提示)/u },
  { code: 'integrity-rationale', pattern: /(?:所有损耗|伤势|耐久).{0,24}(?:没有凭空恢复|没有无缘无故|自动复原|一笔勾销)/u },
  { code: 'reader-instruction', pattern: /面板给出数字.{0,24}(?:胜负原因|行动顺序)|地图不是全知答案/u }
];

const SEVERE_META_CODES = new Set(['workflow-result', 'chapter-handoff', 'planning-explanation']);

/** Detect quality-governance commentary that has leaked into novel prose. */
export function assessManuscriptMetaNarration(content: string): ManuscriptMetaNarrationAssessment {
  const issues = META_NARRATION_RULES.flatMap(({ code, pattern }) => {
    const match = pattern.exec(content);
    return match === null ? [] : [{ code, evidence: match[0].slice(0, 120) }];
  });
  return {
    passed: !issues.some((issue) => SEVERE_META_CODES.has(issue.code)) && issues.length < 2,
    issues
  };
}

/** Normalize paragraphs for cross-chapter reuse detection without changing author text. */
export function normalizedManuscriptParagraphs(content: string): string[] {
  return content
    .replace(/^\s*第[ \t]*\d+[ \t]*章[^\r\n]*(?:\r?\n)+/u, '')
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph
      .normalize('NFKC')
      .replace(/[，。！？；：、“”‘’（）《》【】—…,.!?;:\-]/gu, '')
      .replace(/[ \t\r\n]/gu, '')
      .replace(/[0-9]+(?:\.[0-9]+)?/gu, '#')
      .trim())
    .filter((paragraph) => paragraph.length >= 40);
}

export function assessManuscriptParagraphReuse(
  current: string,
  reference: string,
  options: { maximumRatio?: number; minimumSharedParagraphs?: number } = {}
): ManuscriptParagraphReuseAssessment {
  const maximumRatio = options.maximumRatio ?? 0.28;
  const minimumSharedParagraphs = options.minimumSharedParagraphs ?? 3;
  const currentParagraphs = new Set(normalizedManuscriptParagraphs(current));
  const referenceParagraphs = new Set(normalizedManuscriptParagraphs(reference));
  let sharedParagraphs = 0;
  for (const paragraph of currentParagraphs) if (referenceParagraphs.has(paragraph)) sharedParagraphs += 1;
  const ratio = sharedParagraphs / Math.max(1, Math.min(currentParagraphs.size, referenceParagraphs.size));
  return {
    passed: sharedParagraphs < minimumSharedParagraphs || ratio <= maximumRatio,
    sharedParagraphs,
    currentParagraphs: currentParagraphs.size,
    referenceParagraphs: referenceParagraphs.size,
    ratio
  };
}
