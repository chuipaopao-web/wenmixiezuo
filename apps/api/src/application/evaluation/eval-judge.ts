import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalCaseRow } from '../../infrastructure/db/repositories/node-evaluation-repository.js';
import { buildFixture, type SyntheticFixture, type EvalGenre, type EvalLengthBand } from './eval-sample-factory.js';

/**
 * MODEL-NODE-EVAL验证阶段质量盲评（合同"准入与排名"节）：
 * - 文学质量不以关键词或JSON合格替代：生成节点结构通过的输出由异底层模型按节点量规盲评。
 * - 盲评：提示不透露输出来自哪个模型/成员；评审模型不得给自己评分（judgePoolFor排除本案例模型）。
 * - 分歧复核：主评审判不过→第二名异模型复核；两人一致不过=0，一人过一人不过=null（评审分歧单独统计，不凑数）。
 * - 抽查误放：主判通过的case按序号确定性抽查（shouldSpotCheck），异模型复核；抽查不过→分歧null=未定，不自动算过。
 * - 评审校准：评审模型先用已知正确（cleanPlan应判过）与已知缺陷（flawedPlan应判不过）样本验证可靠性；
 *   校准不过的评审其结论在quality_note标注"仅供参考"（buildCalibrationCases / CALIBRATION_CONFIG_ID）。
 * - 评审调用计入独立批次账本（含评审口径），参数版本记录在judge_source。
 */

export const JUDGE_CONFIG_ID = 'blind-v2(t=0.2,max=2000)';
// v2：评审资料口径按节点对齐候选实际所见（card-extract不见意图页/故事线标题；card-merge输入是分页短卡；
// card-finalize任务禁止把故事方向放偏好栏），并给出节点任务说明——此前评审按候选从未见过的资料判"遗漏"，
// 属评审资料错配（card-extract 35例与card-finalize 12例已作废重评，见invalidations.json）。
// v1：初版盲评。
// v2：cleanPlan修正为两卷真实承接作者确认对抗线（v1六名评审一致误判clean=工具失真，v1校准记录作废不重用）
export const CALIBRATION_CONFIG_ID = 'calibration-v2(t=0.2,max=2000)';

/** 主判通过案例的抽查密度：每3个抽1个（按pending序号确定性，可复现）。 */
export const SPOT_CHECK_EVERY = 3;
export function shouldSpotCheck(caseIndex: number): boolean {
  return caseIndex % SPOT_CHECK_EVERY === 0;
}

export interface JudgeVerdict { readonly pass: boolean; readonly issues: string[] }

/** 节点家族量规（只写可文学判断的维度；结构/字段合同已由机检覆盖，不重复评）。 */
function rubricFor(nodeKey: string): string {
  if (nodeKey.startsWith('card-')) return '评审要点：归纳是否忠于所给资料（无编造人物/设定/前提）、关键事实（主角身份、核心限制、故事方向、作者明确要求）有无遗漏或反向改写、分栏归类是否合理。不要求逐字照搬或固定长度。';
  if (nodeKey === 'skeleton') return '评审要点：宏观节奏与分卷是否服务故事容量；作者已确认故事线是否被真实承接（不是只挂名）；期待是否有提出、有推进、有回应；关系与落点是否具体可信；是否越界写章情节。';
  if (nodeKey === 'volume-card' || nodeKey === 'volumes-batch') return '评审要点：转折是否为读者能理解的具体事件或选择及其后果（不是"关键行动、重大牺牲"式空话）；开场/收束与锚点条件是否一致且可按正文核对；职责分配与该线收束是否匹配；爽点/情绪是否具体。';
  return '评审要点：输出是否完成该节点用途且忠于输入资料。';
}

/** 节点任务说明：评审必须按候选实际被布置的任务与实际可见资料评价，不按候选从未见过的资料判"遗漏"。 */
function taskNoteFor(nodeKey: string): string {
  if (nodeKey === 'card-extract') return '该节点候选的任务：只从所给开篇/设定分页提取短卡字段（生产流程此处不提供作者意图页与作者故事线标题，候选从未见过它们）。只评其对所给资料的归纳质量；不得因未提取资料中不存在的作者要求、故事线标题或意图页内容而判不过。';
  if (nodeKey === 'card-merge') return '该节点候选的任务：把若干分页短卡归并成一张短卡（保留字段内容、去重与合理归类）。候选输入是下面给出的分页短卡内容，不是原始资料全文；只评归并是否忠于输入短卡、归类是否合理。';
  if (nodeKey === 'card-finalize') return '该节点候选的任务：按合同纠正最终短卡的分类——premise必须归纳故事核心方向、protagonists必须保留主角、不得把故事方向误放为风格偏好栏。不得因preferences/prohibitions未收录故事线标题而判不过（任务明确禁止把故事方向当风格偏好）。';
  return '';
}

