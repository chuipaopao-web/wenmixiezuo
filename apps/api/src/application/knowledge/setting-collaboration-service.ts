import type { BookScope } from '../../domain/scope.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';

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
      throw new DomainError(errorCodes.operationIncomplete, '��ǰ�趨����ڻ������Ȿ��', {}, false, 404);
    }
    const panel = this.repository.latestPanel(scope, itemKey);
    const revisionTask = this.repository.latestRevisionTask(scope, itemKey);
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
        proposals: this.repository.proposals(scope, panel.discussion_id).map((proposal, index) => ({
          number: index + 1,
          proposalId: proposal.proposal_id,
          agentId: proposal.sender_agent_id,
          memberName: proposal.member_name?.trim() || '��Ա' + (index + 1),
          roleKey: proposal.role_key,
          modelProvider: proposal.model_provider,
          modelId: proposal.model_id,
          content: proposalContent(proposal.content),
          decisionId: proposal.decision_id,
          createdAt: proposal.created_at
        }))
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
  return value.trim();
}
