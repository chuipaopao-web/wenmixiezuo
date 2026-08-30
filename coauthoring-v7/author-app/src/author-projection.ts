const TECHNICAL_COPY = /(?:\b(?:api|http|model|provider|prompt|temperature|token|stack|trace|exception|request|response|skill)\b|coding\s*plan|agent\s*plan|context\s*pack|contextpack|prompt\s*manifest|promptmanifest|task\s*contract|taskcontract|上下文包|任务合同|模型|供应商|提示词|温度|扣用量|调用|接口|哈希|堆栈|异常|状态码|deep\s*seek(?:\s*v?[\d.]+)?|glm(?:\s*-?\s*[\d.]+)?|kimi(?:\s*-?\s*(?:k?\d+(?:\.\d+)?))?|minimax(?:\s*-?\s*m?\d+)?|豆包|seedream)/iu;
const INTERNAL_ROLE_COPY = /(?:chief_editor|deputy_editor|context_editor|structure_deputy|commercial_deputy|planning_writer|outline_writer|structure_writer|commercial_writer|character_writer|lead_writer|independent_reviewer|continuity_editor|settlement_editor|planning_maintainer|visual_renderer)/iu;

const LEGACY_MEMBER_IDENTITIES: Readonly<Record<string, string>> = {
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
  'creation-writer-deepseek-v4-pro': 'writer-deepseek-v4-pro',
  'creation-writer-deepseek-v4-flash': 'writer-deepseek-v4-flash',
  'creation-writer-glm-5-3': 'writer-glm-5-3',
  'creation-writer-kimi-k3': 'writer-kimi-k3',
  'creation-writer-kimi-k2-7': 'writer-kimi-2-7',
  'creation-writer-doubao': 'writer-doubao',
  'creation-review-glm-5-3': 'review-glm-5-3',
  'creation-review-deepseek-v4-pro': 'review-deepseek-v4-pro',
  'creation-review-kimi-k3': 'review-kimi-k3',
  'creation-settlement-deepseek-v4-pro': 'continuity-deepseek-v4-pro',
  'creation-settlement-glm-5-3': 'continuity-glm-5-3',
  'creation-settlement-kimi-k3': 'continuity-kimi-k3',
  'continuity-deepseek-v4-flash': 'continuity-deepseek-v4-pro',
  'continuity-kimi-2-7': 'continuity-kimi-k3',
  'visual-huizhen': 'visual-seedream'
};

const PUBLIC_ROLE_BY_KEY: Readonly<Record<string, string>> = {
  chief_editor: '主编',
  deputy_editor: '副编',
  context_editor: '副编',
  structure_deputy: '副编',
  commercial_deputy: '副编',
  planning_writer: '策划编剧',
  outline_writer: '策划编剧',
  structure_writer: '策划编剧',
  commercial_writer: '策划编剧',
  character_writer: '策划编剧',
  lead_writer: '主笔',
  independent_reviewer: '独立审查',
  continuity_editor: '记录编辑',
  settlement_editor: '记录编辑',
  planning_maintainer: '记录编辑',
  visual_renderer: '视觉编剧'
};

export type PublicRoleKey =
  | 'chief_editor'
  | 'deputy_editor'
  | 'planning_writer'
  | 'lead_writer'
  | 'independent_reviewer'
  | 'continuity_editor'
  | 'visual_renderer';

const PUBLIC_ROLE_KEY_BY_ALIAS: Readonly<Record<string, PublicRoleKey>> = {
  chief_editor: 'chief_editor',
  deputy_editor: 'deputy_editor',
  context_editor: 'deputy_editor',
  structure_deputy: 'deputy_editor',
  commercial_deputy: 'deputy_editor',
  planning_writer: 'planning_writer',
  outline_writer: 'planning_writer',
  structure_writer: 'planning_writer',
  commercial_writer: 'planning_writer',
  character_writer: 'planning_writer',
  lead_writer: 'lead_writer',
  independent_reviewer: 'independent_reviewer',
  continuity_editor: 'continuity_editor',
  settlement_editor: 'continuity_editor',
  planning_maintainer: 'continuity_editor',
  visual_renderer: 'visual_renderer'
};

export function canonicalMemberIdentityKey(memberKey: string): string {
  const key = memberKey.trim();
  return LEGACY_MEMBER_IDENTITIES[key] ?? key;
}

