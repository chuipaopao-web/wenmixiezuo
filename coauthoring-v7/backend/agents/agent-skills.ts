import {
  V7_NODE_ROLE_PERMISSIONS,
  V7_NODE_TOOL_PERMISSIONS,
  type V7AgentToolKey,
  type V7OpeningNodeKey
} from './agent-tools.js';
import type { V7OpeningRoleKey } from './agent-roster.js';

export type V7AgentSkillKind = 'core' | 'role' | 'node';

export interface V7AgentSkillDefinition {
  skillKey: string;
  version: number;
  kind: V7AgentSkillKind;
  title: string;
  roleKey: V7OpeningRoleKey | null;
  nodeKey: V7OpeningNodeKey | null;
  responsibilities: readonly string[];
  inputSources: readonly string[];
  excludedSources: readonly string[];
  outputContract: Readonly<Record<string, string>>;
  stopConditions: readonly string[];
  candidateBoundary: string;
}

export interface CompiledOpeningSkillBundle {
  roleKey: V7OpeningRoleKey;
  nodeKey: V7OpeningNodeKey;
  skillVersionIds: readonly string[];
  responsibilities: readonly string[];
  inputSources: readonly string[];
  excludedSources: readonly string[];
  outputContract: Readonly<Record<string, string>>;
  stopConditions: readonly string[];
  toolKeys: readonly V7AgentToolKey[];
  candidateBoundary: string;
}

const CORE_SKILL = skill({
  skillKey: 'opening-core-boundary', kind: 'core', title: '开书数据与创作边界',
  roleKey: null, nodeKey: null,
  responsibilities: [
    '以作者原始想法为最高创作输入，不擅自替换核心人物、时代、关系或脑洞。',
    '只使用当前账号、当前开书任务和冻结版本；内部方法与剧情库只提供软参考。',
    '事实、候选与作者确认结果分开；没有作者确认时只能保存候选。',
    '信息不足时明确标记可修改假设，不从其他作品、其他用户或模型记忆补造事实。'
  ],
  inputSources: ['作者原始开书想法', '当前任务冻结版本', '当前节点允许的内部创作资产'],
  excludedSources: ['其他账号或其他书', '过期候选', '全库无差别全文', '模型思维链', '工程规则与测试清单'],
  outputContract: {},
  stopConditions: ['作者核心要求彼此冲突且无法安全推断', '必要输入缺失', '活动版本已经变化'],
  candidateBoundary: '所有AI产出均为候选；只有作者明确确认后，后续平台批次才能升级为正式开书资料。'
});

const ROLE_SKILLS: readonly V7AgentSkillDefinition[] = [
  skill({
    skillKey: 'role-chief-editor', kind: 'role', title: '开书主编',
    roleKey: 'chief_editor', nodeKey: null,
    responsibilities: [
      '审查资料包的原创性、商业方向、字段一致性和后续可设计性。',
      '核对哪些信息是作者硬要求、哪些是可修改设计，不能用内部模板覆盖作者原话。',
      '发现需要作者决定的真正分歧时停止代替作者做决定。'
    ],
    inputSources: ['共享核心Skill允许的来源', '当前编剧候选及其精确版本'],
    excludedSources: ['成员私有人设', '未绑定当前任务的历史输出'],
    outputContract: {},
    stopConditions: ['存在两个会改变作品根本方向且无法同时成立的选择'],
    candidateBoundary: '主编只能生成审查意见或修订候选，不能直接确认作者作品。'
  }),
  skill({
    skillKey: 'role-screenwriter', kind: 'role', title: '开书编剧',
    roleKey: 'screenwriter', nodeKey: null,
    responsibilities: [
      '直接理解作者冻结的开书原话，在明确边界内发挥创意。',
      '作者明确写出的主角、时代、地点与目标必须逐字保真，不能被历史名人或常见套路替换。',
      '生成彼此一致、具体可修改且能支撑后续设定与蓝图的开书资料包。',
      '不提前写完整分卷、事件或章节，不用模板名代替真实故事内容。',
      '需要偏离作者原话时明确提出，不静默修改作者硬要求。'
    ],
    inputSources: ['共享核心Skill允许的来源', '作者冻结的开书原话'],
    excludedSources: ['其他编剧未采用候选', '历史任务书', '无关方法和剧情模板'],
    outputContract: {},
    stopConditions: ['作者原话版本不一致', '作者明确要求彼此冲突且会形成两本不同的书'],
    candidateBoundary: '编剧只保存开书资料包候选，不能创建书籍、覆盖作者资料或写入正式事实。'
  })
] as const;

