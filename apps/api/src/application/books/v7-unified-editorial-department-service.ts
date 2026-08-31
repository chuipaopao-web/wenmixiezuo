import type { DatabaseSync } from 'node:sqlite';
import {
  V7_ROLE_CONTRACTS,
  type V7EffectiveMember,
  type V7FixedRoleKey
} from '@wenmi/v7-backend';
import { V7EditorialDepartmentRepository } from '../../infrastructure/db/repositories/v7-editorial-department-repository.js';

type Presence = 'ready' | 'working' | 'leave';
export interface V7UnifiedEditorialMemberView {
  memberKey: string; displayName: string; role: string; responsibility: string; capabilities: string[];
  presence: Presence; statusText: string; currentWork: string | null; completedCount: number;
}
export interface V7UnifiedEditorialDepartmentView {
  summary: { memberCount: number; readyCount: number; workingCount: number; leaveCount: number; completedCount: number };
  departments: Array<{ departmentKey: V7FixedRoleKey; name: string; members: V7UnifiedEditorialMemberView[] }>;
}

const DEPARTMENTS: Record<V7FixedRoleKey, string> = {
  chief_editor: '主编室', deputy_editor: '副编室', planning_writer: '策划编剧组', lead_writer: '主笔组',
  independent_reviewer: '独立审查组', continuity_editor: '资料记录组',
  visual_renderer: '封面制作组'
};

// The configured model gateways time out within 15 minutes. Give the database a
// small reconciliation margin, but never let an abandoned call keep a member
// "working" forever on the author-facing team page.
const ACTIVE_MODEL_CALL_WINDOW_MS = 20 * 60 * 1_000;

export class V7UnifiedEditorialDepartmentService {
  private readonly repository: V7EditorialDepartmentRepository;
  public constructor(
    database: DatabaseSync,
    private readonly members: () => readonly V7EffectiveMember[],
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>,
    private readonly imageConfigured: boolean
  ) { this.repository = new V7EditorialDepartmentRepository(database); }

  public get(ownerId: string): V7UnifiedEditorialDepartmentView {
    const activeSince = new Date(Date.now() - ACTIVE_MODEL_CALL_WINDOW_MS).toISOString();
    const members = this.members().map((member) => this.memberView(ownerId, member, activeSince));
    return {
      summary: {
        memberCount: members.length,
        readyCount: members.filter((member) => member.presence === 'ready').length,
        workingCount: members.filter((member) => member.presence === 'working').length,
        leaveCount: members.filter((member) => member.presence === 'leave').length,
        completedCount: members.reduce((total, member) => total + member.completedCount, 0)
      },
      departments: V7_ROLE_CONTRACTS.map((role) => ({
        departmentKey: role.roleKey, name: DEPARTMENTS[role.roleKey],
        members: members.filter((member) => member.role === role.publicName)
      })).filter((department) => department.members.length > 0)
    };
  }

  private memberView(ownerId: string, member: V7EffectiveMember, activeSince: string): V7UnifiedEditorialMemberView {
    const contract = V7_ROLE_CONTRACTS.find((role) => role.roleKey === member.fixedRoleKey);
    if (contract === undefined) throw new Error(`成员岗位未登记：${member.fixedRoleKey}`);
    const available = member.enabled && (member.model.plan === 'coding' ? this.credentials.codingPlan
      : member.model.plan === 'agent' ? this.credentials.agentPlan : this.imageConfigured);
    const works = this.repository.currentWorks(ownerId, member.memberKey, activeSince);
    const currentWork = works.length === 0 ? null : works.join('；');
    const presence: Presence = currentWork !== null ? 'working' : available ? 'ready' : 'leave';
    return {
      memberKey: member.memberKey, displayName: member.displayName, role: contract.publicName,
      responsibility: contract.publicResponsibility, capabilities: [...contract.capabilities], presence,
      statusText: presence === 'working' ? `我正在处理${currentWork}，完成后马上交稿。`
        : presence === 'leave' ? '对不起，我现在请假，工作会自动交给在岗同事。'
          : '我现在待命，有任务会马上接手。',
      currentWork,
      completedCount: this.repository.successCount(ownerId, member.memberKey)
    };
  }
}
