import type { BookScope } from '../../domain/scope.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { prepareEffectiveOutput } from '../presentation/author-output-service.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';

type MemberStatus = 'preparing' | 'working' | 'completed' | 'failed' | 'paused';

export interface SettingCollaborationView {
  item: ReturnType<SettingOutlineWorkspaceService['list']>[number];
  panel: null | {
    taskId: string;
    discussionId: string;
    taskStatus: string;
    discussionStatus: string;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
    proposals: Array<{
      number: number;
      proposalId: string;
      agentId: string | null;
      memberName: string;
      roleKey: string | null;
      modelProvider: string | null;
      modelId: string | null;
      content: string;
      decisionId: string | null;
      createdAt: string;
    }>;
    members: Array<{
      agentId: string;
      memberName: string;
      roleKey: string;
      modelProvider: string;
      modelId: string;
      status: MemberStatus;
      contextSummary: string;
      outputSummary: string | null;
    }>;
  };
  revisionTask: null | {
    taskId: string;
    status: string;
    errorCode: string | null;
    updatedAt: string;
  };
  historyCount: number;
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
    const proposalRows = panel === undefined ? [] : this.repository.proposals(scope, panel.discussion_id);
    const proposals = proposalRows.map((proposal, index) => ({
      number: index + 1,
      proposalId: proposal.proposal_id,
      agentId: proposal.sender_agent_id,
      memberName: proposal.member_name?.trim() || '成员' + (index + 1),
      roleKey: proposal.role_key,
      modelProvider: proposal.model_provider,
      modelId: proposal.model_id,
      content: proposalContent(proposal.content),
      decisionId: proposal.decision_id,
      createdAt: proposal.created_at
    }));
    return {
      item,
      panel: panel === undefined ? null : {
        taskId: panel.task_id,
        discussionId: panel.discussion_id,
        taskStatus: panel.task_status,
        discussionStatus: panel.discussion_status,
        errorCode: panel.error_code,
        createdAt: panel.created_at,
        updatedAt: panel.updated_at,
        proposals,
        members: this.repository.panelMembers(scope, panel.discussion_id).map((member) => {
          const proposal = proposalRows.find((candidate) => candidate.sender_agent_id === member.agent_id);
          return {
            agentId: member.agent_id,
            memberName: member.member_name,
            roleKey: member.role_key,
            modelProvider: member.model_provider,
            modelId: member.model_id,
            status: memberStatus(panel.task_status, member.responded === 1),
            contextSummary: '本书完整开书资料 · 当前设定项 · 已确认的直接依赖设定 · 作者本项原话',
            outputSummary: proposal === undefined ? null : proposalContent(proposal.content).slice(0, 160)
          };
        })
      },
      revisionTask: revisionTask === undefined ? null : {
        taskId: revisionTask.task_id,
        status: revisionTask.status,
        errorCode: revisionTask.error_code,
        updatedAt: revisionTask.updated_at
      },
      historyCount: this.repository.panelCount(scope, itemKey),
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

function memberStatus(taskStatus: string, responded: boolean): MemberStatus {
  if (responded) return 'completed';
  if (['failed', 'interrupted', 'cancelled', 'blocked'].includes(taskStatus)) return 'failed';
  if (taskStatus === 'paused') return 'paused';
  if (taskStatus === 'working') return 'working';
  return 'preparing';
}
