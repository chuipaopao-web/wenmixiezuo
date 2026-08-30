import { V7_LAYERED_PLANNING_VERSION } from './method-asset-profiles.js';
import {
  PLANNING_EDITORIAL_SEATS,
  validateLayeredPlanningRecipe,
  type LayeredPlanningRecipe,
  type PlanningEditorialSeat
} from './layered-planning-engine.js';
import type { V7MemberModelBinding } from '../agents/agent-roster.js';
import type { V7PlanningMethodCandidate } from './planning-method-retrieval.js';
import { validateRecipeMethods } from './planning-story-routes.js';

/**
 * 规划运行时只使用全局固定岗位。
 * structure_deputy/commercial_deputy 仅是历史方案通道键，不是成员岗位。
 */
export type V7PlanningRoleKey = 'chief_editor' | 'planning_writer' | 'continuity_editor';
export type V7PlanningDispatchKey = V7PlanningRoleKey | PlanningEditorialSeat['seatKey'];

export interface V7PlanningMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey: V7PlanningRoleKey;
  enabledByDefault: boolean;
  defaultForRole: boolean;
  fallbackPriority: number;
  model: V7MemberModelBinding;
  promptInstruction: string;
}

export interface V7PlanningRecipeProposal {
  schema: 'v7-planning-recipe-proposal-v1';
  seatKey: PlanningEditorialSeat['seatKey'];
  publicSummary: string;
  selectionReason: string;
  recipe: LayeredPlanningRecipe;
  strengths: string[];
  risks: string[];
  authorDecisions: string[];
}

export interface V7PlanningRecipeComparison {
  schema: 'v7-planning-recipe-comparison-v1';
  publicSummary: string;
  recommendedProposalId: string;
  recommendedRecipe: LayeredPlanningRecipe;
  differences: Array<{ proposalId: string; publicName: string; difference: string }>;
  fusionNotes: string[];
  risks: string[];
  authorDecisions: string[];
}

export const V7_PLANNING_MEMBERS: readonly V7PlanningMemberDefinition[] = [
  member('chief-deepseek-v4-pro', '貂蝉', 'chief_editor', true, true, 1, coding('deepseek-v4-pro')),
  member('chief-glm-5-3', '顾承砚', 'chief_editor', true, false, 2, coding('glm-5.3')),
  member('chief-kimi-k3', '沈知微', 'chief_editor', true, false, 3, agent('kimi-k3')),
  member('planner-deepseek-v4-pro', '红玉', 'planning_writer', true, true, 1, coding('deepseek-v4-pro')),
  member('planner-glm-5-3', '幼薇', 'planning_writer', true, false, 2, coding('glm-5.3')),
  member('planner-kimi-k3', '苏映棠', 'planning_writer', true, false, 3, agent('kimi-k3')),
  member('continuity-deepseek-v4-pro', '裴文心', 'continuity_editor', true, true, 1, coding('deepseek-v4-pro')),
  member('continuity-glm-5-3', '宋知遥', 'continuity_editor', true, false, 2, coding('glm-5.3')),
  member('continuity-kimi-k3', '沈墨', 'continuity_editor', true, false, 3, agent('kimi-k3'))
] as const;

export function planningSeat(seatKey: PlanningEditorialSeat['seatKey']): PlanningEditorialSeat {
  const seat = PLANNING_EDITORIAL_SEATS.find((candidate) => candidate.seatKey === seatKey);
  if (seat === undefined) throw new Error(`规划席位不存在：${seatKey}`);
  return seat;
}

