import type {
  V7OpeningMemberDefinition,
  V7SettingMemberDefinition
} from '@wenmi/v7-backend';

const providers = new Set(['volcengine-ark-coding-plan', 'volcengine-ark-agent-plan']);
const plans = new Set(['coding', 'agent']);
const settingRoles = new Set(['chief_editor', 'deputy_editor', 'screenwriter']);

/**
 * A setting batch may execute only while its complete frozen roster still
 * resolves to the current V7 members and concrete model bindings. Historical
 * or damaged snapshots remain readable from their stored rows, but must never
 * fall back to today's roster or silently rebind an old task to another model.
 */
export function resolveSettingTaskRoster(
  snapshotJson: string,
  currentRoster: readonly V7SettingMemberDefinition[]
): V7SettingMemberDefinition[] {
  const snapshot = parseJsonArray(snapshotJson);
  const parsed = snapshot?.map(parseSettingMember).filter(isDefined) ?? [];
  const structurallyComplete = snapshot !== null
    && parsed.length === snapshot.length
    && uniqueMemberKeys(parsed)
    && parsed.some((member) => member.roleKey === 'chief_editor')
    && parsed.some((member) => member.roleKey === 'deputy_editor')
    && parsed.some((member) => member.roleKey === 'screenwriter');
  if (!structurallyComplete) throw new Error('设定任务冻结名册不完整');
  if (!sameCurrentSettingRoster(parsed, currentRoster)) {
    throw new Error('设定任务冻结名册已退役或模型绑定已经变化');
  }
  return cloneSettingRoster(parsed);
}

/** Read a recommendation task's frozen chief for historical display only. */
export function readOpeningChiefTaskSnapshot(snapshotJson: string): V7OpeningMemberDefinition[] {
  const snapshot = parseJsonArray(snapshotJson);
  if (snapshot === null) throw new Error('设定清单主编快照无效');
  const members = snapshot.map(parseOpeningChief).filter(isDefined);
  if (members.length !== snapshot.length || members.length !== 1 || !uniqueMemberKeys(members)) {
    throw new Error('设定清单主编快照成员无效');
  }
  return members;
}

/** Resolve the frozen chief only when the exact current V7 binding still exists. */
export function resolveOpeningChiefTaskSnapshot(
  snapshotJson: string,
  currentRoster: readonly V7OpeningMemberDefinition[]
): V7OpeningMemberDefinition[] {
  const members = readOpeningChiefTaskSnapshot(snapshotJson);
  const frozen = members[0]!;
  const current = currentRoster.find((member) => member.memberKey === frozen.memberKey);
  if (current === undefined
    || current.roleKey !== frozen.roleKey
    || modelSignature(current.model) !== modelSignature(frozen.model)) {
    throw new Error('设定清单主编已经退役或模型绑定已经变化');
  }
  return members;
}

function parseSettingMember(value: unknown, index: number): V7SettingMemberDefinition | undefined {
  const row = record(value);
  const memberKey = text(row?.memberKey);
  const displayName = text(row?.displayName);
  const roleKey = text(row?.roleKey);
  const model = modelBinding(row?.model);
  if (!memberKey || !displayName || !roleKey || !settingRoles.has(roleKey) || model === undefined) return undefined;
  return {
    memberKey,
    displayName,
    roleKey: roleKey as V7SettingMemberDefinition['roleKey'],
    publicResponsibility: text(row?.publicResponsibility) ?? '',
    // The member was available when this task snapshot was committed.  A later
    // leave/offboarding flag must not rewrite the historical assignment.
    enabledByDefault: true,
    fallbackPriority: positiveInteger(row?.fallbackPriority) ?? index + 1,
    model
  };
}

function parseOpeningChief(value: unknown, index: number): V7OpeningMemberDefinition | undefined {
  const row = record(value);
  const memberKey = text(row?.memberKey);
  const displayName = text(row?.displayName);
  const model = modelBinding(row?.model);
  if (!memberKey || !displayName || row?.roleKey !== 'chief_editor' || model === undefined) return undefined;
  return {
    memberKey,
    displayName,
    roleKey: 'chief_editor',
    enabledByDefault: true,
    defaultForRole: typeof row.defaultForRole === 'boolean' ? row.defaultForRole : index === 0,
    fallbackPriority: positiveInteger(row.fallbackPriority) ?? index + 1,
    model,
    promptInstruction: typeof row.promptInstruction === 'string' ? row.promptInstruction.slice(0, 4_000) : ''
  };
}

function modelBinding(value: unknown): V7SettingMemberDefinition['model'] | undefined {
  const row = record(value);
  const provider = text(row?.provider);
  const modelId = text(row?.modelId);
  const plan = text(row?.plan);
  if (!provider || !providers.has(provider) || !modelId || !plan || !plans.has(plan)) return undefined;
  if ((plan === 'coding') !== (provider === 'volcengine-ark-coding-plan')) return undefined;
  return {
    provider: provider as V7SettingMemberDefinition['model']['provider'],
    modelId,
    plan: plan as V7SettingMemberDefinition['model']['plan']
  };
}

function cloneSettingRoster(roster: readonly V7SettingMemberDefinition[]): V7SettingMemberDefinition[] {
  return roster.map((member) => ({ ...member, model: { ...member.model } }));
}

function sameCurrentSettingRoster(
  frozen: readonly V7SettingMemberDefinition[],
  current: readonly V7SettingMemberDefinition[]
): boolean {
  if (frozen.length !== current.length || !uniqueMemberKeys(current)) return false;
  return frozen.every((member) => {
    const match = current.find((candidate) => candidate.memberKey === member.memberKey);
    return match !== undefined
      && match.roleKey === member.roleKey
      && modelSignature(match.model) === modelSignature(member.model);
  });
}

function modelSignature(model: Readonly<{ provider: string; modelId: string; plan: string }>): string {
  return `${model.provider}:${model.modelId}:${model.plan}`;
}

function parseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function uniqueMemberKeys(members: readonly { memberKey: string }[]): boolean {
  return new Set(members.map((member) => member.memberKey)).size === members.length;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