/** 评审可见资料：与候选在该节点实际所见对齐（card-extract排除意图页；card-merge给分页短卡内容）。 */
function judgeMaterialsFor(nodeKey: string, fixture: SyntheticFixture): { materials: unknown; authorLines: readonly string[] } {
  if (nodeKey === 'card-extract') {
    return { materials: fixture.documents.filter(d => !d.key.startsWith('intent:')).map(d => ({ key: d.key, text: d.text })), authorLines: [] };
  }
  if (nodeKey === 'card-merge') {
    return { materials: { cardFields: fixture.cardFields }, authorLines: fixture.authorStorylines.map(a => a.title) };
  }
  return { materials: fixture.documents.map(d => ({ key: d.key, text: d.text })), authorLines: fixture.authorStorylines.map(a => a.title) };
}

/** 盲评提示：只给候选实际可见的资料与节点任务说明，不透露候选出自哪个模型。 */
export function buildJudgePrompt(nodeKey: string, fixture: SyntheticFixture, candidateOutput: string): string {
  const { materials, authorLines } = judgeMaterialsFor(nodeKey, fixture);
  const taskNote = taskNoteFor(nodeKey);
  const authorPart = authorLines.length ? `作者已确认故事线：${JSON.stringify(authorLines)}。` : '';
  return `你是独立文学评审。下面是一份合成新书资料（含作者已确认故事线）和某参评成员在该资料上完成的"${nodeKey}"节点输出。请按量规判断这次输出是否达到可交付质量：结构合同已由机器另行核验，你只评文学与事实质量，不重复检查JSON字段。${rubricFor(nodeKey)}${taskNote}${authorPart}只返回JSON {"pass":true或false,"issues":["具体质量问题，无则空数组"]}，不解释过程，不评价资料本身。pass=false必须给出可定位的具体问题；没有具体问题不得判false。\n资料：${JSON.stringify(materials)}\n候选输出：${candidateOutput}`;
}

/** 解析评审结论；非JSON或字段不符抛错（调用方按unknown处理，不猜）。 */
export function parseJudgeVerdict(text: string): JudgeVerdict {
  const match = text.match(/\{[\s\S]*\}/u);
  if (!match) throw new Error('评审输出非JSON');
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  if (typeof parsed.pass !== 'boolean' || !Array.isArray(parsed.issues) || parsed.issues.some(i => typeof i !== 'string')) throw new Error('评审结论格式错误');
  if (parsed.pass === false && (parsed.issues as string[]).length === 0) throw new Error('判false必须给出具体问题');
  return { pass: parsed.pass, issues: (parsed.issues as string[]).slice(0, 10) };
}

/**
 * 评审模型候选顺序：排除本案例模型（不给自己评分），按给定名册顺序轮换起点以分散负载。
 * 复核时跳过主评审（secondary=true再排除primary）。
 */
export function judgePoolFor(caseModelId: string, roster: readonly string[], caseIndex: number, excludePrimary?: string): string | null {
  const eligible = roster.filter(m => m !== caseModelId && m !== excludePrimary);
  if (!eligible.length) return null;
  return eligible[caseIndex % eligible.length]!;
}

/** 读取案例的输出工件与对应样本fixture；工件缺失返回null（调用方如实跳过，不伪造评审）。 */
export function loadJudgmentInput(artifactDir: string, caseRow: EvalCaseRow): { fixture: SyntheticFixture; output: string } | null {
  if (!caseRow.artifact_path) return null;
  let output: string;
  try {
    const parsed = JSON.parse(readFileSync(join(artifactDir, caseRow.artifact_path), 'utf8')) as { output?: unknown };
    if (typeof parsed.output !== 'string') return null;
    output = parsed.output;
  } catch { return null; }
  return { fixture: buildFixture(caseRow.genre as EvalGenre, caseRow.length_band as EvalLengthBand), output };
}

export interface CalibrationCase {
  readonly label: 'clean-skeleton' | 'flawed-skeleton' | 'flawed-volume';
  readonly nodeKey: string;
  readonly prompt: string;
  readonly expectPass: boolean;
  readonly seededErrors: readonly string[];
}

/**
 * 评审可靠性校准样本（不落库，结果写judge-calibration.json）：
 * 已知正确的cleanPlan应判过；植入三类已知错误的flawedPlan应判不过
 * （skeleton量规覆盖字数合计与作者故事线去向，volume量规覆盖锚点条件可核对）。
 * 三项全符合预期=校准通过；任何一项不符=校准不过，该评审的结论仅供参考。
 */
export function buildCalibrationCases(fixture: SyntheticFixture): CalibrationCase[] {
  return [
    { label: 'clean-skeleton', nodeKey: 'skeleton', prompt: buildJudgePrompt('skeleton', fixture, JSON.stringify(fixture.cleanPlan)), expectPass: true, seededErrors: [] },
    { label: 'flawed-skeleton', nodeKey: 'skeleton', prompt: buildJudgePrompt('skeleton', fixture, JSON.stringify(fixture.flawedPlan)), expectPass: false, seededErrors: fixture.seededErrors },
    { label: 'flawed-volume', nodeKey: 'volume-card', prompt: buildJudgePrompt('volume-card', fixture, JSON.stringify(fixture.flawedPlan)), expectPass: false, seededErrors: fixture.seededErrors }
  ];
}