export function buildPlanningFallbackChain(
  roleKey: V7PlanningDispatchKey,
  options: { selectedMemberKey?: string; members?: readonly V7PlanningMemberDefinition[] } = {}
): V7PlanningMemberDefinition[] {
  const source = options.members ?? V7_PLANNING_MEMBERS;
  const canonicalRoleKey = canonicalPlanningRole(roleKey);
  let candidates = source
    .filter((candidate) => candidate.roleKey === canonicalRoleKey && candidate.enabledByDefault)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  // structure/commercial are persisted proposal-seat keys, not permanent jobs.
  // Rotate the same three fixed chief members so a new run gets three distinct
  // primary planners without registering one person three times in the roster.
  if (roleKey === 'structure_deputy') candidates = rotate(candidates, 1);
  if (roleKey === 'commercial_deputy') candidates = rotate(candidates, 2);
  const selected = options.selectedMemberKey === undefined
    ? undefined
    : candidates.find((candidate) => candidate.memberKey === options.selectedMemberKey);
  if (options.selectedMemberKey !== undefined && selected === undefined) {
    throw new Error(`选择的${roleKey}成员未上岗或不存在：${options.selectedMemberKey}`);
  }
  const fallback = isPlanningProposalSeat(roleKey)
    ? candidates[0]
    : candidates.find((candidate) => candidate.defaultForRole);
  if (fallback === undefined) throw new Error(`${roleKey}没有可用的默认成员`);
  const ordered = [...(selected === undefined ? [] : [selected]), fallback, ...candidates];
  const models = new Set<string>();
  const members = new Set<string>();
  return ordered.filter((candidate) => {
    const modelKey = `${candidate.model.provider}:${candidate.model.modelId}:${candidate.model.plan}`;
    if (members.has(candidate.memberKey) || models.has(modelKey)) return false;
    members.add(candidate.memberKey);
    models.add(modelKey);
    return true;
  });
}

export function validatePlanningEditorialRoster(members: readonly V7PlanningMemberDefinition[] = V7_PLANNING_MEMBERS): string[] {
  const errors: string[] = [];
  const assignments = new Set<string>();
  const memberKeys = new Set<string>();
  for (const memberDefinition of members) {
    const assignmentKey = `${memberDefinition.roleKey}:${memberDefinition.memberKey}`;
    if (assignments.has(assignmentKey)) errors.push(`规划席位重复安排：${memberDefinition.memberKey}/${memberDefinition.roleKey}`);
    assignments.add(assignmentKey);
    if (memberKeys.has(memberDefinition.memberKey)) errors.push(`规划成员身份重复：${memberDefinition.memberKey}`);
    memberKeys.add(memberDefinition.memberKey);
    const runtimeRoleKey = memberDefinition.roleKey as string;
    if (runtimeRoleKey === 'structure_deputy' || runtimeRoleKey === 'commercial_deputy') {
      errors.push(`方案槽不得登记为成员的固定岗位：${memberDefinition.memberKey}/${memberDefinition.roleKey}`);
    }
    const isKimiK3 = memberDefinition.model.modelId.toLowerCase() === 'kimi-k3';
    if (isKimiK3 && (memberDefinition.model.plan !== 'agent' || memberDefinition.model.provider !== 'volcengine-ark-agent-plan')) {
      errors.push(`${memberDefinition.memberKey}：Kimi K3必须使用Agent Plan`);
    }
    if (!isKimiK3 && (memberDefinition.model.plan !== 'coding' || memberDefinition.model.provider !== 'volcengine-ark-coding-plan')) {
      errors.push(`${memberDefinition.memberKey}：普通规划成员必须使用Coding Plan`);
    }
  }
  for (const roleKey of ['chief_editor', 'planning_writer', 'continuity_editor'] as const) {
    const role = members.filter((candidate) => candidate.roleKey === roleKey && candidate.enabledByDefault);
    if (role.length < 3) errors.push(`${roleKey}至少需要三名可交接成员`);
    if (role.filter((candidate) => candidate.defaultForRole).length !== 1) errors.push(`${roleKey}必须且只能有一名默认成员`);
  }
  const primaryAssignments = [
    ...(['chief_editor', 'structure_deputy', 'commercial_deputy'] as const).map((roleKey) =>
      buildPlanningFallbackChain(roleKey, { members })[0]),
    ...members.filter((candidate) => candidate.roleKey === 'planning_writer' && candidate.enabledByDefault)
      .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority).slice(0, 3)
  ].filter((candidate): candidate is V7PlanningMemberDefinition => candidate !== undefined);
  if (new Set(primaryAssignments.map((candidate) => candidate.displayName)).size !== primaryAssignments.length) {
    errors.push('同一轮默认规划席位不得重复安排同一成员');
  }
  return errors;
}

