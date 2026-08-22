import { hashStableContractContent, type EditorialRoleKey } from '@wenmi/contracts';

export interface AgentSkillSnapshot {
  skillVersionId: string;
  layer: 'core' | 'role' | 'node_protocol';
  roleKey: EditorialRoleKey | null;
  nodeKind: string | null;
  version: number;
  content: Record<string, unknown>;
  contentHash: string;
}

const CORE = {
  name: '文秘创作通用核心 Skill',
  rules: [
    '只读取本次冻结 ContextPack；不得从私人记忆补造全书事实。',
    '严格区分正式事实、作者要求、未来计划与正文实际；未确认候选不得冒充事实。',
    '保留来源 ID 与版本；不得跨 owner_id 或 book_id 使用材料。',
    '不得输出或保存思维链，只返回结论、可核对依据和简短取舍说明。',
    '只完成当前节点协议要求的深度，达到边界立即停止，不提前设计下游。'
  ],
  resultDisclosure: ['已保留', '已专业调整', '未采用及简因']
};

const ROLES: Record<EditorialRoleKey, Record<string, unknown>> = {
  chief_editor: { responsibility: '处理跨层级、全书、多线和正式里程碑整理或审核。', boundary: '必须由作者主动发起汇总；不得替作者确认。' },
  deputy_editor: { responsibility: '整理、融合和校正当前局部对象。', boundary: '不得改动全局故事架构、已确认分卷方向和正式事实。' },
  screenwriter: { responsibility: '独立完成设定、故事线、分卷、事件和角色创意候选。', boundary: '不读取同批其他编剧答案，不把候选写入实际总账。' },
  writer: { responsibility: '独立完成表达方案、章纲或完整正文候选。', boundary: '不自行改动已确认结构；候选保持完整，不自动拼接。' },
  fact_reviewer: { responsibility: '只做事实、设定、时间、因果和来源核对。', boundary: '不做文学评价，不直接改正文。' },
  literary_reviewer: { responsibility: '只做语言、人物声音、节奏和模板化表达审查。', boundary: '不冒充事实席或体验席，不直接改正文。' },
  experience_reviewer: { responsibility: '只做目标读者理解、情绪兑现、追读与风险体验审查。', boundary: '不冒充事实席或文学席，不参与剧情定稿。' }
};

export function coreAgentSkill(): AgentSkillSnapshot {
  return snapshot('skill-v6-core-1', 'core', null, null, CORE);
}

export function roleAgentSkill(roleKey: EditorialRoleKey): AgentSkillSnapshot {
  return snapshot(`skill-v6-role-${roleKey}-1`, 'role', roleKey, null, {
    roleKey, ...ROLES[roleKey], outputContract: {
      content: '当前节点结构化候选或独立报告',
      authorSummary: { preserved: 'string[]', adjusted: 'string[]', omitted: '{item,reason}[]' },
      forbidden: ['thought_chain', 'private_memory', 'cross_book_source']
    }
  });
}

export function nodeProtocolSkill(nodeKind: string, roleKey: EditorialRoleKey): AgentSkillSnapshot {
  const normalized = nodeKind.trim();
  if (normalized.length === 0) throw new Error('节点类型不能为空');
  return snapshot(`skill-v6-node-${safeKey(normalized)}-${roleKey}-1`, 'node_protocol', roleKey, normalized, {
    nodeKind: normalized,
    roleKey,
    steps: ['复述当前任务边界', '仅从冻结资料包形成独立结果', '按节点输出合同自检', '返回作者可见简短取舍说明'],
    stopCondition: '当前节点字段已完整、来源可追溯且未提前设计下游。'
  });
}

export function allRoleSkills(): AgentSkillSnapshot[] {
  return (Object.keys(ROLES) as EditorialRoleKey[]).map(roleAgentSkill);
}

function snapshot(skillVersionId: string, layer: AgentSkillSnapshot['layer'], roleKey: EditorialRoleKey | null,
  nodeKind: string | null, content: Record<string, unknown>): AgentSkillSnapshot {
  return {
    skillVersionId, layer, roleKey, nodeKind, version: 1, content,
    contentHash: hashStableContractContent(content).slice('sha256:'.length)
  };
}

function safeKey(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64) || 'node';
}
