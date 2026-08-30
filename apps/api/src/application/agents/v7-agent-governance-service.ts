import {
  V7_MODEL_PROFILE_LABELS,
  V7_ROLE_CONTRACTS,
  allowedModelProfilesForRole,
  effectiveTemperature,
  independentReviewers,
  modelBindingForProfile,
  type V7AgentTaskKind,
  type V7AgentTaskSnapshot,
  type V7EffectiveMember,
  type V7FixedRoleKey
} from '@wenmi/v7-backend';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import {
  V7AgentGovernanceRepository,
  type V7AgentGovernanceSnapshot
} from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';

export interface V7AgentCredentialState {
  codingPlan: boolean;
  agentPlan: boolean;
  image: boolean;
}

export class V7AgentGovernanceService {
  public constructor(
    private readonly repository: V7AgentGovernanceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly credentials: V7AgentCredentialState
  ) {
    this.repository.ensureSeeded(this.clock.now().toISOString());
  }

  public snapshot(): V7AgentGovernanceSnapshot {
    return this.repository.snapshot();
  }

  public members(roleKey?: V7FixedRoleKey): V7EffectiveMember[] {
    return this.snapshot().members.filter((member) => member.enabled && (roleKey === undefined || member.fixedRoleKey === roleKey))
      .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  }

  public fallback(roleKey: V7FixedRoleKey, selectedMemberKey?: string, excludeModelProfileKey?: string): V7EffectiveMember[] {
    const candidates = this.members(roleKey).filter((member) => member.modelProfileKey !== excludeModelProfileKey);
    const selected = selectedMemberKey === undefined ? undefined : candidates.find((member) => member.memberKey === selectedMemberKey);
    if (selectedMemberKey !== undefined && selected === undefined) throw new DomainError(errorCodes.validation, '选择的成员不在当前岗位或正在请假。');
    const defaultMember = candidates.find((member) => member.defaultForRole);
    if (defaultMember === undefined) throw new DomainError('V7_AGENT_GOVERNANCE_CONFLICT', '当前岗位没有可接单成员。', {}, true, 409);
    const seen = new Set<string>();
    return [selected, defaultMember, ...candidates].filter((member): member is V7EffectiveMember => member !== undefined).filter((member) => {
      if (seen.has(member.modelProfileKey)) return false;
      seen.add(member.modelProfileKey);
      return this.credentialReady(member);
    });
  }

  public reviewersFor(writer: V7EffectiveMember): V7EffectiveMember[] {
    return independentReviewers(writer, this.members('independent_reviewer')) as V7EffectiveMember[];
  }

  public taskSnapshot(member: V7EffectiveMember, taskKind: V7AgentTaskKind): V7AgentTaskSnapshot {
    const state = this.snapshot();
    const policy = state.taskPolicies.find((candidate) => candidate.taskKind === taskKind);
    if (policy === undefined) throw new Error(`任务温度策略不存在：${taskKind}`);
    const temperature = Math.round(Math.min(policy.maximumTemperature,
      Math.max(policy.minimumTemperature, policy.defaultTemperature + member.temperatureAdjustment)) * 100) / 100;
    return {
      memberKey: member.memberKey,
      displayName: member.displayName,
      fixedRoleKey: member.fixedRoleKey,
      modelProfileKey: member.modelProfileKey,
      model: { ...member.model },
      taskKind,
      temperature,
      governanceRevision: state.revision,
      createdAt: this.clock.now().toISOString()
    };
  }