function canonicalPlanningRole(roleKey: V7PlanningDispatchKey): V7PlanningRoleKey {
  return roleKey === 'structure_deputy' || roleKey === 'commercial_deputy' ? 'chief_editor' : roleKey;
}

function isPlanningProposalSeat(roleKey: V7PlanningDispatchKey): boolean {
  return roleKey === 'chief_editor' || roleKey === 'structure_deputy' || roleKey === 'commercial_deputy';
}

function rotate<T>(values: readonly T[], count: number): T[] {
  if (values.length === 0) return [];
  const offset = count % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

export function parsePlanningRecipeProposal(
  output: string,
  seatKey: PlanningEditorialSeat['seatKey'],
  allowedMethodKeys?: readonly string[]
): V7PlanningRecipeProposal {
  const value = parseJsonObject(output) as Partial<V7PlanningRecipeProposal>;
  if (value.schema !== 'v7-planning-recipe-proposal-v1' || value.seatKey !== seatKey) throw new Error('规划成员返回的配方格式不完整');
  if (value.recipe === undefined) throw new Error('规划成员没有返回分层配方');
  const recipe = value.recipe as LayeredPlanningRecipe;
  const errors = validateLayeredPlanningRecipe(recipe);
  if (errors.length > 0) throw new Error(`规划成员返回的配方无效：${errors.join('；')}`);
  if (allowedMethodKeys !== undefined) validateRecipeMethods(recipe, allowedMethodKeys);
  return {
    schema: 'v7-planning-recipe-proposal-v1', seatKey,
    publicSummary: requiredText(value.publicSummary, '方案说明'),
    selectionReason: requiredText(value.selectionReason, '选择理由'),
    recipe,
    strengths: textList(value.strengths, '方案优势'),
    risks: textList(value.risks, '方案风险'),
    authorDecisions: textList(value.authorDecisions, '作者待决项', true)
  };
}

export function parsePlanningRecipeComparison(output: string, proposalIds: readonly string[]): V7PlanningRecipeComparison {
  const value = parseJsonObject(output) as Partial<V7PlanningRecipeComparison>;
  if (value.schema !== 'v7-planning-recipe-comparison-v1') throw new Error('主编比较结果格式不完整');
  const recommendedProposalId = requiredText(value.recommendedProposalId, '推荐方案');
  if (!proposalIds.includes(recommendedProposalId)) throw new Error('主编推荐了不存在的方案');
  if (value.recommendedRecipe === undefined) throw new Error('主编没有返回整理后的配方');
  const recipe = value.recommendedRecipe as LayeredPlanningRecipe;
  const errors = validateLayeredPlanningRecipe(recipe);
  if (errors.length > 0) throw new Error(`主编整理后的配方无效：${errors.join('；')}`);
  const differences = Array.isArray(value.differences) ? value.differences.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('方案差异格式无效');
    const entry = item as Record<string, unknown>;
    const proposalId = requiredText(entry.proposalId, '差异方案');
    if (!proposalIds.includes(proposalId)) throw new Error('差异引用了不存在的方案');
    return { proposalId, publicName: requiredText(entry.publicName, '方案名称'), difference: requiredText(entry.difference, '方案差异') };
  }) : [];
  return {
    schema: 'v7-planning-recipe-comparison-v1',
    publicSummary: requiredText(value.publicSummary, '比较结论'),
    recommendedProposalId,
    recommendedRecipe: recipe,
    differences,
    fusionNotes: textList(value.fusionNotes, '融合说明', true),
    risks: textList(value.risks, '共同风险'),
    authorDecisions: textList(value.authorDecisions, '作者待决项', true)
  };
}

