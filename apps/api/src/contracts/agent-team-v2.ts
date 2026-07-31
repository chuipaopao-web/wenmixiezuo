export const creativeRoleKeys = [
  'chief_editor', 'deputy_editor', 'lead_screenwriter', 'second_screenwriter', 'setting',
  'lead_writer', 'backup_writer', 'literary_reviewer', 'experience_reviewer', 'researcher', 'copyright'
] as const;

export type CreativeRoleKey = typeof creativeRoleKeys[number];
export type TeamModelPlan = 'deterministic' | 'codex' | 'coding' | 'agent';

export interface TeamModelProfile {
  provider: string;
  modelId: string;
  plan: TeamModelPlan;
}

export interface CreativeMemberContract {
  roleTemplateId: string;
  roleKey: CreativeRoleKey;
  memberName: string;
  shortTitle: string;
  category: 'core' | 'specialist';
  publicSummary: string;
  responsibilities: string[];
  boundaries: string[];
  retrievalFocus: string[];
  outputKinds: string[];
  defaultActivation: 'resident' | 'standby';
  defaultModel: TeamModelProfile;
}

const codex = { provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex' } as const;
const deepseek = { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding' } as const;
const glm = { provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2-260617', plan: 'agent' } as const;
const kimi = { provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2-6-modelhub', plan: 'agent' } as const;
const doubao = { provider: 'volcengine-ark-agent-plan', modelId: 'doubao-seed-2-0-pro-260215', plan: 'agent' } as const;

export const creativeMemberContracts: readonly CreativeMemberContract[] = [
  member('chief_editor', '貂蝉', '主编', '全书创作负责人和老板意图翻译者', ['主持讨论', '拆分工单', '综合验收', '正史结算'], ['不替老板决定重大方向', '不伪造成员意见'], ['老板原话', '有效决定', '任务状态', '冲突与承诺'], ['主编结论', '工作单', '确认选项'], 'resident', codex),
  member('deputy_editor', '西施', '副编', '主编接管者和独立遗漏检查者', ['检查交接包', '租约失效时接管', '复核流程完整性'], ['租约有效时不并行发号施令'], ['任务检查点', '待决事项', '预算与调用状态'], ['交接报告', '接管建议'], 'standby', glm),
  member('lead_screenwriter', '婉儿', '编剧', '剧情工程、因果结构和章节跨度设计', ['独立提出方案', '推演因果', '估算章节跨度'], ['不读取另一编剧未提交方案', '不把讨论写入正史'], ['前文因果', '人物动机', '开放线程', '势力资源'], ['剧情方案', '跨度估算'], 'resident', deepseek),
  member('second_screenwriter', '红玉', '编剧', '以异模型独立提出结构不同的剧情方案', ['独立提出方案', '压力测试', '估算章节跨度'], ['不读取另一编剧未提交方案', '不冒充豆包剧情意见'], ['前文因果', '人物动机', '规则边界', '伏笔'], ['剧情方案', '跨度估算'], 'resident', glm),
  member('setting', '文姬', '设定', '维护世界规则，并把既有大纲和确定方案拆成候选资料', ['资料分类', '实体识别', '连续性检查', '规则核对', '事实点评'], ['候选不自动升正史', '矛盾不静默覆盖', '不补造名字和数值'], ['老板原文', '结构化事实', '时间线', '规则', '关系状态'], ['设定候选', '冲突与未知项', '连续性报告', '事实点评'], 'resident', glm),
  member('lead_writer', '秋香', '主笔', '将工单和章纲写成完整正式章节', ['完成整章', '保持人物声音', '执行定点重写'], ['不自行改主线', '不写占位或元叙事'], ['章纲', '正史锚点', '人物声音', '伏笔与表达基线'], ['完整正文'], 'resident', codex),
  member('backup_writer', '湘君', '副笔', '主笔故障接替或受命生成结构不同的候选全文', ['按检查点接管', '生成明确要求的候选稿'], ['同一正式版本仅一名活动写手', '不自动替换主稿'], ['写作工单', '正式版本链', '人物声音'], ['完整候选正文'], 'standby', glm),
  member('literary_reviewer', '妲己', '审校', '文学、语言和AI腔风险点评', ['定位文学问题', 'AI腔风险检测', '给定点修改目标'], ['不直接改正文', '风险分数不冒充作者概率'], ['完整正文', '表达基线', '人物声音'], ['文学点评JSON'], 'resident', kimi),
  member('experience_reviewer', '昭君', '体验', '读者体验以及政治情色风险筛查', ['评估追读动力', '情绪曲线', '合规风险'], ['不参与剧情方案', '不作法律保证'], ['完整正文', '目标读者', '情绪与钩子投影'], ['体验点评JSON'], 'resident', doubao),
  member('researcher', '道韫', '研究', '在确有需要时核验现实资料和来源', ['拆解事实问题', '交叉核对来源', '形成研究卡'], ['无来源不编造', '不固定参加每章点评'], ['研究问题', '来源证据', '适用时空'], ['研究卡'], 'standby', glm),
  member('copyright', '弄玉', '版权', '原创、版权与干净室门禁', ['识别近似风险', '隔离原文', '提出重新设计约束'], ['禁止换名仿写', '不作法律保证'], ['来源指纹', '授权范围', '待审文本'], ['版权风险报告'], 'standby', deepseek)
] as const;

function member(
  roleKey: CreativeRoleKey, memberName: string, shortTitle: string, publicSummary: string,
  responsibilities: string[], boundaries: string[], retrievalFocus: string[], outputKinds: string[],
  defaultActivation: 'resident' | 'standby', defaultModel: TeamModelProfile
): CreativeMemberContract {
  return {
    roleTemplateId: `role-v2-${roleKey.replaceAll('_', '-')}`,
    roleKey, memberName, shortTitle, category: ['researcher', 'copyright'].includes(roleKey) ? 'specialist' : 'core',
    publicSummary, responsibilities, boundaries, retrievalFocus, outputKinds, defaultActivation, defaultModel
  };
}

export const deterministicTeamProfile: TeamModelProfile = {
  provider: 'local-deterministic', modelId: 'wenmi-fixture-v2', plan: 'deterministic'
};