const NODE_SKILLS: readonly V7AgentSkillDefinition[] = [
  skill({
    skillKey: 'node-opening-package-design', kind: 'node', title: '设计开书资料包',
    roleKey: 'screenwriter', nodeKey: 'opening_package_design',
    responsibilities: [
      '按发布渠道设计具体、有核心看点的书名，并完整填写作品定位、背景、主角、长期方向与可修改终点。',
      '当前困境与开局剧情留给后续阶段，不得在开书资料中提前补写。',
      '让所有字段互相支持，信息颗粒足以帮助后续设定、蓝图和分卷。',
      '每个关键设计说明创作作用，使作者知道这本书将带来什么体验。'
    ],
    inputSources: ['作者原始开书想法', '当前平台分类目录', '最多六项按需命中的内部创作参考'],
    excludedSources: ['历史任务书', '其他成员失败输出', '其他书的名字、人物和剧情'],
    outputContract: {
      title: '清楚、有辨识度且与内容一致的暂定书名',
      positioning: '频道、分类、融合题材、核心看点和目标读者',
      backgrounds: '时代与世界背景；开局直接背景在当前阶段保持为空',
      protagonists: '一至两位主角的姓名、年龄、身份、经历、家庭、职业、特殊能力、稳定视觉特征与性格',
      opening: '当前阶段保持为空，由后续分卷与事件设计',
      longTermDirection: '全书持续矛盾、成长方向、关系方向和主要变化',
      possibleEnding: '可修改的终点方向与代价，不冒充确定正史',
      authorNotes: '作者最值得检查、修改或决定的少量问题',
      authorInstructions: '作者直接修改后附带的调整要求；没有则返回空数组，存在时必须保留并落实'
    },
    stopConditions: ['任务书版本已经变化', '硬要求无法在同一资料包中成立'],
    candidateBoundary: '资料包必须保存为可编辑候选，不能创建正式书籍。'
  }),
  skill({
    skillKey: 'node-opening-package-review', kind: 'node', title: '审查开书资料包',
    roleKey: 'chief_editor', nodeKey: 'opening_package_review',
    responsibilities: [
      '逐项核对作者原意、任务书责任、字段一致性和后续可用性。',
      '只提出会影响作品方向、逻辑或商业辨识度的必要修订。',
      '区分可自动修订的问题与必须交给作者决定的分歧。'
    ],
    inputSources: ['作者原始开书想法', '精确资料包候选版本'],
    excludedSources: ['历史任务书', '其他成员候选', '未保存的模型推断'],
    outputContract: {
      verdict: 'pass、revise或author_decision',
      summary: '作者能理解的一句话结论',
      issues: '带字段、证据、影响和必要修改动作的问题数组',
      requiredChanges: '允许编剧自动落实的修订动作数组',
      authorDecisions: '只有作者可以决定的问题数组'
    },
    stopConditions: ['候选版本不存在或不匹配', '作者原始想法无法读取'],
    candidateBoundary: '通过只代表主编审查通过，仍需作者确认才能成为正式开书资料。'
  })
] as const;

export const V7_AGENT_SKILLS: readonly V7AgentSkillDefinition[] = [CORE_SKILL, ...ROLE_SKILLS, ...NODE_SKILLS];

export function compileOpeningSkillBundle(
  roleKey: V7OpeningRoleKey,
  nodeKey: V7OpeningNodeKey
): CompiledOpeningSkillBundle {
  if (V7_NODE_ROLE_PERMISSIONS[nodeKey] !== roleKey) throw new Error(`${roleKey}不能执行节点${nodeKey}`);
  const roleSkill = ROLE_SKILLS.find((candidate) => candidate.roleKey === roleKey);
  const nodeSkill = NODE_SKILLS.find((candidate) => candidate.nodeKey === nodeKey);
  if (roleSkill === undefined || nodeSkill === undefined) throw new Error(`缺少${roleKey}/${nodeKey} Skill`);
  const selected = [CORE_SKILL, roleSkill, nodeSkill];
  return {
    roleKey,
    nodeKey,
    skillVersionIds: selected.map(skillVersionId),
    responsibilities: selected.flatMap((item) => item.responsibilities),
    inputSources: unique(selected.flatMap((item) => item.inputSources)),
    excludedSources: unique(selected.flatMap((item) => item.excludedSources)),
    outputContract: { ...nodeSkill.outputContract },
    stopConditions: unique(selected.flatMap((item) => item.stopConditions)),
    toolKeys: [...V7_NODE_TOOL_PERMISSIONS[nodeKey]],
    candidateBoundary: [CORE_SKILL.candidateBoundary, roleSkill.candidateBoundary, nodeSkill.candidateBoundary].join(' ')
  };
}

export function validateAgentSkillRegistry(): string[] {
  const errors: string[] = [];
  const keys = V7_AGENT_SKILLS.map((item) => item.skillKey);
  if (new Set(keys).size !== keys.length) errors.push('Skill键不能重复');
  if (V7_AGENT_SKILLS.filter((item) => item.kind === 'core').length !== 1) errors.push('必须且只能有一个开书核心Skill');
  for (const roleKey of ['chief_editor', 'screenwriter'] as const) {
    if (ROLE_SKILLS.filter((item) => item.roleKey === roleKey).length !== 1) errors.push(`${roleKey}必须且只能有一个岗位Skill`);
  }
  for (const nodeKey of Object.keys(V7_NODE_ROLE_PERMISSIONS) as V7OpeningNodeKey[]) {
    const nodeSkill = NODE_SKILLS.find((item) => item.nodeKey === nodeKey);
    if (nodeSkill === undefined) errors.push(`${nodeKey}缺少节点Skill`);
    else {
      if (nodeSkill.roleKey !== V7_NODE_ROLE_PERMISSIONS[nodeKey]) errors.push(`${nodeKey}岗位不匹配`);
      if (Object.keys(nodeSkill.outputContract).length === 0) errors.push(`${nodeKey}缺少输出合同`);
    }
  }
  for (const item of V7_AGENT_SKILLS) {
    if (!Number.isInteger(item.version) || item.version < 1) errors.push(`${item.skillKey}版本无效`);
    if (item.responsibilities.length === 0) errors.push(`${item.skillKey}没有责任说明`);
    if (item.candidateBoundary.trim().length === 0) errors.push(`${item.skillKey}没有候选边界`);
  }
  return errors;
}

export function skillVersionId(item: V7AgentSkillDefinition): string {
  return `${item.skillKey}@${item.version}`;
}

function skill(input: Omit<V7AgentSkillDefinition, 'version'>): V7AgentSkillDefinition {
  return { ...input, version: 1 };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