export function planningRecipePrompt(input: {
  seatKey: PlanningEditorialSeat['seatKey'];
  sourceSnapshot: unknown;
  recipeId: string;
  candidates?: readonly V7PlanningMethodCandidate[];
}): string {
  const seat = planningSeat(input.seatKey);
  return [
    '你正在文秘写作V7规划编辑部独立值班。请只返回一个JSON对象，不要Markdown，不要思维过程。',
    `席位：${seat.publicName}。责任：${seat.responsibility}`,
    `独立检查：${seat.independentFocus.join('；')}`,
    `禁止：${seat.cannotDo.join('；')}`,
    '你看不到其他席位答案。方法是软参考，可以组合、删减或提出本书临时创新方法；不能为套模板牺牲人物合理选择。',
    '资料中formal和actual不得改写；goal只指导候选；未来规划不能冒充正文实际。',
    `配方recipeId固定为${input.recipeId}，version固定为1，engineVersion固定为${V7_LAYERED_PLANNING_VERSION}，status固定为candidate。`,
    '配方根节点必须是book_backbone；可包含volume_distribution和volume。未来卷保持粗方向，不在这里展开所有chain和chapter_execution。',
    '每个节点最多一个primary方法，所有方法strength只能是soft；每个节点最多使用六项方法，宁少勿杂。若引用库方法，methodKey必须来自本次候选且适用当前层。',
    '输出字段必须是：schema,seatKey,publicSummary,selectionReason,recipe,strengths,risks,authorDecisions。',
    'recipe每个节点必须完整包含nodeId,layer,title,responsibility,status,budget,hardRequirements,methodGuidance,readerExperience,creativeSpace,expectedChanges,children。',
    'readerExperience必须完整包含publicSummary,pressureRhythm,payoffCadence,informationRhythm,contrastWithPrevious,designReason。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `本次检索到的少量候选方法：${JSON.stringify(input.candidates ?? [])}`
  ].join('\n\n');
}

export function planningComparisonPrompt(input: {
  sourceSnapshot: unknown;
  proposals: ReadonlyArray<{ proposalId: string; publicName: string; proposal: V7PlanningRecipeProposal }>;
}): string {
  return [
    '你是文秘写作V7规划主编，现在主持三份已经独立保存的方案比较。只返回一个JSON对象，不要Markdown，不要思维过程。',
    '不得隐藏、改写或假装三份原始方案不存在。请比较它们如何理解作者原意、篇幅容量、跨卷递进、商业追读、风险和创意空间。',
    '可以推荐一份并做必要融合，但方法仍是软参考；不能替作者确认。正式资料和正文实际不得改变。',
    '输出字段必须是：schema="v7-planning-recipe-comparison-v1",publicSummary,recommendedProposalId,recommendedRecipe,differences,fusionNotes,risks,authorDecisions。',
    'recommendedRecipe必须是完整有效的LayeredPlanningRecipe，status=candidate，且每个节点最多一个primary方法。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `三份独立方案：${JSON.stringify(input.proposals)}`
  ].join('\n\n');
}

function member(
  memberKey: string,
  displayName: string,
  roleKey: V7PlanningRoleKey,
  enabledByDefault: boolean,
  defaultForRole: boolean,
  fallbackPriority: number,
  model: V7MemberModelBinding
): V7PlanningMemberDefinition {
  return { memberKey, displayName, roleKey, enabledByDefault, defaultForRole, fallbackPriority, model, promptInstruction: '' };
}

function coding(modelId: string): V7MemberModelBinding {
  return { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' };
}

function agent(modelId: 'kimi-k3'): V7MemberModelBinding {
  return { provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' };
}

function parseJsonObject(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('模型没有返回JSON对象');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型返回内容不是JSON对象');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function textList(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label}必须是${allowEmpty ? '' : '非空'}数组`);
  return value.map((item) => requiredText(item, label));
}
