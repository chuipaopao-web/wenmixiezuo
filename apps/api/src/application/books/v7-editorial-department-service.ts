import type { DatabaseSync } from 'node:sqlite';
import {
  V7_OPENING_ROLES,
  V7_PLANNING_MEMBERS,
  V7_SETTING_MEMBERS,
  V7_VISUAL_MEMBERS,
  memberAvailability,
  type V7OpeningMemberDefinition
} from '@wenmi/v7-backend';
import { V7EditorialDepartmentRepository } from '../../infrastructure/db/repositories/v7-editorial-department-repository.js';

type Presence = 'ready' | 'working' | 'leave';
type FixedRoleKey = 'chief' | 'deputy' | 'writer' | 'continuity' | 'visual';

export interface V7EditorialDepartmentView {
  summary: { memberCount: number; readyCount: number; workingCount: number; leaveCount: number; completedCount: number };
  departments: Array<{
    departmentKey: FixedRoleKey;
    name: string;
    members: V7EditorialMemberView[];
  }>;
}

export interface V7EditorialMemberView {
  memberKey: string;
  displayName: string;
  role: string;
  responsibility: string;
  capabilities: string[];
  presence: Presence;
  statusText: string;
  currentWork: string | null;
  completedCount: number;
}

interface MemberBinding {
  memberKey: string;
  displayName: string;
  roleKey: FixedRoleKey;
  available: boolean;
  currentWork: string | null;
  completedCount: number;
  capability: string;
}

interface AggregatedMember {
  memberKey: string;
  displayName: string;
  roleKey: FixedRoleKey;
  available: boolean;
  currentWorks: string[];
  completedCount: number;
  capabilities: string[];
}

const ROLE_VIEW: Record<FixedRoleKey, { name: string; groupName: string; responsibility: string }> = {
  chief: {
    name: '主编', groupName: '主编组',
    responsibility: '把握作品方向、安排工作，并对重要方案进行最终审查。'
  },
  deputy: {
    name: '副编', groupName: '副编组',
    responsibility: '整理资料，检查结构和阅读体验，向主编提供独立意见。'
  },
  writer: {
    name: '编剧', groupName: '编剧组',
    responsibility: '根据任务设计开书资料、设定和全书路线，交付可直接使用的方案。'
  },
  continuity: {
    name: '记录编辑', groupName: '资料记录组',
    responsibility: '根据正式结算维护人物、事实、故事线和规划进度。'
  },
  visual: {
    name: '封面画师', groupName: '封面制作组',
    responsibility: '理解作品卖点，设计封面构图并制作、检查最终封面。'
  }
};

export class V7EditorialDepartmentService {
  private readonly repository: V7EditorialDepartmentRepository;

  public constructor(
    database: DatabaseSync,
    private readonly openingRoster: () => readonly V7OpeningMemberDefinition[],
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>,
    private readonly imageConfigured: boolean
  ) {
    this.repository = new V7EditorialDepartmentRepository(database);
  }

  public get(ownerId: string): V7EditorialDepartmentView {
    const membersByName = new Map<string, AggregatedMember>();
    for (const binding of [...this.openingBindings(ownerId), ...this.settingBindings(ownerId), ...this.visualBindings(ownerId)]) {
      mergeBinding(membersByName, binding, true);
    }
    for (const binding of this.planningBindings(ownerId)) mergeBinding(membersByName, binding, false);

    const members = [...membersByName.values()].map(toEditorialMember);
    const departments = (['chief', 'deputy', 'writer', 'continuity', 'visual'] as const).map((roleKey) => ({
      departmentKey: roleKey,
      name: ROLE_VIEW[roleKey].groupName,
      members: members.filter((member) => member.role === ROLE_VIEW[roleKey].name)
    })).filter((department) => department.members.length > 0);
    return {
      summary: {
        memberCount: members.length,
        readyCount: members.filter((member) => member.presence === 'ready').length,
        workingCount: members.filter((member) => member.presence === 'working').length,
        leaveCount: members.filter((member) => member.presence === 'leave').length,
        completedCount: members.reduce((total, member) => total + member.completedCount, 0)
      },
      departments
    };
  }

  private openingBindings(ownerId: string): MemberBinding[] {
    const roles = new Map(V7_OPENING_ROLES.map((role) => [role.roleKey, role]));
    return this.openingRoster().map((member) => {
      const available = memberAvailability(member, this.credentials).available && member.enabledByDefault;
      const openingWork = this.openingWork(ownerId, member.memberKey);
      const coverWork = member.roleKey === 'chief_editor' ? this.coverWork(ownerId, member.memberKey, false) : null;
      if (!roles.has(member.roleKey)) throw new Error(`开书岗位不存在：${member.roleKey}`);
      return {
        memberKey: member.memberKey,
        displayName: member.displayName,
        roleKey: member.roleKey === 'chief_editor' ? 'chief' : 'writer',
        available,
        currentWork: openingWork ?? coverWork,
        completedCount: this.repository.openingSuccessCount(ownerId, member.memberKey)
          + (member.roleKey === 'chief_editor' ? this.repository.chiefCoverSuccessCount(ownerId, member.memberKey) : 0),
        capability: '开书设计'
      };
    });
  }

  private settingBindings(ownerId: string): MemberBinding[] {
    return V7_SETTING_MEMBERS.map((member) => {
      const hasCredential = member.model.plan === 'agent' ? this.credentials.agentPlan : this.credentials.codingPlan;
      return {
        memberKey: member.memberKey,
        displayName: member.displayName,
        roleKey: member.roleKey === 'chief_editor' ? 'chief' : member.roleKey === 'deputy_editor' ? 'deputy' : 'writer',
        available: member.enabledByDefault && this.repository.settingMemberEnabled(member.memberKey) && hasCredential,
        currentWork: this.settingWork(ownerId, member.memberKey),
        completedCount: this.repository.settingSuccessCount(ownerId, member.memberKey),
        capability: '设定设计'
      };
    });
  }

