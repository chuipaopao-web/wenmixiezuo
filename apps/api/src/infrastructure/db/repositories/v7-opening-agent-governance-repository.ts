import type { DatabaseSync } from 'node:sqlite';
import {
  V7_OPENING_MEMBERS,
  V7_OPENING_ROLES,
  validateEffectiveOpeningAgentRoster,
  type V7OpeningMemberDefinition,
  type V7OpeningRoleKey
} from '@wenmi/v7-backend';

interface RoleRow {
  role_key: V7OpeningRoleKey;
  revision: number;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  member_key: string;
  role_key: V7OpeningRoleKey;
  enabled: number;
  default_for_role: number;
  fallback_priority: number;
  prompt_instruction: string;
  created_at: string;
  updated_at: string;
}

export interface V7OpeningAgentGovernanceRole {
  roleKey: V7OpeningRoleKey;
  revision: number;
  updatedAt: string;
  members: V7OpeningMemberDefinition[];
}

export interface V7OpeningAgentGovernanceSnapshot {
  roles: V7OpeningAgentGovernanceRole[];
  members: V7OpeningMemberDefinition[];
}

export type V7OpeningAgentGovernancePatch = Readonly<{
  enabled?: boolean;
  defaultForRole?: boolean;
  fallbackPriority?: number;
  promptInstruction?: string;
}>;

export class V7OpeningAgentGovernanceConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'V7OpeningAgentGovernanceConflictError';
  }
}

export class V7OpeningAgentGovernanceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'V7OpeningAgentGovernanceValidationError';
  }
}

