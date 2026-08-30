import type { V7MemberModelBinding } from '../agents/agent-roster.js';
import type {
  V7AgentTaskKind,
  V7EffectiveMember,
  V7FixedRoleKey,
  V7GlobalMemberDefinition, V7GlobalModelBinding,
  V7RoleContract,
  V7TaskTemperaturePolicy
} from './agent-governance-contracts.js';

export const V7_ROLE_CONTRACTS: readonly V7RoleContract[] = [
  role('chief_editor', '主编', '主持任务、派单、设计全书粗路线、比较方案并作最终专业判断。',
    ['opening_review', 'title_design', 'setting_recommendation', 'setting_review', 'planning_recipe', 'planning_tree', 'planning_review', 'chapter_outline_review', 'cover_brief'],
    ['理解作者意图', '拆分任务', '比较方案', '发现冲突', '给出可执行结论'],
    ['正式资料读取', '候选方案读取', '问题反馈', '任务交接'],
    '只输出任务合同要求的结构化结果和一条作者能懂的结论，不替作者确认。', true),
  role('deputy_editor', '副编', '整理本次需要的资料，标注依据和不确定处，再交给创作成员。',
    ['planning_context', 'character_context'],
    ['语义筛选', '资料转译', '证据标注', '上下文压缩', '冲突预警'],
    ['正式资料读取', '版本核对', '最小充分资料包', '问题反馈'],
    '资料包必须来源明确、范围最小且不得把未来计划写成已经发生。', true),
  role('planning_writer', '策划编剧', '设计开书、设定、全书路线、卷、链和章纲等未来方案。',
    ['opening_design', 'setting_design', 'planning_recipe', 'planning_tree', 'chapter_outline', 'title_design'],
    ['创意方案', '结构规划', '人物设计', '商业节奏', '题材适配', '大白话表达'],
    ['方法候选读取', '正式资料读取', '设定目录读取', '问题反馈', '任务交接'],
    '方案必须完整、可修改、可追溯；未确认内容只能是候选。', true),
  role('lead_writer', '主笔', '依据确认章纲和正式资料创作正文，不擅自改变上游事实。',
    ['manuscript'],
    ['场景写作', '人物对白', '叙事节奏', '情绪兑现', '文风执行', '连续性遵守'],
    ['章纲读取', '正式资料读取', '相关正文检索', '问题反馈', '任务交接'],
    '输出完整正文和必要问题，不输出规划说明、技术字段或思维过程。', true),
  role('independent_reviewer', '审查编辑', '独立检查正文的事实、连续性、人物、节奏与阅读质量。',
    ['manuscript_review'],
    ['事实核对', '连续性审查', '人物审查', '文学质量审查', '商业阅读审查'],
    ['正式资料读取', '正文读取', '证据引用', '问题反馈'],
    '每条问题必须引用可核查证据并给出修改动作；与主笔同模型时不得标为独立审查。', false),
  role('continuity_editor', '记录编辑', '在正文落定后及时维护人物、事实、关系、故事线、伏笔和结算记录。',
    ['settlement', 'character_context', 'character_maintenance', 'planning_maintenance'],
    ['增量提取', '事实去重', '人物状态维护', '故事线维护', '伏笔维护', '开放问题维护'],
    ['不可变正文读取', '版本核对', '候选记录写入', '冲突报告', '任务重试'],
    '只依据已落定正文记录实际；无证据内容必须留在候选或开放问题。', false),
  role('visual_renderer', '封面画师', '严格按视觉工单生成封面图并保存可下载成品。',
    ['cover_render'],
    ['图像生成', '尺寸适配', '风格执行', '文字区域保留'],
    ['图像生成', '文件保存', '结果校验', '失败交接'],
    '只生成封面成品；封面不得出现“文秘写作”，作者署名必须使用笔名。', false)
] as const;

