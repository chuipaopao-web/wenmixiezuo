import type { DatabaseSync } from 'node:sqlite';
import {
  V7_GLOBAL_MEMBERS,
  V7_TASK_TEMPERATURE_POLICIES,
  allowedModelProfilesForRole,
  modelBindingForProfile,
  taskTemperaturePolicy,
  type V7AgentTaskKind,
  type V7EffectiveMember,
  type V7FixedRoleKey,
  type V7TaskTemperaturePolicy
} from '@wenmi/v7-backend';

interface MemberSettingRow {
  member_key: string;
  fixed_role_key: V7FixedRoleKey;
  model_profile_key: string;
  enabled: number;
  default_for_role: number;
  fallback_priority: number;
  temperature_adjustment: number;
  prompt_instruction: string;
  revision: number;
}

interface TaskPolicyRow {
  task_kind: V7AgentTaskKind;
  default_temperature: number;
  minimum_temperature: number;
  maximum_temperature: number;
  revision: number;
}

export interface V7AgentGovernanceSnapshot {
  revision: number;
  members: V7EffectiveMember[];
  taskPolicies: Array<V7TaskTemperaturePolicy & { revision: number }>;
}

export interface V7ResolvedTaskPolicy {
  governanceRevision: number;
  temperature: number;
}

const RETIRED_MEMBER_KEYS = new Set([
  'planner-glm-5-2',
  'planner-doubao',
  'visual-minimax-m3',
  // 25人试运行名册收敛到22人后的历史成员。保留行和旧任务快照，
  // 只停岗，不删除、不重写已执行记录。
  'continuity-deepseek-v4-flash',
  'continuity-kimi-2-7',
  'deputy-deepseek-v4-flash',
  'review-deepseek-v4-flash',
  'planner-deepseek-v4-flash',
  'planner-kimi-2-7'
]);