export class V7OpeningAgentGovernanceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public snapshot(): V7OpeningAgentGovernanceSnapshot {
    const roles = V7_OPENING_ROLES.map((role) => this.role(role.roleKey));
    const members = roles.flatMap((role) => role.members.map(cloneMember));
    const errors = validateEffectiveOpeningAgentRoster(members);
    if (errors.length > 0) throw new Error(`V7成员治理配置无效：${errors.join('；')}`);
    return { roles, members };
  }

  public update(input: {
    memberKey: string;
    expectedRevision: number;
    patch: V7OpeningAgentGovernancePatch;
    actorUserId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7OpeningAgentGovernanceSnapshot {
    const staticMember = V7_OPENING_MEMBERS.find((candidate) => candidate.memberKey === input.memberKey);
    if (staticMember === undefined) {
      throw new V7OpeningAgentGovernanceValidationError('AI成员不存在。');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const role = this.role(staticMember.roleKey);
      if (role.revision !== input.expectedRevision) {
        throw new V7OpeningAgentGovernanceConflictError('这个岗位刚刚被其他操作更新，请刷新后再试。');
      }
      const previous = roleState(role);
      const nextMembers = applyPatch(role.members, input.memberKey, input.patch);
      const validationErrors = validateEffectiveOpeningAgentRoster([
        ...this.snapshotOutsideRole(staticMember.roleKey),
        ...nextMembers
      ]);
      if (validationErrors.length > 0) {
        throw new V7OpeningAgentGovernanceValidationError(validationErrors.join('；'));
      }

      // 先移出唯一优先级范围，再按新顺序写回，保证交换顺序时不会触发临时唯一冲突。
      this.database.prepare(`
        UPDATE v7_opening_agent_member_settings
        SET fallback_priority = fallback_priority + 10, updated_at = ?
        WHERE role_key = ?
      `).run(input.now, staticMember.roleKey);
      const updateMember = this.database.prepare(`
        UPDATE v7_opening_agent_member_settings
        SET enabled = ?, default_for_role = ?, fallback_priority = ?, prompt_instruction = ?, updated_at = ?
        WHERE member_key = ? AND role_key = ?
      `);
      for (const member of nextMembers) {
        const result = updateMember.run(
          member.enabledByDefault ? 1 : 0,
          member.defaultForRole ? 1 : 0,
          member.fallbackPriority,
          member.promptInstruction,
          input.now,
          member.memberKey,
          member.roleKey
        );
        if (result.changes !== 1) throw new Error(`V7成员治理记录缺失：${member.memberKey}`);
      }
      const nextRevision = role.revision + 1;
      const updatedRole = this.database.prepare(`
        UPDATE v7_opening_agent_role_settings
        SET revision = ?, updated_by_user_id = ?, updated_at = ?
        WHERE role_key = ? AND revision = ?
      `).run(nextRevision, input.actorUserId, input.now, staticMember.roleKey, input.expectedRevision);
      if (updatedRole.changes !== 1) {
        throw new V7OpeningAgentGovernanceConflictError('这个岗位刚刚被其他操作更新，请刷新后再试。');
      }
      const next = {
        roleKey: staticMember.roleKey,
        revision: nextRevision,
        members: nextMembers.map(cloneMember)
      };
      this.database.prepare(`
        INSERT INTO v7_opening_agent_member_setting_events (
          event_id, role_key, member_key, actor_user_id,
          previous_role_json, next_role_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.eventId,
        staticMember.roleKey,
        input.memberKey,
        input.actorUserId,
        JSON.stringify(previous),
        JSON.stringify(next),
        input.reason,
        input.now
      );
      this.database.exec('COMMIT');
      return this.snapshot();
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private role(roleKey: V7OpeningRoleKey): V7OpeningAgentGovernanceRole {
    const role = this.database.prepare(`
      SELECT role_key, revision, updated_by_user_id, created_at, updated_at
      FROM v7_opening_agent_role_settings WHERE role_key = ?
    `).get(roleKey) as RoleRow | undefined;
    if (role === undefined) throw new Error(`V7岗位治理记录缺失：${roleKey}`);
    const rows = this.database.prepare(`
      SELECT member_key, role_key, enabled, default_for_role, fallback_priority, prompt_instruction, created_at, updated_at
      FROM v7_opening_agent_member_settings WHERE role_key = ? ORDER BY fallback_priority
    `).all(roleKey) as unknown as MemberRow[];
    const expected = V7_OPENING_MEMBERS.filter((candidate) => candidate.roleKey === roleKey);
    if (rows.length !== expected.length) throw new Error(`V7岗位成员治理数量不完整：${roleKey}`);
    const members = rows.map((row) => {
      const definition = expected.find((candidate) => candidate.memberKey === row.member_key);
      if (definition === undefined || row.role_key !== definition.roleKey) {
        throw new Error(`V7成员治理身份与代码登记不一致：${row.member_key}`);
      }
      return {
        ...definition,
        model: { ...definition.model },
        enabledByDefault: row.enabled === 1,
        defaultForRole: row.default_for_role === 1,
        fallbackPriority: row.fallback_priority,
        promptInstruction: row.prompt_instruction
      };
    });
    return {
      roleKey,
      revision: role.revision,
      updatedAt: role.updated_at,
      members
    };
  }

  private snapshotOutsideRole(roleKey: V7OpeningRoleKey): V7OpeningMemberDefinition[] {
    return V7_OPENING_ROLES
      .filter((role) => role.roleKey !== roleKey)
      .flatMap((role) => this.role(role.roleKey).members.map(cloneMember));
  }
}

function applyPatch(
  roleMembers: readonly V7OpeningMemberDefinition[],
  memberKey: string,
  patch: V7OpeningAgentGovernancePatch
): V7OpeningMemberDefinition[] {
  const members = roleMembers
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority)
    .map(cloneMember);
  const target = members.find((member) => member.memberKey === memberKey);
  if (target === undefined) throw new V7OpeningAgentGovernanceValidationError('AI成员岗位不匹配。');

  if (patch.defaultForRole === false && target.defaultForRole) {
    throw new V7OpeningAgentGovernanceValidationError('请直接把另一名成员设为默认，系统会自动完成切换。');
  }
  if (patch.enabled === false) {
    const otherEnabled = members.filter((member) => member.memberKey !== memberKey && member.enabledByDefault);
    if (otherEnabled.length === 0) {
      throw new V7OpeningAgentGovernanceValidationError('每个岗位至少要保留一名上岗成员。');
    }
    target.enabledByDefault = false;
    if (target.defaultForRole) {
      target.defaultForRole = false;
      otherEnabled[0]!.defaultForRole = true;
    }
  }
  if (patch.enabled === true) target.enabledByDefault = true;
  if (patch.defaultForRole === true) {
    for (const member of members) member.defaultForRole = member.memberKey === memberKey;
    target.enabledByDefault = true;
  }
  if (patch.promptInstruction !== undefined) target.promptInstruction = patch.promptInstruction;

  if (patch.fallbackPriority !== undefined) {
    const currentIndex = members.findIndex((member) => member.memberKey === memberKey);
    const [moving] = members.splice(currentIndex, 1);
    const nextIndex = Math.min(Math.max(patch.fallbackPriority - 1, 0), members.length);
    members.splice(nextIndex, 0, moving!);
  }
  const defaultIndex = members.findIndex((member) => member.defaultForRole);
  if (defaultIndex > 0) {
    const [defaultMember] = members.splice(defaultIndex, 1);
    members.unshift(defaultMember!);
  }
  members.forEach((member, index) => { member.fallbackPriority = index + 1; });
  return members;
}

function roleState(role: V7OpeningAgentGovernanceRole): object {
  return {
    roleKey: role.roleKey,
    revision: role.revision,
    members: role.members.map((member) => ({
      memberKey: member.memberKey,
      enabled: member.enabledByDefault,
      defaultForRole: member.defaultForRole,
      fallbackPriority: member.fallbackPriority,
      promptInstruction: member.promptInstruction
    }))
  };
}

function cloneMember(member: V7OpeningMemberDefinition): V7OpeningMemberDefinition {
  return { ...member, model: { ...member.model }, promptInstruction: member.promptInstruction };
}
