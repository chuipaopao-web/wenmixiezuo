import type { PlanningActualState, PlanningTreeKind } from './planning-tree-contracts.js';

export interface V7PlanningMaintenanceActualDraft {
  treeKind: PlanningTreeKind;
  scopeId: string;
  nodeKey: string;
  state: PlanningActualState;
  summary: string;
  emotionResult: string;
  experienceResult: string;
  outcome: string;
}

export interface V7PlanningAdjustmentDraft {
  treeKind: PlanningTreeKind;
  scopeId: string;
  nodeKey: string;
  publicSummary: string;
  reason: string;
  proposedChange: string;
}

export interface V7PlanningMaintenanceOutput {
  schema: 'v7-planning-maintenance-v1';
  publicSummary: string;
  actuals: V7PlanningMaintenanceActualDraft[];
  suggestions: V7PlanningAdjustmentDraft[];
}

export function parsePlanningMaintenanceOutput(output: string): V7PlanningMaintenanceOutput {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('规划维护员没有返回完整结果');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
  if (value.schema !== 'v7-planning-maintenance-v1') throw new Error('规划维护结果版本不受支持');
  const actuals = list(value.actuals, '实际进展').map((item) => actualDraft(item));
  const suggestions = list(value.suggestions, '调整建议', true).map((item) => suggestionDraft(item));
  if (actuals.length === 0 && suggestions.length === 0) throw new Error('规划维护员没有提取到实际进展或建议');
  return {
    schema: 'v7-planning-maintenance-v1',
    publicSummary: text(value.publicSummary, '维护说明', 1, 1_000),
    actuals,
    suggestions
  };
}

export function planningMaintenancePrompt(input: {
  settlement: unknown;
  confirmedTrees: unknown;
}): string {
  return [
    '你是文秘写作V7规划维护员。只返回一个JSON对象，不要Markdown，不要思维过程。',
    '本次输入全部来自已验证的正式结算。请把已经发生的事实映射到最相关的已确认规划节点，并判断未来方向是否需要调整。',
    '实际进展只能来自结算，不得把规划、推断或未发生内容写成实际。不要改写正文，不要修改确认树。',
    '同一事实只映射到真正需要更新的节点；可以跨全书、单卷、单元链更新，但不能为了填满层级而重复抄写。',
    '偏离时只给未来调整建议；没有偏离就返回空suggestions。证据编号、来源版本和记录时间由系统补齐，不要自行编造。',
    '输出字段：schema="v7-planning-maintenance-v1",publicSummary,actuals,suggestions。',
    'actuals每项字段：treeKind,scopeId,nodeKey,state(partial|completed|deviated),summary,emotionResult,experienceResult,outcome。',
    'suggestions每项字段：treeKind,scopeId,nodeKey,publicSummary,reason,proposedChange。',
    `正式结算：${JSON.stringify(input.settlement)}`,
    `当前已确认规划树：${JSON.stringify(input.confirmedTrees)}`
  ].join('\n\n');
}

function actualDraft(value: Record<string, unknown>): V7PlanningMaintenanceActualDraft {
  const state = value.state;
  if (state !== 'partial' && state !== 'completed' && state !== 'deviated') throw new Error('实际进展状态无效');
  return {
    treeKind: treeKind(value.treeKind), scopeId: key(value.scopeId, '规划范围'), nodeKey: key(value.nodeKey, '规划节点'),
    state, summary: text(value.summary, '实际进展', 1, 2_000),
    emotionResult: text(value.emotionResult, '情绪结果', 1, 1_000),
    experienceResult: text(value.experienceResult, '阅读体验结果', 1, 1_000),
    outcome: text(value.outcome, '实际结果', 1, 2_000)
  };
}

function suggestionDraft(value: Record<string, unknown>): V7PlanningAdjustmentDraft {
  return {
    treeKind: treeKind(value.treeKind), scopeId: key(value.scopeId, '规划范围'), nodeKey: key(value.nodeKey, '规划节点'),
    publicSummary: text(value.publicSummary, '建议说明', 1, 1_000),
    reason: text(value.reason, '建议原因', 1, 2_000),
    proposedChange: text(value.proposedChange, '建议调整', 1, 2_000)
  };
}

function list(value: unknown, label: string, allowEmpty = false): Record<string, unknown>[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label}必须是${allowEmpty ? '' : '非空'}数组`);
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${label}格式无效`);
    return item as Record<string, unknown>;
  });
}

function treeKind(value: unknown): PlanningTreeKind {
  if (value === 'book' || value === 'volume' || value === 'chain') return value;
  throw new Error('规划树类型无效');
}

function key(value: unknown, label: string): string {
  const result = text(value, label, 1, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(result)) throw new Error(`${label}无效`);
  return result;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}无效`);
  const result = value.trim();
  const length = Array.from(result).length;
  if (length < min || length > max) throw new Error(`${label}无效`);
  return result;
}
