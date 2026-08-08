import {
  getPublicNarrativeTemplateCatalog,
  type PublicNarrativeTemplate
} from '@wenmi/contracts';
import type { BookProfileViewData } from '../lib/api/client';

export interface PlotPattern {
  id: string;
  version: number;
  contentHash: string;
  name: string;
  group: string;
  summary: string;
  suitable: string[];
  structure: string[];
  questions: string[];
  preview: string;
  promise: string;
  risk: string;
}

function groupFor(template: PublicNarrativeTemplate): string {
  if (template.templateKey.includes('truth') || template.templateKey.includes('strategy')) return '真相与局势';
  if (template.templateKey.includes('relationship')) return '人物关系';
  if (template.templateKey.includes('build')) return '积累与建设';
  if (template.templateKey.includes('pressure') || template.templateKey.includes('escalating')) return '压力与反击';
  return '人物成长';
}

function toPlotPattern(template: PublicNarrativeTemplate): PlotPattern {
  return {
    id: template.templateKey,
    version: template.templateVersion,
    contentHash: template.contentHash,
    name: template.publicTitle,
    group: groupFor(template),
    summary: template.publicExplanation,
    suitable: template.fitConditions,
    structure: template.beats.map((item) => `${item.publicFunction}：${item.expectedChange}`),
    questions: template.authorQuestions,
    preview: template.previewPrompt,
    promise: template.beats.at(-1)?.expectedChange ?? '让事件结果改变后续状态',
    risk: template.knownRisks.join('；')
  };
}

const volumeCatalog = getPublicNarrativeTemplateCatalog('volume');
export const PLOT_PATTERNS: PlotPattern[] = volumeCatalog.templates.map(toPlotPattern);
export const PLOT_PATTERN_GROUPS = [...new Set(PLOT_PATTERNS.map((item) => item.group))];

export function recommendPlotPatterns(profile: BookProfileViewData | null): PlotPattern[] {
  const signals = profile === null
    ? []
    : [profile.category, ...profile.subjects, ...profile.mainTags, ...profile.customTags];
  const recommended = getPublicNarrativeTemplateCatalog('volume', signals).templates;
  return recommended.map(toPlotPattern);
}

export function buildPlotPatternDiscussionPacket(primary: PlotPattern | null, supporting: PlotPattern[]): string {
  if (primary === null) return '';
  const render = (item: PlotPattern): string => [
    `${item.name}（模板 ${item.id}@${item.version}，${item.contentHash}）`,
    item.summary,
    `推进参考：${item.structure.join(' → ')}`,
    `请先问作者：${item.questions.join('；')}`,
    `可能风险：${item.risk}`,
    `代入本书时：${item.preview}`
  ].join('；');
  return `\n推进方式只供参考，不是必须照做：\n主要参考：${render(primary)}\n补充参考：${supporting.length > 0 ? supporting.map(render).join('；') : '无'}\n请主编与两名编剧分别判断它是否适合当前一卷；可以调整、混合、完全不用，也不能把节拍当成固定章数。作者确认卷纲后，事件设计必须说明怎样服务卷纲；有价值的偏离要先交给作者决定。`;
}