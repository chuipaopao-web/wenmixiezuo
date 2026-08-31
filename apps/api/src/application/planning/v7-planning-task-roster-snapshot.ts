import type {
  V7CreationMemberDefinition,
  V7PlanningMemberDefinition
} from '@wenmi/v7-backend';

type ModelBinding = Readonly<{
  provider: 'volcengine-ark-agent-plan' | 'volcengine-ark-coding-plan';
  modelId: string;
  plan: 'coding' | 'agent';
}>;

export function snapshotPlanningMembers(
  members: readonly V7PlanningMemberDefinition[]
): V7PlanningMemberDefinition[] {
  return members.map((member) => ({ ...member, model: { ...member.model } }));
}

export function snapshotCreationMembers(
  members: readonly V7CreationMemberDefinition[]
): V7CreationMemberDefinition[] {
  return members.map((member) => ({ ...member, model: { ...member.model } }));
}

export function readFrozenPlanningMembers(
  value: unknown,
  allowedRoles: readonly V7PlanningMemberDefinition['roleKey'][]
): V7PlanningMemberDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((item, index) => planningMember(item, index));
  if (parsed.some((member) => member === null)) return null;
  const members = parsed as V7PlanningMemberDefinition[];
  if (!uniqueMemberKeys(members) || members.some((member) => !allowedRoles.includes(member.roleKey))) return null;
  return members;
}

export function readFrozenCreationMembers(
  value: unknown,
  allowedRoles: readonly V7CreationMemberDefinition['roleKey'][]
): V7CreationMemberDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((item, index) => creationMember(item, index));
  if (parsed.some((member) => member === null)) return null;
  const members = parsed as V7CreationMemberDefinition[];
  if (!uniqueMemberKeys(members) || members.some((member) => !allowedRoles.includes(member.roleKey))) return null;
  return members;
}

export function resolveFrozenPlanningMembers(
  value: unknown,
  currentRoster: readonly V7PlanningMemberDefinition[],
  allowedRoles: readonly V7PlanningMemberDefinition['roleKey'][]
): V7PlanningMemberDefinition[] {
  const frozen = readFrozenPlanningMembers(value, allowedRoles);
  if (frozen === null) throw new Error('规划任务冻结成员名册不完整');
  if (!frozen.every((member) => currentRoster.some((current) => current.enabledByDefault
    && current.memberKey === member.memberKey
    && current.roleKey === member.roleKey
    && sameModel(current.model, member.model)))) {
    throw new Error('规划任务冻结成员已退役或模型绑定已经变化');
  }
  return snapshotPlanningMembers(frozen);
}

export function resolveFrozenCreationMembers(
  value: unknown,
  currentRoster: readonly V7CreationMemberDefinition[],
  allowedRoles: readonly V7CreationMemberDefinition['roleKey'][]
): V7CreationMemberDefinition[] {
  const frozen = readFrozenCreationMembers(value, allowedRoles);
  if (frozen === null) throw new Error('规划资料策划冻结成员名册不完整');
  if (!frozen.every((member) => currentRoster.some((current) => current.enabledByDefault
    && current.memberKey === member.memberKey
    && current.roleKey === member.roleKey
    && sameModel(current.model, member.model)))) {
    throw new Error('规划资料策划冻结成员已退役或模型绑定已经变化');
  }
  return snapshotCreationMembers(frozen);
}

function planningMember(value: unknown, index: number): V7PlanningMemberDefinition | null {
  const row = record(value);
  const memberKey = text(row?.memberKey);
  const displayName = text(row?.displayName);
  const roleKey = text(row?.roleKey);
  const model = modelBinding(row);
  if (memberKey === null || displayName === null || !planningRole(roleKey) || model === null) return null;
  return {
    memberKey,
    displayName,
    roleKey,
    enabledByDefault: true,
    defaultForRole: typeof row?.defaultForRole === 'boolean' ? row.defaultForRole : index === 0,
    fallbackPriority: positiveInteger(row?.fallbackPriority) ?? index + 1,
    model,
    promptInstruction: typeof row?.promptInstruction === 'string' ? row.promptInstruction.slice(0, 4_000) : ''
  };
}

function creationMember(value: unknown, index: number): V7CreationMemberDefinition | null {
  const row = record(value);
  const memberKey = text(row?.memberKey);
  const displayName = text(row?.displayName);
  const roleKey = text(row?.roleKey);
  const model = modelBinding(row);
  if (memberKey === null || displayName === null || !creationRole(roleKey) || model === null) return null;
  return {
    memberKey,
    displayName,
    roleKey,
    enabledByDefault: true,
    defaultForRole: typeof row?.defaultForRole === 'boolean' ? row.defaultForRole : index === 0,
    fallbackPriority: positiveInteger(row?.fallbackPriority) ?? index + 1,
    model,
    promptInstruction: typeof row?.promptInstruction === 'string' ? row.promptInstruction.slice(0, 4_000) : ''
  };
}

function modelBinding(row: Record<string, unknown> | undefined): ModelBinding | null {
  const nested = record(row?.model);
  const provider = text(nested?.provider ?? row?.provider);
  const modelId = text(nested?.modelId ?? row?.modelId);
  const plan = text(nested?.plan ?? row?.plan);
  if ((provider !== 'volcengine-ark-agent-plan' && provider !== 'volcengine-ark-coding-plan')
    || modelId === null || (plan !== 'coding' && plan !== 'agent')) return null;
  if ((provider === 'volcengine-ark-coding-plan') !== (plan === 'coding')) return null;
  return { provider, modelId, plan };
}

function sameModel(
  left: Readonly<{ provider: string; modelId: string; plan: string }>,
  right: Readonly<{ provider: string; modelId: string; plan: string }>
): boolean {
  return left.provider === right.provider && left.modelId === right.modelId && left.plan === right.plan;
}

function planningRole(value: string | null): value is V7PlanningMemberDefinition['roleKey'] {
  return value === 'chief_editor' || value === 'planning_writer' || value === 'continuity_editor';
}

function creationRole(value: string | null): value is V7CreationMemberDefinition['roleKey'] {
  return value === 'context_editor'
    || value === 'chief_editor'
    || value === 'planning_writer'
    || value === 'lead_writer'
    || value === 'independent_reviewer'
    || value === 'settlement_editor';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function uniqueMemberKeys(members: readonly { memberKey: string }[]): boolean {
  return new Set(members.map((member) => member.memberKey)).size === members.length;
}
