import type { BookScope } from '../../domain/scope.js';
import { creativeMemberContracts } from '../../contracts/agent-team-v2.js';
import { parseSettingProposalStructure, type SettingProposalStructure } from '@wenmi/contracts';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { prepareEffectiveOutput } from '../presentation/author-output-service.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';

type MemberStatus = 'preparing' | 'working' | 'completed' | 'failed' | 'unavailable' | 'paused';
const screenwriterRoleKeys = [
  'lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter'] as const;

export interface SettingCollaborationView {
  item: ReturnType<SettingOutlineWorkspaceService['list']>[number];
  screenwriters: Array<{
    agentId: string | null;
    memberName: string;
    roleKey: typeof screenwriterRoleKeys[number];
    availability: 'available' | 'unavailable';
    availabilityReason: string | null;
    highCompute: boolean;
  }>;
  panel: null | {
    recoveryKey: string;
    taskStatus: string;
    discussionStatus: string;
    createdAt: string;
    updatedAt: string;
    proposals: Array<{
      number: number;
      proposalId: string;
      agentId: string | null;
      memberName: string;
      roleKey: string | null;
      content: string;
      benefits: string[];
      costs: string[];
      createdAt: string;
      fragments: Array<{
        fragmentId: string;
        fragmentNo: number;
        text: string;
        implicit: boolean;
      }>;
    }>;
    members: Array<{
      agentId: string;
      memberName: string;
      roleKey: string;
      status: MemberStatus;
      contextSummary: string;
      outputSummary: string | null;
      errorSummary: string | null;
      retryable: boolean;
      lastAttemptedAt: string | null;
    }>;
  };
  revisionTask: null | {
    recoveryKey: string;
    status: string;
    updatedAt: string;
  };
  historyCount: number;
  fusionDraft: null | {
    selectedFragmentIds: string[];
    segments: Array<{
      text: string;
      source: 'fragment' | 'stitch';
      fragmentId: string | null;
      memberName: string | null;
    }>;
    content: string;
    createdAt: string;
  };
  impact: {
    changesCanon: false;
    changesManuscript: false;
    formalVersionTiming: 'setting_baseline_confirmation';
  };
}

export class SettingCollaborationService {
  public constructor(
    private readonly repository: SettingCollaborationRepository,
    private readonly workspace: SettingOutlineWorkspaceService
  ) {}