export const V7_TASK_TEMPERATURE_POLICIES: readonly V7TaskTemperaturePolicy[] = [
  policy('opening_design', '开书设计', .72, .55, .82, '需要创意，但必须忠于作者明确主角和时代。'),
  policy('opening_review', '开书审查', .24, .12, .36, '重判断和核对，减少无依据扩写。'),
  policy('title_design', '书名设计', .76, .60, .86, '需要商业创意与明显差异。'),
  policy('setting_recommendation', '设定条目推荐', .28, .16, .40, '先判断题材相关性，避免无关条目。'),
  policy('setting_design', '设定设计', .62, .48, .74, '兼顾创意、可用性和资料一致。'),
  policy('setting_review', '设定审查', .25, .12, .38, '以冲突核对和可执行建议为主。'),
  policy('planning_context', '规划资料整理', .16, .08, .28, '最小充分、证据优先。'),
  policy('planning_recipe', '方法配方', .60, .45, .72, '允许组合创新，但不能滥用模板。'),
  policy('planning_tree', '路线与卷链规划', .66, .50, .76, '需要跨层创意和明确因果。'),
  policy('planning_review', '规划审查', .28, .14, .40, '比较差异与风险，不替作者拍板。'),
  policy('planning_maintenance', '规划进度维护', .18, .08, .30, '只根据正式结算回填实际并提出未来调整候选。'),
  policy('chapter_outline', '章纲设计', .56, .42, .68, '具体可写且避免机械重复。'),
  policy('chapter_outline_review', '章纲审查', .20, .10, .32, '核对承接、因果、逐章变化和回报，避免用偏好代替错误。'),
  policy('manuscript', '正文创作', .72, .60, .84, '保留语言创造力并服从章纲事实。'),
  policy('manuscript_review', '正文审查', .22, .10, .34, '证据化审查，降低随意发挥。'),
  policy('settlement', '章节结算', .14, .06, .24, '只记录已发生事实。'),
  policy('character_context', '人物资料整理', .12, .05, .22, '严格选择可证实的人物资料。'),
  policy('character_maintenance', '人物与连续性维护', .18, .08, .28, '增量提取并保留不确定性。'),
  policy('cover_brief', '封面工单', .38, .24, .50, '构图可创新，文字与禁项必须准确。'),
  policy('cover_render', '封面出图', .35, .20, .50, '供支持温度参数的图像模型使用。')
] as const;

export const V7_TEXT_MODEL_PROFILE_KEYS = [
  'deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5.3',
  'kimi-k2.7-code', 'kimi-k3', 'doubao-seed-2.1-turbo'
] as const;

const V7_STRONG_MODEL_PROFILE_KEYS = [
  'deepseek-v4-pro', 'glm-5.3', 'kimi-k3'
] as const;

export const V7_GLOBAL_MEMBERS: readonly V7GlobalMemberDefinition[] = [
  member('chief-deepseek-v4-pro', '貂蝉', 'chief_editor', 'deepseek-v4-pro', 1, true),
  member('chief-glm-5-3', '顾承砚', 'chief_editor', 'glm-5.3', 2),
  member('chief-kimi-k3', '沈知微', 'chief_editor', 'kimi-k3', 3),

  member('deputy-glm-5-3', '西施', 'deputy_editor', 'glm-5.3', 1, true),
  member('deputy-deepseek-v4-pro', '妙玉', 'deputy_editor', 'deepseek-v4-pro', 2),
  member('deputy-kimi-k3', '谢临川', 'deputy_editor', 'kimi-k3', 3),

  member('planner-deepseek-v4-pro', '红玉', 'planning_writer', 'deepseek-v4-pro', 1, true),
  member('planner-glm-5-3', '幼薇', 'planning_writer', 'glm-5.3', 2),
  member('planner-kimi-k3', '苏映棠', 'planning_writer', 'kimi-k3', 3),

  member('writer-deepseek-v4-pro', '司马相如', 'lead_writer', 'deepseek-v4-pro', 1, true),
  member('writer-kimi-k3', '清照', 'lead_writer', 'kimi-k3', 2),
  member('writer-deepseek-v4-flash', '谢道韫', 'lead_writer', 'deepseek-v4-flash', 3),
  member('writer-glm-5-3', '曹雪芹', 'lead_writer', 'glm-5.3', 4),
  member('writer-kimi-2-7', '柳永', 'lead_writer', 'kimi-k2.7-code', 5),
  member('writer-doubao', '蒲松龄', 'lead_writer', 'doubao-seed-2.1-turbo', 6),

  member('review-kimi-k3', '周行简', 'independent_reviewer', 'kimi-k3', 1, true),
  member('review-glm-5-3', '顾清辞', 'independent_reviewer', 'glm-5.3', 2),
  member('review-deepseek-v4-pro', '陆观澜', 'independent_reviewer', 'deepseek-v4-pro', 3),

  member('continuity-deepseek-v4-pro', '裴文心', 'continuity_editor', 'deepseek-v4-pro', 1, true),
  member('continuity-glm-5-3', '宋知遥', 'continuity_editor', 'glm-5.3', 2),
  member('continuity-kimi-k3', '沈墨', 'continuity_editor', 'kimi-k3', 3),

  visual('visual-seedream', '绘真', 'visual_renderer', 'doubao-seedream', 1, true)
] as const;