export class V7AgentGovernanceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public ensureSeeded(now: string): void {
    const beforeCount = (this.database.prepare('SELECT count(*) AS count FROM v7_agent_governance_member_settings').get() as { count: number }).count;
    let rosterChanged = false;
    const insertMember = this.database.prepare(`INSERT OR IGNORE INTO v7_agent_governance_member_settings(
      member_key,fixed_role_key,model_profile_key,enabled,default_for_role,fallback_priority,
      temperature_adjustment,prompt_instruction,revision,updated_by,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,1,'system',?)`);
    for (const member of V7_GLOBAL_MEMBERS) {
      const result = insertMember.run(member.memberKey, member.fixedRoleKey, member.modelProfileKey, member.enabledByDefault ? 1 : 0,
        member.defaultForRole ? 1 : 0, member.fallbackPriority, 0, member.promptInstruction, now);
      rosterChanged = rosterChanged || result.changes > 0;
    }
    const currentModel = this.database.prepare(`SELECT model_profile_key FROM v7_agent_governance_member_settings
      WHERE member_key=?`);
    const restoreApprovedModel = this.database.prepare(`UPDATE v7_agent_governance_member_settings
      SET model_profile_key=?,updated_by='system',updated_at=? WHERE member_key=?`);
    for (const member of V7_GLOBAL_MEMBERS) {
      const row = currentModel.get(member.memberKey) as { model_profile_key: string } | undefined;
      if (row !== undefined && !allowedModelProfilesForRole(member.fixedRoleKey).includes(row.model_profile_key)) {
        rosterChanged = restoreApprovedModel.run(member.modelProfileKey, now, member.memberKey).changes > 0 || rosterChanged;
      }
    }
    const retireMember = this.database.prepare(`UPDATE v7_agent_governance_member_settings
      SET enabled=0,default_for_role=0,updated_by='system',updated_at=?
      WHERE member_key=? AND (enabled<>0 OR default_for_role<>0)`);
    for (const memberKey of RETIRED_MEMBER_KEYS) {
      rosterChanged = retireMember.run(now, memberKey).changes > 0 || rosterChanged;
    }
    const insertPolicy = this.database.prepare(`INSERT OR IGNORE INTO v7_agent_governance_task_policies(
      task_kind,default_temperature,minimum_temperature,maximum_temperature,revision,updated_by,updated_at
    ) VALUES(?,?,?,?,1,'system',?)`);
    for (const policy of V7_TASK_TEMPERATURE_POLICIES) {
      insertPolicy.run(policy.taskKind, policy.defaultTemperature, policy.minimumTemperature, policy.maximumTemperature, now);
    }
    if (beforeCount > 0 && rosterChanged) {
      this.database.prepare(`UPDATE v7_agent_governance_meta
        SET revision=revision+1,updated_by='system',updated_at=? WHERE singleton=1`).run(now);
    }
  }

  public snapshot(): V7AgentGovernanceSnapshot {
    const meta = this.database.prepare('SELECT revision FROM v7_agent_governance_meta WHERE singleton=1').get() as { revision: number } | undefined;
    if (meta === undefined) throw new Error('V7统一成员治理尚未初始化');
    const rows = this.database.prepare(`SELECT member_key,fixed_role_key,model_profile_key,enabled,default_for_role,
      fallback_priority,temperature_adjustment,prompt_instruction,revision
      FROM v7_agent_governance_member_settings ORDER BY fixed_role_key,fallback_priority,member_key`).all() as unknown as MemberSettingRow[];
    const unknownRows = rows.filter((row) => !V7_GLOBAL_MEMBERS.some((candidate) => candidate.memberKey === row.member_key)
      && !RETIRED_MEMBER_KEYS.has(row.member_key));
    if (unknownRows.length > 0) throw new Error(`V7统一成员治理存在未知成员：${unknownRows.map((row) => row.member_key).join('、')}`);
    const activeRows = rows.filter((row) => V7_GLOBAL_MEMBERS.some((candidate) => candidate.memberKey === row.member_key));
    if (activeRows.length !== V7_GLOBAL_MEMBERS.length) throw new Error('V7统一成员治理登记不完整');
    const members = activeRows.map((row): V7EffectiveMember => {
      const definition = V7_GLOBAL_MEMBERS.find((candidate) => candidate.memberKey === row.member_key);
      if (definition === undefined || definition.fixedRoleKey !== row.fixed_role_key) throw new Error(`V7成员固定岗位被破坏：${row.member_key}`);
      return {
        ...definition,
        modelProfileKey: row.model_profile_key,
        model: modelBindingForProfile(row.model_profile_key),
        fallbackPriority: row.fallback_priority,
        defaultForRole: row.default_for_role === 1,
        enabledByDefault: row.enabled === 1,
        promptInstruction: row.prompt_instruction,
        enabled: row.enabled === 1,
        temperatureAdjustment: row.temperature_adjustment,
        governanceRevision: meta.revision
      };
    });
    const policyRows = this.database.prepare(`SELECT task_kind,default_temperature,minimum_temperature,
      maximum_temperature,revision FROM v7_agent_governance_task_policies ORDER BY task_kind`).all() as unknown as TaskPolicyRow[];
    if (policyRows.length !== V7_TASK_TEMPERATURE_POLICIES.length) throw new Error('V7任务温度策略登记不完整');
    const taskPolicies = policyRows.map((row) => {
      const definition = V7_TASK_TEMPERATURE_POLICIES.find((candidate) => candidate.taskKind === row.task_kind);
      if (definition === undefined) throw new Error(`未知任务温度策略：${row.task_kind}`);
      return {
        ...definition,
        defaultTemperature: row.default_temperature,
        minimumTemperature: row.minimum_temperature,
        maximumTemperature: row.maximum_temperature,
        revision: row.revision
      };
    });
    return { revision: meta.revision, members, taskPolicies };
  }

  public resolveTaskPolicy(memberKey: string, taskKind: V7AgentTaskKind): V7ResolvedTaskPolicy {
    const definition = V7_GLOBAL_MEMBERS.find((candidate) => candidate.memberKey === memberKey);
    if (definition === undefined) throw new Error(`V7任务成员已经退役或不存在：${memberKey}`);
    const meta = this.database.prepare('SELECT revision FROM v7_agent_governance_meta WHERE singleton=1').get() as
      { revision: number } | undefined;
    const policy = this.database.prepare(`SELECT default_temperature,minimum_temperature,maximum_temperature
      FROM v7_agent_governance_task_policies WHERE task_kind=?`).get(taskKind) as
      { default_temperature: number; minimum_temperature: number; maximum_temperature: number } | undefined;
    const member = this.database.prepare(`SELECT fixed_role_key,model_profile_key,enabled,temperature_adjustment
      FROM v7_agent_governance_member_settings WHERE member_key=?`).get(memberKey) as {
        fixed_role_key: V7FixedRoleKey;
        model_profile_key: string;
        enabled: number;
        temperature_adjustment: number;
      } | undefined;
    const settingCount = this.database.prepare('SELECT count(*) AS count FROM v7_agent_governance_member_settings').get() as
      { count: number };
    if (settingCount.count === 0) {
      const fallback = taskTemperaturePolicy(taskKind);
      return { governanceRevision: meta?.revision ?? 1, temperature: fallback.defaultTemperature };
    }
    if (meta === undefined || policy === undefined || member === undefined) {
      throw new Error(`V7成员运行参数尚未就绪：${memberKey}/${taskKind}`);
    }
    if (member.enabled !== 1
      || member.fixed_role_key !== definition.fixedRoleKey
      || !allowedModelProfilesForRole(definition.fixedRoleKey).includes(member.model_profile_key)) {
      throw new Error(`V7任务成员当前不可执行：${memberKey}`);
    }
    const temperatureAdjustment = member.temperature_adjustment;
    const temperature = Math.round(Math.min(policy.maximum_temperature,
      Math.max(policy.minimum_temperature, policy.default_temperature + temperatureAdjustment)) * 100) / 100;
    return { governanceRevision: meta.revision, temperature };
  }

  public updateMember(input: {
    memberKey: string;
    expectedRevision: number;
    modelProfileKey?: string;
    enabled?: boolean;
    defaultForRole?: boolean;
    fallbackPriority?: number;
    temperatureAdjustment?: number;
    promptInstruction?: string;
    actorId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7AgentGovernanceSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.assertRevision(input.expectedRevision);
      const before = this.snapshot();
      const target = before.members.find((member) => member.memberKey === input.memberKey);
      if (target === undefined) throw new Error('成员不存在');
      let enabled = input.enabled ?? target.enabled;
      let isDefault = input.defaultForRole ?? target.defaultForRole;
      const roleMembers = before.members.filter((member) => member.fixedRoleKey === target.fixedRoleKey)
        .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
      if (!enabled && roleMembers.filter((member) => member.enabled && member.memberKey !== target.memberKey).length === 0) {
        throw new Error('每个岗位至少保留一名上岗成员');
      }
      if (isDefault) enabled = true;
      if (!enabled && isDefault) isDefault = false;
      if (input.defaultForRole === false && target.defaultForRole && enabled) throw new Error('请把另一名成员设为默认，系统会自动完成切换');
      if (isDefault) {
        this.database.prepare(`UPDATE v7_agent_governance_member_settings SET default_for_role=0,updated_at=? WHERE fixed_role_key=?`)
          .run(input.now, target.fixedRoleKey);
      }
      if (!enabled && target.defaultForRole) {
        const replacement = roleMembers.find((member) => member.memberKey !== target.memberKey && member.enabled);
        if (replacement === undefined) throw new Error('该岗位没有可接班成员');
        this.database.prepare(`UPDATE v7_agent_governance_member_settings SET default_for_role=1,updated_at=? WHERE member_key=?`)
          .run(input.now, replacement.memberKey);
      }
      const nextRevision = input.expectedRevision + 1;
      this.database.prepare(`UPDATE v7_agent_governance_member_settings SET model_profile_key=?,enabled=?,default_for_role=?,
        fallback_priority=?,temperature_adjustment=?,prompt_instruction=?,revision=revision+1,updated_by=?,updated_at=? WHERE member_key=?`)
        .run(input.modelProfileKey ?? target.modelProfileKey, enabled ? 1 : 0, isDefault ? 1 : 0,
          input.fallbackPriority ?? target.fallbackPriority, input.temperatureAdjustment ?? target.temperatureAdjustment,
          input.promptInstruction ?? target.promptInstruction, input.actorId, input.now, target.memberKey);
      const changedMeta = this.database.prepare(`UPDATE v7_agent_governance_meta SET revision=?,updated_by=?,updated_at=? WHERE singleton=1 AND revision=?`)
        .run(nextRevision, input.actorId, input.now, input.expectedRevision);
      if (changedMeta.changes !== 1) throw new Error('成员配置刚刚被其他操作更新，请刷新后再试');
      const after = this.snapshot();
      this.insertEvent(input.eventId, input.actorId, 'member', target.memberKey, before, after, input.reason, input.now);
      this.database.exec('COMMIT');
      return after;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public updateTaskPolicy(input: {
    taskKind: V7AgentTaskKind;
    expectedRevision: number;
    defaultTemperature: number;
    actorId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7AgentGovernanceSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.assertRevision(input.expectedRevision);
      const before = this.snapshot();
      const target = before.taskPolicies.find((policy) => policy.taskKind === input.taskKind);
      if (target === undefined) throw new Error('任务温度策略不存在');
      if (input.defaultTemperature < target.minimumTemperature || input.defaultTemperature > target.maximumTemperature) {
        throw new Error(`温度必须在${target.minimumTemperature}至${target.maximumTemperature}之间`);
      }
      this.database.prepare(`UPDATE v7_agent_governance_task_policies SET default_temperature=?,revision=revision+1,
        updated_by=?,updated_at=? WHERE task_kind=?`).run(input.defaultTemperature, input.actorId, input.now, input.taskKind);
      const nextRevision = input.expectedRevision + 1;
      const changedMeta = this.database.prepare(`UPDATE v7_agent_governance_meta SET revision=?,updated_by=?,updated_at=? WHERE singleton=1 AND revision=?`)
        .run(nextRevision, input.actorId, input.now, input.expectedRevision);
      if (changedMeta.changes !== 1) throw new Error('温度策略刚刚被其他操作更新，请刷新后再试');
      const after = this.snapshot();
      this.insertEvent(input.eventId, input.actorId, 'task_policy', input.taskKind, before, after, input.reason, input.now);
      this.database.exec('COMMIT');
      return after;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private assertRevision(expectedRevision: number): void {
    const row = this.database.prepare('SELECT revision FROM v7_agent_governance_meta WHERE singleton=1').get() as { revision: number } | undefined;
    if (row === undefined || row.revision !== expectedRevision) throw new Error('配置刚刚被其他操作更新，请刷新后再试');
  }

  private insertEvent(eventId: string, actorId: string, targetKind: 'member' | 'task_policy', targetKey: string,
    before: V7AgentGovernanceSnapshot, after: V7AgentGovernanceSnapshot, reason: string, now: string): void {
    this.database.prepare(`INSERT INTO v7_agent_governance_events(event_id,actor_id,target_kind,target_key,before_json,after_json,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(eventId, actorId, targetKind, targetKey, JSON.stringify(before), JSON.stringify(after), reason, now);
  }
}
