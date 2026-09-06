import type { V7OpeningRoleKey } from './agent-roster.js';

export type V7OpeningNodeKey = 'opening_package_design' | 'opening_package_review';
export type V7AgentToolKey =
  | 'read_opening_idea'
  | 'search_narrative_methods'
  | 'search_plot_patterns'
  | 'read_opening_candidate'
  | 'save_opening_candidate'
  | 'update_opening_task_progress';

export interface V7AgentToolDefinition {
  toolKey: V7AgentToolKey;
  access: 'read' | 'search' | 'write';
  authority: 'author_source' | 'internal_reference' | 'candidate' | 'runtime';
  purpose: string;
  resultBoundary: string;
}

export const V7_AGENT_TOOLS: readonly V7AgentToolDefinition[] = [
  tool('read_opening_idea', 'read', 'author_source',
    '读取当前账号本次开书任务中作者保存的原始想法。',
    '只返回当前任务冻结版本；不得改写、摘要替代或读取其他账号。'),
  tool('search_narrative_methods', 'search', 'internal_reference',
    '按当前问题查询少量叙事方法责任。',
    '只返回命中的职责与风险，不返回整库，也不把方法当作者硬要求。'),
  tool('search_plot_patterns', 'search', 'internal_reference',
    '按题材、冲突或目标查询少量剧情模式与配方。',
    '只作为候选参考，不复制模板成固定剧情，不读取其他书。'),
  tool('read_opening_candidate', 'read', 'candidate',
    '读取当前任务已经保存的任务书、资料包或审查候选。',
    '必须绑定当前任务、候选类型和版本；候选不是正式开书资料。'),
  tool('save_opening_candidate', 'write', 'candidate',
    '保存当前成员产生的结构化候选及来源版本。',
    '只能追加候选版本，不能创建正式书籍或覆盖作者确认内容。'),
  tool('update_opening_task_progress', 'write', 'runtime',
    '写入真实阶段、检查点和可恢复状态。',
    '只记录已发生状态，不伪造百分比、不保存思维链。')
] as const;

export const V7_NODE_TOOL_PERMISSIONS: Readonly<Record<V7OpeningNodeKey, readonly V7AgentToolKey[]>> = {
  opening_package_design: [
    'read_opening_idea', 'search_narrative_methods', 'search_plot_patterns',
    'read_opening_candidate', 'save_opening_candidate', 'update_opening_task_progress'
  ],
  opening_package_review: [
    'read_opening_idea', 'read_opening_candidate', 'save_opening_candidate',
    'update_opening_task_progress'
  ]
};

export const V7_NODE_ROLE_PERMISSIONS: Readonly<Record<V7OpeningNodeKey, V7OpeningRoleKey>> = {
  opening_package_design: 'screenwriter',
  opening_package_review: 'chief_editor'
};

export function assertOpeningToolAuthorized(
  roleKey: V7OpeningRoleKey,
  nodeKey: V7OpeningNodeKey,
  toolKey: V7AgentToolKey
): void {
  if (V7_NODE_ROLE_PERMISSIONS[nodeKey] !== roleKey) {
    throw new Error(`${roleKey}不能执行节点${nodeKey}`);
  }
  if (!V7_NODE_TOOL_PERMISSIONS[nodeKey].includes(toolKey)) {
    throw new Error(`节点${nodeKey}无权调用工具${toolKey}`);
  }
}

export function validateAgentToolRegistry(): string[] {
  const errors: string[] = [];
  const toolKeys = V7_AGENT_TOOLS.map((item) => item.toolKey);
  if (new Set(toolKeys).size !== toolKeys.length) errors.push('Agent工具键不能重复');
  const known = new Set(toolKeys);
  for (const [nodeKey, permissions] of Object.entries(V7_NODE_TOOL_PERMISSIONS)) {
    if (permissions.length === 0) errors.push(`${nodeKey}没有工具权限`);
    if (new Set(permissions).size !== permissions.length) errors.push(`${nodeKey}工具权限重复`);
    for (const toolKey of permissions) {
      if (!known.has(toolKey)) errors.push(`${nodeKey}引用了不存在的工具：${toolKey}`);
    }
  }
  return errors;
}

function tool(
  toolKey: V7AgentToolKey,
  access: V7AgentToolDefinition['access'],
  authority: V7AgentToolDefinition['authority'],
  purpose: string,
  resultBoundary: string
): V7AgentToolDefinition {
  return { toolKey, access, authority, purpose, resultBoundary };
}