export function uniqueByMemberKey<T extends { memberKey: string }>(members: readonly T[]): T[] {
  const orderedKeys: string[] = [];
  const selected = new Map<string, T>();
  for (const member of members) {
    const key = canonicalMemberIdentityKey(member.memberKey);
    if (key.length === 0) continue;
    const previous = selected.get(key);
    if (previous === undefined) {
      orderedKeys.push(key);
      selected.set(key, normalizeMemberKey(member, key));
      continue;
    }
    if (memberSnapshotPriority(member) > memberSnapshotPriority(previous)) {
      selected.set(key, normalizeMemberKey(member, key));
    }
  }
  return orderedKeys.flatMap((key) => {
    const member = selected.get(key);
    return member === undefined ? [] : [member];
  });
}

export function publicRoleKey(role: string | null | undefined, roleKey?: string | null): PublicRoleKey {
  const explicit = roleKey?.replace(/\s+/gu, '').trim() ?? '';
  if (PUBLIC_ROLE_KEY_BY_ALIAS[explicit] !== undefined) return PUBLIC_ROLE_KEY_BY_ALIAS[explicit];
  const normalized = role?.replace(/\s+/gu, '').trim() ?? '';
  if (PUBLIC_ROLE_KEY_BY_ALIAS[normalized] !== undefined) return PUBLIC_ROLE_KEY_BY_ALIAS[normalized];
  if (/主编/u.test(normalized)) return 'chief_editor';
  if (/副编|资料编审/u.test(normalized)) return 'deputy_editor';
  if (/封面|画师|视觉/u.test(normalized)) return 'visual_renderer';
  if (/审查|审校|复核/u.test(normalized)) return 'independent_reviewer';
  if (/记录|结算|维护/u.test(normalized)) return 'continuity_editor';
  if (/主笔|正文/u.test(normalized)) return 'lead_writer';
  return 'planning_writer';
}

export function publicRoleLabel(role: string | null | undefined, roleKey?: string | null): string {
  return PUBLIC_ROLE_BY_KEY[publicRoleKey(role, roleKey)] ?? '策划编剧';
}

function normalizeMemberKey<T extends { memberKey: string }>(member: T, memberKey: string): T {
  return member.memberKey === memberKey ? member : { ...member, memberKey };
}

function memberSnapshotPriority(member: { memberKey: string }): number {
  const value = member as Record<string, unknown>;
  const presence = typeof value.presence === 'string' ? value.presence : '';
  const status = typeof value.status === 'string' ? value.status : '';
  const currentWork = typeof value.currentWork === 'string' ? value.currentWork.trim() : '';
  const currentItem = typeof value.currentItem === 'string' ? value.currentItem.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  const hasConcreteWork = currentWork.length > 0 || currentItem.length > 0 || message.length > 0;
  let priority = 0;
  if ((presence === 'working' && (currentWork.length > 0 || currentItem.length > 0)) || (status === 'working' && hasConcreteWork)) priority = 50;
  else if (status === 'failed') priority = 40;
  else if (status === 'completed' || status === 'handed_over') priority = 30;
  else if (presence === 'leave') priority = 25;
  else if (status === 'waiting') priority = 20;
  else if (presence === 'ready') priority = 10;
  if (member.memberKey === canonicalMemberIdentityKey(member.memberKey)) priority += 1;
  return priority;
}

export function publicStatusCopy(message: string | null | undefined, fallback: string): string {
  const normalized = message?.replace(/\s+/gu, ' ').trim() ?? '';
  if (normalized.length === 0 || TECHNICAL_COPY.test(normalized) || INTERNAL_ROLE_COPY.test(normalized)) return fallback;
  return normalized
    .replace(/封面画师/gu, '视觉编剧')
    .replace(/审查编辑/gu, '独立审查')
    .replace(/结算编辑|维护编辑/gu, '记录编辑')
    .replace(/上下文编辑/gu, '副编');
}

export function publicFailureCopy(message?: string | null): string {
  const safe = publicStatusCopy(message, '');
  if (/^(?:对不起|抱歉)/u.test(safe)) return safe;
  if (safe.length > 0) return `对不起，这次没有完成。${safe}`;
  return '对不起，这次没有完成。已经完成的内容会保留，您可以重新尝试。';
}