  public adminView(): object {
    const snapshot = this.snapshot();
    return {
      revision: snapshot.revision,
      summary: {
        roleCount: V7_ROLE_CONTRACTS.length,
        memberCount: snapshot.members.length,
        onDutyCount: snapshot.members.filter((member) => member.enabled && this.credentialReady(member)).length,
        leaveCount: snapshot.members.filter((member) => !member.enabled || !this.credentialReady(member)).length
      },
      credentials: this.credentials,
      modelProfiles: Object.entries(V7_MODEL_PROFILE_LABELS).map(([profileKey, publicName]) => ({ profileKey, publicName })),
      roles: V7_ROLE_CONTRACTS.map((role) => ({
        ...role,
        allowedModelProfileKeys: allowedModelProfilesForRole(role.roleKey),
        members: snapshot.members.filter((member) => member.fixedRoleKey === role.roleKey)
          .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority)
          .map((member) => ({
            memberKey: member.memberKey,
            displayName: member.displayName,
            modelProfileKey: member.modelProfileKey,
            modelName: V7_MODEL_PROFILE_LABELS[member.modelProfileKey] ?? member.modelProfileKey,
            provider: member.model.provider,
            plan: member.model.plan,
            enabled: member.enabled,
            defaultForRole: member.defaultForRole,
            fallbackPriority: member.fallbackPriority,
            temperatureAdjustment: member.temperatureAdjustment,
            credentialReady: this.credentialReady(member),
            status: member.enabled && this.credentialReady(member) ? 'on_duty' : 'on_leave'
          }))
      })),
      taskPolicies: snapshot.taskPolicies
    };
  }

  public updateMember(actorId: string, memberKey: string, body: Record<string, unknown>): object {
    const snapshot = this.snapshot();
    const target = snapshot.members.find((member) => member.memberKey === memberKey);
    if (target === undefined) throw new DomainError(errorCodes.validation, '成员不存在。');
    const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效');
    const modelProfileKey = optionalText(body.modelProfileKey, 100);
    if (modelProfileKey !== undefined && !allowedModelProfilesForRole(target.fixedRoleKey).includes(modelProfileKey)) {
      throw new DomainError(errorCodes.validation, '这个模型不适合当前固定岗位。');
    }
    const temperatureAdjustment = optionalNumber(body.temperatureAdjustment, -.2, .2);
    const fallbackPriority = optionalInteger(body.fallbackPriority, 1, 100);
    if (body.promptInstruction !== undefined) {
      throw new DomainError(
        errorCodes.validation,
        '成员不再保存永久补充提示，请在提示词与上下文中心调整岗位、工位或题材人设版本。'
      );
    }
    const enabled = optionalBoolean(body.enabled);
    const defaultForRole = optionalBoolean(body.defaultForRole);
    const reason = optionalText(body.reason, 1000) ?? '管理员调整V7成员';
    try {
      const patch: Parameters<V7AgentGovernanceRepository['updateMember']>[0] = {
        memberKey, expectedRevision, actorId, eventId: this.ids.next(), reason, now: this.clock.now().toISOString()
      };
      if (modelProfileKey !== undefined) patch.modelProfileKey = modelProfileKey;
      if (temperatureAdjustment !== undefined) patch.temperatureAdjustment = temperatureAdjustment;
      if (fallbackPriority !== undefined) patch.fallbackPriority = fallbackPriority;
      if (enabled !== undefined) patch.enabled = enabled;
      if (defaultForRole !== undefined) patch.defaultForRole = defaultForRole;
      const result = this.repository.updateMember(patch);
      return this.adminViewFrom(result);
    } catch (error) {
      throw governanceError(error);
    }
  }

  public updateTaskPolicy(actorId: string, taskKind: V7AgentTaskKind, body: Record<string, unknown>): object {
    const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效');
    const defaultTemperature = requiredNumber(body.defaultTemperature, 0, 1, '任务温度无效');
    const reason = optionalText(body.reason, 1000) ?? '管理员调整V7任务温度';
    try {
      const result = this.repository.updateTaskPolicy({ taskKind, expectedRevision, defaultTemperature, actorId,
        eventId: this.ids.next(), reason, now: this.clock.now().toISOString() });
      return this.adminViewFrom(result);
    } catch (error) {
      throw governanceError(error);
    }
  }

  private adminViewFrom(_snapshot: V7AgentGovernanceSnapshot): object {
    return this.adminView();
  }

  private credentialReady(member: Pick<V7EffectiveMember, 'model'>): boolean {
    if (member.model.plan === 'coding') return this.credentials.codingPlan;
    if (member.model.plan === 'image') return this.credentials.image;
    return this.credentials.agentPlan;
  }
}

function governanceError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const message = error instanceof Error ? error.message : '成员配置保存失败';
  const conflict = message.includes('刚刚') || message.includes('接班') || message.includes('至少保留');
  return new DomainError(conflict ? 'V7_AGENT_GOVERNANCE_CONFLICT' : errorCodes.validation, message, {}, conflict, conflict ? 409 : 400);
}

function requiredInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new DomainError(errorCodes.validation, message);
  return value;
}
function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new DomainError(errorCodes.validation, '顺序无效。');
  return value;
}
function requiredNumber(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new DomainError(errorCodes.validation, message);
  return value;
}
function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(value, min, max, '成员温度微调无效。');
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new DomainError(errorCodes.validation, '成员状态无效。');
  return value;
}
function optionalText(value: unknown, max: number, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '文字内容无效。');
  const result = value.trim();
  if ((!allowEmpty && result.length === 0) || Array.from(result).length > max) throw new DomainError(errorCodes.validation, '文字内容长度无效。');
  return result;
}