/**
 * Historical task snapshots keep the member key that actually executed the
 * call. New work uses the canonical 22-person roster, while this map lets the
 * team page and audit counters attribute old runtime aliases to that same
 * person instead of showing duplicate staff or losing an active status.
 */
export const V7_LEGACY_MEMBER_IDENTITY_MAP: Readonly<Record<string, string>> = {
  'setting-chief-1': 'chief-deepseek-v4-pro',
  'planning-chief-deepseek-v4-pro': 'chief-deepseek-v4-pro',
  'planning-chief-glm-5-3': 'chief-glm-5-3',
  'planning-chief-kimi-k3': 'chief-kimi-k3',
  'creation-chief-deepseek-v4-pro': 'chief-deepseek-v4-pro',
  'creation-chief-glm-5-3': 'chief-glm-5-3',
  'creation-chief-kimi-k3': 'chief-kimi-k3',
  'setting-deputy-1': 'deputy-glm-5-3',
  'creation-context-glm-5-3': 'deputy-glm-5-3',
  'creation-context-deepseek-v4-pro': 'deputy-deepseek-v4-pro',
  'creation-context-kimi-k3': 'deputy-kimi-k3',
  'screenwriter-deepseek-v4-pro': 'planner-deepseek-v4-pro',
  'screenwriter-deepseek-v4-flash': 'planner-glm-5-3',
  'screenwriter-glm-5-3': 'planner-glm-5-3',
  'screenwriter-kimi-k3': 'planner-kimi-k3',
  'screenwriter-kimi-k2-7': 'writer-kimi-2-7',
  'screenwriter-doubao-seed-2-1-turbo': 'writer-doubao',
  'setting-writer-1': 'planner-deepseek-v4-pro',
  'setting-writer-2': 'planner-glm-5-3',
  'setting-writer-3': 'planner-glm-5-3',
  'setting-writer-4': 'planner-kimi-k3',
  'setting-writer-5': 'writer-kimi-2-7',
  'planning-writer-deepseek-v4-pro': 'planner-deepseek-v4-pro',
  'planning-writer-glm-5-3': 'planner-glm-5-3',
  'planning-writer-kimi-k3': 'planner-kimi-k3',
  'creation-outline-deepseek-v4-pro': 'planner-deepseek-v4-pro',
  'creation-outline-glm-5-3': 'planner-glm-5-3',
  'creation-outline-kimi-k3': 'planner-kimi-k3',
  'creation-writer-kimi-k3': 'writer-kimi-k3',
  'creation-writer-deepseek-v4-pro': 'writer-deepseek-v4-pro',
  'creation-writer-deepseek-v4-flash': 'writer-deepseek-v4-flash',
  'creation-writer-glm-5-3': 'writer-glm-5-3',
  'creation-writer-kimi-k2-7': 'writer-kimi-2-7',
  'creation-writer-doubao': 'writer-doubao',
  'creation-review-glm-5-3': 'review-glm-5-3',
  'creation-review-deepseek-v4-pro': 'review-deepseek-v4-pro',
  'creation-review-kimi-k3': 'review-kimi-k3',
  'creation-settlement-glm-5-3': 'continuity-glm-5-3',
  'creation-settlement-deepseek-v4-pro': 'continuity-deepseek-v4-pro',
  'creation-settlement-kimi-k3': 'continuity-kimi-k3',
  'continuity-deepseek-v4-flash': 'continuity-deepseek-v4-pro',
  'continuity-kimi-2-7': 'continuity-kimi-k3',
  'visual-huizhen': 'visual-seedream'
};

