import {
  V7_OPENING_ROLES,
  memberAvailability,
  type V7OpeningMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7OpeningAgentGovernanceConflictError,
  V7OpeningAgentGovernanceRepository,
  V7OpeningAgentGovernanceValidationError,
  type V7OpeningAgentGovernancePatch,
  type V7OpeningAgentGovernanceSnapshot
} from '../../infrastructure/db/repositories/v7-opening-agent-governance-repository.js';

export interface V7OpeningAgentGovernanceView {
  summary: {
    roleCount: number;
    memberCount: number;
    enabledMemberCount: number;
    unavailableMemberCount: number;
  };
  credentials: {
    codingPlanConfigured: boolean;
    agentPlanConfigured: boolean;
  };
  roles: Array<{
    roleKey: string;
    publicName: string;
    responsibility: string;
    revision: number;
    updatedAt: string;
      members: Array<{
      memberKey: string;
      displayName: string;
      modelId: string;
      plan: 'coding' | 'agent';
      planName: 'Coding Plan' | 'Agent Plan';
      enabled: boolean;
      defaultForRole: boolean;
      fallbackPriority: number;
      credential: { configured: boolean; message: string };
      basePrompt: string;
      promptInstruction: string;
    }>;
  }>;
}

export class V7OpeningAgentGovernanceService {
  public constructor(
    private readonly repository: V7OpeningAgentGovernanceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>
  ) {}

  public get(): V7OpeningAgentGovernanceView {
    return this.view(this.repository.snapshot());
  }

  public effectiveRoster(): V7OpeningMemberDefinition[] {
    return this.repository.snapshot().members;
  }

  public update(
    actorUserId: string,
    memberKey: string,
    body: Readonly<{
      expectedRevision?: unknown;
      enabled?: unknown;
      defaultForRole?: unknown;
      fallbackPriority?: unknown;
      promptInstruction?: unknown;
      reason?: unknown;
    }>
  ): V7OpeningAgentGovernanceView {
    const expectedRevision = integer(body.expectedRevision, '请刷新成员信息后再修改。', 1, Number.MAX_SAFE_INTEGER);
    const patch = normalizePatch(body);
    const reason = normalizeReason(body.reason);
    try {
      return this.view(this.repository.update({
        memberKey,
        expectedRevision,
        patch,
        actorUserId,
        eventId: this.ids.next(),
        reason,
        now: this.clock.now().toISOString()
      }));
    } catch (error) {
      if (error instanceof V7OpeningAgentGovernanceConflictError) {
        throw new DomainError('V7_AGENT_GOVERNANCE_CONFLICT', error.message, {}, true, 409);
      }
      if (error instanceof V7OpeningAgentGovernanceValidationError) {
        throw new DomainError(errorCodes.validation, error.message, {}, false, 400);
      }
      throw error;
    }
  }

  private view(snapshot: V7OpeningAgentGovernanceSnapshot): V7OpeningAgentGovernanceView {
    const availability = new Map(snapshot.members.map((member) => [
      member.memberKey,
      memberAvailability(member, this.credentials)
    ]));
    return {
      summary: {
        roleCount: snapshot.roles.length,
        memberCount: snapshot.members.length,
        enabledMemberCount: snapshot.members.filter((member) => member.enabledByDefault).length,
        unavailableMemberCount: snapshot.members.filter((member) => !availability.get(member.memberKey)?.available).length
      },
      credentials: {
        codingPlanConfigured: this.credentials.codingPlan,
        agentPlanConfigured: this.credentials.agentPlan
      },
      roles: snapshot.roles.map((role) => {
        const definition = V7_OPENING_ROLES.find((candidate) => candidate.roleKey === role.roleKey);
        if (definition === undefined) throw new Error(`V7岗位定义缺失：${role.roleKey}`);
        return {
          roleKey: role.roleKey,
          publicName: definition.publicName,
          responsibility: definition.publicResponsibility,
          revision: role.revision,
          updatedAt: role.updatedAt,
          members: role.members.map((member) => {
            const state = availability.get(member.memberKey)!;
            return {
              memberKey: member.memberKey,
              displayName: member.displayName,
              modelId: member.model.modelId,
              plan: member.model.plan,
              planName: member.model.plan === 'coding' ? 'Coding Plan' as const : 'Agent Plan' as const,
              enabled: member.enabledByDefault,
              defaultForRole: member.defaultForRole,
              fallbackPriority: member.fallbackPriority,
              credential: {
                configured: state.available,
                message: state.available ? '套餐凭据已配置' : (state.reason ?? '套餐凭据未配置')
              },
              basePrompt: definition.basePrompt,
              promptInstruction: member.promptInstruction
            };
          })
        };
      })
    };
  }
}

function normalizePatch(input: Readonly<{
  enabled?: unknown;
  defaultForRole?: unknown;
  fallbackPriority?: unknown;
  promptInstruction?: unknown;
}>): V7OpeningAgentGovernancePatch {
  const patch: {
    enabled?: boolean;
    defaultForRole?: boolean;
    fallbackPriority?: number;
    promptInstruction?: string;
  } = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new DomainError(errorCodes.validation, '上岗状态无效。');
    patch.enabled = input.enabled;
  }
  if (input.defaultForRole !== undefined) {
    if (typeof input.defaultForRole !== 'boolean') throw new DomainError(errorCodes.validation, '默认成员状态无效。');
    patch.defaultForRole = input.defaultForRole;
  }
  if (input.fallbackPriority !== undefined) {
    patch.fallbackPriority = integer(input.fallbackPriority, '备用顺序无效。', 1, 99);
  }
  if (input.promptInstruction !== undefined) {
    throw new DomainError(
      errorCodes.validation,
      '成员不再保存永久创作倾向，请在提示词与上下文中心调整岗位、工位或题材人设版本。'
    );
  }
  if (Object.keys(patch).length === 0) throw new DomainError(errorCodes.validation, '没有需要保存的成员调整。');
  return patch;
}

function normalizeReason(value: unknown): string {
  if (value === undefined || value === null || value === '') return '管理员调整创作成员';
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '调整说明无效。');
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 300) {
    throw new DomainError(errorCodes.validation, '调整说明应为1至300字。');
  }
  return normalized;
}

function integer(value: unknown, message: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DomainError(errorCodes.validation, message);
  }
  return value;
}