  public inspect(scope: BookScope, itemKey: string): SettingCollaborationView {
    const item = this.workspace.list(scope).find((candidate) => candidate.itemKey === itemKey);
    if (item === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前设定项不存在，或者不属于这本书', {}, false, 404);
    }
    const panel = this.repository.latestPanel(scope, itemKey);
    const revisionTask = this.repository.latestRevisionTask(scope, itemKey);
    const proposalRows = panel === undefined
      ? []
      : item.status === '已确认'
        ? this.repository.proposals(scope, panel.discussion_id)
        : this.repository.latestProposalsByRole(scope, itemKey);
    const fragmentRows = this.repository.fragmentsByProposalIds(
      scope,
      proposalRows.map((proposal) => proposal.proposal_id)
    );
    const fusionRow = this.repository.latestFusionDraft(scope, itemKey);
    const proposals = proposalRows.map((proposal, index) => ({
      number: index + 1,
      proposalId: proposal.proposal_id,
      agentId: proposal.sender_agent_id,
      memberName: proposal.member_name?.trim() || '成员' + (index + 1),
      roleKey: proposal.role_key,
      content: proposalContent(proposal.content),
      benefits: proposalStructure(proposal.content)?.benefits ?? [],
      costs: proposalStructure(proposal.content)?.costs ?? [],
      createdAt: proposal.created_at,
      fragments: fragmentRows
        .filter((fragment) => fragment.proposal_id === proposal.proposal_id)
        .map((fragment) => ({
          fragmentId: fragment.fragment_id,
          fragmentNo: fragment.fragment_no,
          text: fragment.fragment_text,
          implicit: fragment.implicit === 1
        }))
    }));
    const screenwriterRows = this.repository.screenwriterOptions(scope);
    const screenwriters = screenwriterRoleKeys.map((roleKey) => {
      const row = screenwriterRows.find((candidate) => candidate.role_key === roleKey);
      const contract = creativeMemberContracts.find((candidate) => candidate.roleKey === roleKey)!;
      const activationAvailable = row !== undefined
        && row.enabled === 1 && ['idle', 'standby'].includes(row.activation_state);
      return {
        agentId: row?.agent_id ?? null,
        memberName: row?.member_name ?? contract.memberName,
        roleKey,
        availability: activationAvailable ? 'available' as const : 'unavailable' as const,
        availabilityReason: activationAvailable
          ? null
          : row === undefined
            ? '成员尚未配置'
            : row.enabled !== 1 || row.activation_state === 'disabled'
              ? '成员已停用'
              : row.activation_state === 'paused' ? '成员已暂停' : '成员当前不可用',
        highCompute: roleKey === 'senior_screenwriter'
      };
    });
    return {
      item,
      screenwriters,
      panel: panel === undefined ? null : {
        recoveryKey: panel.task_id,
        taskStatus: panel.task_status,
        discussionStatus: panel.discussion_status,
        createdAt: panel.created_at,
        updatedAt: panel.updated_at,
        proposals,
        members: this.repository.panelMembers(scope, panel.discussion_id).map((member) => {
          const proposal = proposalRows.find((candidate) => candidate.sender_agent_id === member.agent_id);
          return {
            agentId: member.agent_id,
            memberName: member.member_name,
            roleKey: member.role_key,
            status: member.run_status ?? memberStatus(panel.task_status, member.responded === 1),
            contextSummary: '本书完整开书资料 · 当前设定项 · 已确认的直接依赖设定 · 作者本项原话',
            outputSummary: proposal === undefined ? null : proposalContent(proposal.content).slice(0, 160),
            // 原始模型诊断保留在discussion_participants供独立后台追溯；作者页面只看
            // 业务影响和恢复动作，不能暴露供应商、模型、Token或思考块协议。
            errorSummary: authorFacingMemberError(member.error_summary, member.run_status),
            retryable: member.run_status === 'failed' || member.run_status === 'unavailable',
            lastAttemptedAt: member.last_attempted_at
          };
        })
      },
      revisionTask: revisionTask === undefined ? null : {
        recoveryKey: revisionTask.task_id,
        status: revisionTask.status,
        updatedAt: revisionTask.updated_at
      },
      historyCount: this.repository.panelCount(scope, itemKey),
      fusionDraft: fusionRow === undefined ? null : {
        selectedFragmentIds: JSON.parse(fusionRow.selected_fragment_ids_json) as string[],
        segments: JSON.parse(fusionRow.segments_json) as Array<{
          text: string;
          source: 'fragment' | 'stitch';
          fragmentId: string | null;
          memberName: string | null;
        }>,
        content: fusionRow.content_text,
        createdAt: fusionRow.created_at
      },
      impact: {
        changesCanon: false,
        changesManuscript: false,
        formalVersionTiming: 'setting_baseline_confirmation'
      }
    };
  }
}

function proposalContent(value: string): string {
  return prepareEffectiveOutput(value).visibleContent.trim();
}

function proposalStructure(value: string): SettingProposalStructure | null {
  const fenced = value.match(/```(?:json)?\s*\n([\s\S]*?)\n?\s*```/u)?.[1];
  for (const candidate of [fenced, value]) {
    if (candidate === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const root = parsed as Record<string, unknown>;
    const fields = typeof root.fields === 'object' && root.fields !== null && !Array.isArray(root.fields)
      ? root.fields as Record<string, unknown>
      : root;
    try {
      return parseSettingProposalStructure(fields);
    } catch {
      return null;
    }
  }
  return null;

}

function authorFacingMemberError(errorSummary: string | null, status: string | null): string | null {
  if (errorSummary === null) return null;
  if (status === 'unavailable' || /(?:未配置|已停用|已暂停|当前不可用)/u.test(errorSummary)) {
    return '这位成员当前不可用，请选择其他成员或稍后只重试这位。';
  }
  return '这位成员本次没有形成可用方案，请只重试这位。';
}

function memberStatus(taskStatus: string, responded: boolean): MemberStatus {
  if (responded) return 'completed';
  if (['failed', 'interrupted', 'cancelled', 'blocked'].includes(taskStatus)) return 'failed';
  if (taskStatus === 'paused') return 'paused';
  if (taskStatus === 'working') return 'working';
  return 'preparing';
}
