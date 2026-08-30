import type {
  V7OpeningMemberDefinition,
  V7SettingMemberDefinition
} from '@wenmi/v7-backend';

const providers = new Set(['volcengine-ark-coding-plan', 'volcengine-ark-agent-plan']);
const plans = new Set(['coding', 'agent']);
const settingRoles = new Set(['chief_editor', 'deputy_editor', 'screenwriter']);

/**
 * A setting batch owns the roster captured when the batch was created.  Runtime
 * roster changes are intentionally ignored while that batch is being resumed.
 * The current roster is only a corruption fallback for pre-contract rows whose
 * snapshot cannot be read at all.
 */
export function resolveSettingTaskRoster(
  snapshotJson: string,
  currentRoster: readonly V7SettingMemberDefinition[]
): V7SettingMemberDefinition[] {
  const snapshot = parseJsonArray(snapshotJson);
  const parsed = snapshot?.map(parseSettingMember).filter(isDefined) ?? [];
  const complete = snapshot !== null
    && parsed.length === snapshot.length
    && uniqueMemberKeys(parsed)
    && parsed.filter((member) => member.roleKey === 'chief_editor').length === 1
    && parsed.filter((member) => member.roleKey === 'deputy_editor').length === 1
    && parsed.some((member) => member.roleKey === 'screenwriter');
  return cloneSettingRoster(complete ? parsed : currentRoster);
}

/** Read a recommendation task's frozen chief without consulting today's roster. */
export function openingChiefTaskSnapshot(snapshotJson: string): V7OpeningMemberDefinition[] {
  const snapshot = parseJsonArray(snapshotJson);
  if (snapshot === null) throw new Error('设定清单主编快照无效');
  const members = snapshot.map(parseOpeningChief).filter(isDefined);
  if (members.length !== snapshot.length || members.length === 0 || !uniqueMemberKeys(members)) {
    throw new Error('设定清单主编快照成员无效');
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