export function canonicalV7MemberKey(memberKey: string): string {
  const key = memberKey.trim();
  return V7_LEGACY_MEMBER_IDENTITY_MAP[key] ?? key;
}

export function runtimeMemberKeysForCanonicalV7Member(memberKey: string): string[] {
  const canonical = canonicalV7MemberKey(memberKey);
  return [canonical, ...Object.entries(V7_LEGACY_MEMBER_IDENTITY_MAP)
    .filter(([, target]) => target === canonical)
    .map(([alias]) => alias)];
}

export const V7_MODEL_PROFILE_LABELS: Readonly<Record<string, string>> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'glm-5.3': 'GLM 5.3',
  'kimi-k2.7-code': 'Kimi 2.7',
  'kimi-k3': 'Kimi K3',
  'doubao-seed-2.1-turbo': '豆包 Seed 2.1 Turbo',
  'doubao-seedream': 'Seedream'
};

export function allowedModelProfilesForRole(roleKey: V7FixedRoleKey): readonly string[] {
  if (roleKey === 'visual_renderer') return ['doubao-seedream'];
  if (roleKey === 'lead_writer') return V7_TEXT_MODEL_PROFILE_KEYS;
  return V7_STRONG_MODEL_PROFILE_KEYS;
}

export function modelBindingForProfile(profileKey: string): V7GlobalModelBinding {
  if (profileKey === 'doubao-seedream') return { provider: 'volcengine-ark-image', modelId: 'doubao-seedream-5-0-260128', plan: 'image' };
  if (!(V7_TEXT_MODEL_PROFILE_KEYS as readonly string[]).includes(profileKey)) throw new Error(`未批准的模型档案：${profileKey}`);
  return modelBinding(profileKey);
}

/**
 * Runtime task snapshots freeze the concrete provider/model/plan that will be
 * called. Resolve that immutable binding back to its canonical governance key
 * so PromptManifest never guesses from a static member default and never
 * stores a provider model id as though it were a profile key.
 */
export function modelProfileKeyForBinding(binding: Readonly<{ provider: string; modelId: string; plan: string }>): string {
  const signature = modelSignature(binding);
  const profileKey = Object.keys(V7_MODEL_PROFILE_LABELS).find(
    (candidate) => modelSignature(modelBindingForProfile(candidate)) === signature
  );
  if (profileKey === undefined) {
    throw new Error(`模型绑定没有对应的治理档案：${signature}`);
  }
  return profileKey;
}

export function membersForFixedRole(roleKey: V7FixedRoleKey, members: readonly V7GlobalMemberDefinition[] = V7_GLOBAL_MEMBERS): V7GlobalMemberDefinition[] {
  return members.filter((candidate) => candidate.fixedRoleKey === roleKey && candidate.enabledByDefault)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
}

export function taskTemperaturePolicy(taskKind: V7AgentTaskKind): V7TaskTemperaturePolicy {
  const result = V7_TASK_TEMPERATURE_POLICIES.find((candidate) => candidate.taskKind === taskKind);
  if (result === undefined) throw new Error(`未登记任务温度策略：${taskKind}`);
  return result;
}

export function effectiveTemperature(taskKind: V7AgentTaskKind, adjustment = 0, override?: number): number {
  const policy = taskTemperaturePolicy(taskKind);
  const requested = override ?? policy.defaultTemperature + adjustment;
  return Math.round(Math.min(policy.maximumTemperature, Math.max(policy.minimumTemperature, requested)) * 100) / 100;
}

export function independentReviewers(
  writer: Pick<V7EffectiveMember | V7GlobalMemberDefinition, 'model'>,
  members: readonly (V7EffectiveMember | V7GlobalMemberDefinition)[] = V7_GLOBAL_MEMBERS
): Array<V7EffectiveMember | V7GlobalMemberDefinition> {
  const writerSignature = modelSignature(writer.model);
  return members.filter((candidate) => candidate.fixedRoleKey === 'independent_reviewer'
      && ('enabled' in candidate ? candidate.enabled : candidate.enabledByDefault)
      && modelSignature(candidate.model) !== writerSignature)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
}