  private visualBindings(ownerId: string): MemberBinding[] {
    return V7_VISUAL_MEMBERS.map((member) => {
      return {
        memberKey: member.memberKey,
        displayName: member.displayName,
        roleKey: 'visual',
        available: member.enabledByDefault && this.imageConfigured,
        currentWork: this.coverWork(ownerId, member.memberKey, false),
        completedCount: this.repository.visualCoverSuccessCount(ownerId, member.memberKey),
        capability: '封面设计'
      };
    });
  }

  private planningBindings(ownerId: string): MemberBinding[] {
    return V7_PLANNING_MEMBERS.map((member) => ({
      memberKey: member.memberKey,
      displayName: member.displayName,
      roleKey: planningFallbackRole(member.roleKey),
      available: member.enabledByDefault && (member.model.plan === 'agent' ? this.credentials.agentPlan : this.credentials.codingPlan),
      currentWork: this.planningWork(ownerId, member.memberKey),
      completedCount: this.repository.planningSuccessCount(ownerId, member.memberKey),
      capability: member.roleKey === 'continuity_editor' ? '进度维护' : '全书路线'
    }));
  }

  private openingWork(ownerId: string, memberKey: string): string | null {
    const row = this.repository.openingWork(ownerId, memberKey);
    if (row === undefined) return null;
    const action = row.nodeKey.includes('review') ? '审查开书资料' : row.nodeKey.includes('package') ? '设计开书资料' : '理解开书想法';
    return `${action}：${short(row.ideaText)}`;
  }

  private settingWork(ownerId: string, memberKey: string): string | null {
    const itemLabel = this.repository.settingWork(ownerId, memberKey);
    return itemLabel === null ? null : `设计设定：${itemLabel}`;
  }

  private planningWork(ownerId: string, memberKey: string): string | null {
    const nodeKey = this.repository.planningWork(ownerId, memberKey);
    if (nodeKey === null) return null;
    if (nodeKey.includes('story_route')) return '设计全书路线';
    if (nodeKey.includes('review') || nodeKey.includes('fusion')) return '审查全书路线';
    if (nodeKey.includes('method')) return '筛选全书方法';
    if (nodeKey.includes('maintenance')) return '更新故事进度';
    return '整理故事框架';
  }

  private coverWork(ownerId: string, memberKey: string, planner: boolean): string | null {
    const title = this.repository.coverWork(ownerId, planner ? null : memberKey);
    return title === null ? null : `制作《${short(title, 18)}》封面`;
  }
}

function mergeBinding(members: Map<string, AggregatedMember>, binding: MemberBinding, maySetFixedRole: boolean): void {
  const current = members.get(binding.displayName);
  if (current === undefined) {
    members.set(binding.displayName, {
      memberKey: binding.memberKey,
      displayName: binding.displayName,
      roleKey: binding.roleKey,
      available: binding.available,
      currentWorks: binding.currentWork === null ? [] : [binding.currentWork],
      completedCount: binding.completedCount,
      capabilities: [binding.capability]
    });
    return;
  }
  current.available ||= binding.available;
  current.completedCount += binding.completedCount;
  if (binding.currentWork !== null && !current.currentWorks.includes(binding.currentWork)) current.currentWorks.push(binding.currentWork);
  if (!current.capabilities.includes(binding.capability)) current.capabilities.push(binding.capability);
  if (maySetFixedRole && fixedRolePriority(binding.roleKey) < fixedRolePriority(current.roleKey)) current.roleKey = binding.roleKey;
}

function toEditorialMember(member: AggregatedMember): V7EditorialMemberView {
  const currentWork = member.currentWorks.length === 0 ? null : member.currentWorks.join('；');
  const presence: Presence = currentWork !== null ? 'working' : member.available ? 'ready' : 'leave';
  const statusText = presence === 'leave'
    ? '抱歉，我今天请假，工作已经交给在岗同事。'
    : presence === 'working'
      ? `我正在处理${currentWork}，完成后会马上交稿。`
      : '我现在待命，有任务会马上接手。';
  return {
    memberKey: member.memberKey,
    displayName: member.displayName,
    role: ROLE_VIEW[member.roleKey].name,
    responsibility: ROLE_VIEW[member.roleKey].responsibility,
    capabilities: capabilityOrder(member.capabilities),
    presence,
    statusText,
    currentWork,
    completedCount: member.completedCount
  };
}

function planningFallbackRole(roleKey: (typeof V7_PLANNING_MEMBERS)[number]['roleKey']): FixedRoleKey {
  if (roleKey === 'chief_editor') return 'chief';
  if (roleKey === 'continuity_editor') return 'continuity';
  return 'writer';
}

function fixedRolePriority(roleKey: FixedRoleKey): number {
  return ({ chief: 0, deputy: 1, writer: 2, continuity: 3, visual: 4 } as const)[roleKey];
}

function capabilityOrder(values: string[]): string[] {
  const order = ['开书设计', '设定设计', '全书路线', '进度维护', '封面设计'];
  return [...new Set(values)].toSorted((left, right) => order.indexOf(left) - order.indexOf(right));
}

function short(value: string, maximum = 24): string {
  const characters = Array.from(value.trim());
  return characters.length <= maximum ? characters.join('') : `${characters.slice(0, maximum).join('')}…`;
}
