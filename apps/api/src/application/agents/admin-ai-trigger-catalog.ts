import { creativeMemberContracts, type CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import type { ModelPurpose } from '../../infrastructure/models/model-runtime-config.js';

export interface AdminAiTriggerDefinition {
  triggerKey: string;
  surface: string;
  authorActions: string[];
  interventionTiming: string;
  taskPurpose: ModelPurpose;
  memberRoles: CreativeRoleKey[];
  contextPackages: string[];
  output: string;
}

/**
 * 后台可见的AI触发目录。triggerKey必须与真实tasks.task_type一致；作者按钮可以有多个，
 * 但平台提示词覆盖只绑定真实任务类型、岗位和阶段，不绑定易变化的前端文案。
 */
export const adminAiTriggerCatalog: readonly AdminAiTriggerDefinition[] = [
  trigger('discussion', '设定 / 灵感', ['召集成员讨论', '发送灵感问题'], '作者主动发起讨论时；不在建书后自动运行。', 'discussion',
    ['chief_editor', 'lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'setting'],
    ['开书信息', '已确认设定', '当前设定项或本轮问题', '绑定当前对象的作者原话'], '独立意见、可选方案或讨论结论'),
  trigger('volume_plan_generation', '分卷', ['开始设计本卷', '重新设计', '融合所选路线'], '设定基线确认且作者主动进入本卷设计后。', 'structured_planning',
    ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
    ['开书信息', '活动设定', '上一卷真实结算', '全书故事脊柱', '本卷作者原话', '内部结构方法软参考'], '两条具体卷路线或融合稿'),
  trigger('event_chain_generation', '规划', ['拆成事件链', '重新拆分事件'], '卷方向确认后，由作者请求把大故事拆成因果事件。', 'structured_planning',
    ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
    ['确认卷方向', '上一实际状态', '卷级承诺', '首卷强启动职责', '作者事件链原话'], '当前卷事件链'),
  trigger('story_event_generation', '规划', ['设计当前事件', '重做事件方案'], '作者选中当前事件并请求详细设计时。', 'structured_planning',
    ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
    ['确认卷方向', '完整事件链', '上一事件实际结果', '当前事件责任', '作者本事件原话'], '事件大纲候选'),
  trigger('event_chapter_sequence_generation', '章纲', ['生成完整章链'], '事件大纲确认后，先规划完整章序列。', 'structured_planning',
    ['lead_screenwriter'], ['确认事件大纲', '完整事件链', '近期实际状态', '事件总字数与章节范围'], '完整章链'),
  trigger('event_chapter_detail_generation', '章纲', ['细化本章', '细化近期章节'], '完整章链确认后，只细化最近需要写的章节。', 'structured_planning',
    ['lead_screenwriter'], ['确认章链', '当前章责任', '上一章实际结果', '相关人物与线程', '作者章纲原话'], '近期详细章纲'),
  trigger('event_chapter_sequence_challenge', '章纲', ['请另一位编剧挑战章链'], '作者认为当前章链过于常规或存在风险时主动触发。', 'structured_planning',
    ['second_screenwriter'], ['当前章链', '事件大纲', '挑战目标', '禁止改动的确认内容'], '最多三条结构替代建议'),
  trigger('event_chapter_detail_challenge', '章纲', ['请另一位编剧挑战本章'], '作者需要另一种场景组织或风险检查时主动触发。', 'structured_planning',
    ['second_screenwriter'], ['当前详细章纲', '章链责任', '上一实际状态', '挑战目标'], '本章替代建议'),
  trigger('chapter_creation', '正文', ['生成本章正文', '定点重写'], '详细章纲确认且作者主动开始写作后；一次只写一章。', 'novel_writer',
    ['lead_writer', 'fact_reviewer', 'literary_reviewer', 'experience_reviewer'],
    ['写作工单', '详细章纲', '最近实际状态', '正式设定与相关事实', '人物声音', '活动线程'], '正文草稿、三席独立审查与定点修订'),
  trigger('chapter_challenger_review', '正文', ['请挑剔读者复核'], '正文已生成且作者主动要求额外复核时。', 'novel_reviewer',
    ['experience_challenger'], ['完整正文', '目标读者', '详细章纲', '上一实际状态'], '弃读风险与毒点报告'),
  trigger('book_branding_design', '信息', ['主编设计书名', '主编设计简介'], '第一卷方向确认后，作者主动请求品牌文案。', 'structured_planning',
    ['chief_editor'], ['开书信息', '活动设定', '第一卷确认方向'], '书名或简介候选'),
  trigger('settlement_follow_up', '结算', ['根据结算调整后续'], '章节、事件或卷结算后发现计划与实际偏差，作者主动请求校准。', 'structured_planning',
    ['chief_editor'], ['正式结算', '活动规划', '开放线程', '受影响的下游对象'], '保留、修订或重做建议'),
  trigger('continuation_analysis', '已有正文', ['分析已有正文'], '作者导入并确认不可变原文后主动开始分析。', 'structured_planning',
    ['chief_editor', 'setting', 'lead_screenwriter'], ['不可变导入正文', '章节顺序', '作者续写目标'], '可追溯设定、人物与反向规划候选')
] as const;

export const adminAiMembers = creativeMemberContracts.map((member) => ({
  roleKey: member.roleKey,
  memberName: member.memberName,
  shortTitle: member.shortTitle
}));

function trigger(
  triggerKey: string,
  surface: string,
  authorActions: string[],
  interventionTiming: string,
  taskPurpose: ModelPurpose,
  memberRoles: CreativeRoleKey[],
  contextPackages: string[],
  output: string
): AdminAiTriggerDefinition {
  return { triggerKey, surface, authorActions, interventionTiming, taskPurpose, memberRoles, contextPackages, output };
}