export function validateGlobalAgentRegistry(members: readonly V7GlobalMemberDefinition[] = V7_GLOBAL_MEMBERS): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const candidate of members) {
    if (keys.has(candidate.memberKey)) errors.push(`成员编号重复：${candidate.memberKey}`);
    if (names.has(candidate.displayName)) errors.push(`同一成员不得重复占多个固定岗位：${candidate.displayName}`);
    keys.add(candidate.memberKey);
    names.add(candidate.displayName);
    if (!(candidate.modelProfileKey in V7_MODEL_PROFILE_LABELS)) errors.push(`模型档案未登记：${candidate.modelProfileKey}`);
    if (candidate.modelProfileKey === 'kimi-k3' && candidate.model.plan !== 'agent') errors.push(`${candidate.displayName}的Kimi K3必须使用Agent Plan`);
    if (!['kimi-k3', 'doubao-seedream'].includes(candidate.modelProfileKey) && candidate.model.plan !== 'coding') {
      errors.push(`${candidate.displayName}的文本模型必须使用Coding Plan`);
    }
    if (candidate.modelProfileKey === 'doubao-seed-2.1-turbo' && candidate.fixedRoleKey !== 'lead_writer') {
      errors.push(`${candidate.displayName}的豆包模型只能担任主笔`);
    }
  }
  const minimums: Record<V7FixedRoleKey, number> = {
    chief_editor: 3, deputy_editor: 3, planning_writer: 3, lead_writer: 6,
    independent_reviewer: 3, continuity_editor: 3, visual_renderer: 1
  };
  for (const [roleKey, minimum] of Object.entries(minimums) as Array<[V7FixedRoleKey, number]>) {
    const enabled = members.filter((candidate) => candidate.fixedRoleKey === roleKey && candidate.enabledByDefault);
    if (enabled.length < minimum) errors.push(`${roleKey}至少需要${minimum}名成员`);
    if (enabled.filter((candidate) => candidate.defaultForRole).length !== 1) errors.push(`${roleKey}必须且只能有一名默认成员`);
  }
  return errors;
}

function role(
  roleKey: V7FixedRoleKey,
  publicName: string,
  publicResponsibility: string,
  taskKinds: readonly V7AgentTaskKind[],
  capabilities: readonly string[],
  tools: readonly string[],
  outputContract: string,
  authorSelectable: boolean
): V7RoleContract {
  return {
    roleKey, publicName, publicResponsibility, taskKinds, capabilities, tools, outputContract, authorSelectable,
    failureContract: '失败时必须停止显示工作中，先真诚道歉，再说明已保存内容和可执行的重试或交接方案。'
  };
}

function policy(taskKind: V7AgentTaskKind, publicName: string, defaultTemperature: number, minimumTemperature: number, maximumTemperature: number, rationale: string): V7TaskTemperaturePolicy {
  return { taskKind, publicName, defaultTemperature, minimumTemperature, maximumTemperature, rationale };
}

function member(
  memberKey: string,
  displayName: string,
  fixedRoleKey: V7FixedRoleKey,
  modelProfileKey: string,
  fallbackPriority: number,
  defaultForRole = false
): V7GlobalMemberDefinition {
  const model = modelBindingForProfile(modelProfileKey);
  return { memberKey, displayName, fixedRoleKey, modelProfileKey, model, fallbackPriority, defaultForRole, enabledByDefault: true, promptInstruction: '' };
}

function visual(
  memberKey: string,
  displayName: string,
  fixedRoleKey: 'visual_renderer',
  modelProfileKey: string,
  fallbackPriority: number,
  defaultForRole = false
): V7GlobalMemberDefinition {
  const modelId = 'doubao-seedream-5-0-260128';
  return {
    memberKey, displayName, fixedRoleKey, modelProfileKey,
    model: { provider: 'volcengine-ark-image', modelId, plan: 'image' },
    fallbackPriority, defaultForRole, enabledByDefault: true, promptInstruction: ''
  };
}

function modelBinding(profileKey: string): V7MemberModelBinding {
  return profileKey === 'kimi-k3'
    ? { provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent' }
    : { provider: 'volcengine-ark-coding-plan', modelId: profileKey, plan: 'coding' };
}

function modelSignature(model: Readonly<{ provider: string; modelId: string; plan: string }>): string {
  return `${model.provider}:${model.modelId}:${model.plan}`;
}
