import { BriefcaseIcon, CaretDownIcon, CaretUpIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { canonicalMemberIdentityKey, publicRoleKey, publicRoleLabel, publicStatusCopy, uniqueByMemberKey, type PublicRoleKey } from './author-projection';
import { memberAvatarPath, memberAvatarPosition, memberDisplayName } from './member-avatars';
import { fetchEditorialDepartment, type EditorialDepartmentView } from './opening-api';

export function TeamPage(): React.JSX.Element {
  const [team, setTeam] = useState<EditorialDepartmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const projectedTeam = useMemo(() => {
    if (team === null) return null;
    const merged = new Map<string, EditorialMember & { publicRoleKey: PublicRoleKey }>();
    for (const { member, departmentKey } of team.departments.flatMap((department) => department.members.map((member) => ({ member, departmentKey: department.departmentKey })))) {
      const identityKey = canonicalMemberIdentityKey(member.memberKey);
      const canonicalRole = canonicalRoleForMemberKey(identityKey);
      const projectedRole = canonicalRole ?? publicRoleKey(member.role, member.role.trim().length === 0 ? departmentKey : undefined);
      const normalized = {
        ...member,
        memberKey: identityKey,
        role: projectedRole,
        publicRoleKey: projectedRole,
        presence: effectivePresence(member)
      };
      const previous = merged.get(identityKey);
      merged.set(identityKey, previous === undefined ? normalized : mergeMember(previous, normalized));
    }
    const departments = FIXED_DEPARTMENT_KEYS.flatMap((departmentKey) => {
      const members = [...merged.values()].filter((member) => member.publicRoleKey === departmentKey);
      return members.length === 0 ? [] : [{ departmentKey, name: publicDepartmentName(departmentKey), members }];
    });
    const members = uniqueByMemberKey(departments.flatMap((department) => department.members));
    return {
      departments,
      summary: {
        memberCount: members.length,
        readyCount: members.filter((member) => member.presence === 'ready').length,
        workingCount: members.filter((member) => member.presence === 'working').length,
        leaveCount: members.filter((member) => member.presence === 'leave').length,
        completedCount: members.reduce((total, member) => total + member.completedCount, 0)
      }
    };
  }, [team]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const load = async () => {
      try {
        const next = await fetchEditorialDepartment();
        if (stopped) return;
        setTeam(next);
        setError(null);
        setExpanded((current) => Object.keys(current).length > 0
          ? current
          : Object.fromEntries(next.departments.map((department) => [
            department.departmentKey,
            department.members.some((member) => effectivePresence(member) === 'working')
          ])));
        if (next.departments.some((department) => department.members.some((member) => effectivePresence(member) === 'working'))) timer = window.setTimeout(load, 2_500);
      } catch (reason) {
        if (stopped) return;
        setError('对不起，编辑部成员暂时没有加载出来，请稍后重试。');
        timer = window.setTimeout(load, 5_000);
      }
    };
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  return <section className="team-page-surface" aria-label="团队编辑部">
    {projectedTeam === null ? <div className="inline-task-recovery" role="status">正在召集编辑部成员…</div> : <>
      <div className="team-overview-strip">
        <span><UsersThreeIcon /></span>
        <div><strong>{projectedTeam.summary.memberCount}</strong><small>位成员</small></div>
        <div><strong>{projectedTeam.summary.workingCount}</strong><small>工作中</small></div>
        <div><strong>{projectedTeam.summary.readyCount}</strong><small>空闲</small></div>
        <div><strong>{projectedTeam.summary.leaveCount}</strong><small>暂离</small></div>
        <p>每位成员只显示一次；只有真实任务执行中，才会标为工作中。</p>
      </div>
      {error !== null && <div className="error-notice" role="status">{error}</div>}
      <div className="team-departments">{projectedTeam.departments.map((department) => {
        const isExpanded = expanded[department.departmentKey] === true;
        const workingCount = department.members.filter((member) => member.presence === 'working').length;
        const groupStatus = workingCount > 0
          ? `${workingCount} 人工作中`
          : department.members.every((member) => member.presence === 'leave') ? '暂时无人接单' : '当前空闲';
        const departmentName = publicDepartmentName(department.departmentKey);
        return <section className={`team-department ${isExpanded ? '' : 'collapsed'}`} key={department.departmentKey} aria-label={departmentName}>
          <button className="team-department-summary" type="button" aria-expanded={isExpanded} onClick={() => setExpanded((current) => ({ ...current, [department.departmentKey]: !isExpanded }))}>
            <span><BriefcaseIcon /><strong>{departmentName}</strong><small>{groupStatus}</small></span>
            <span className="team-summary-avatars">{department.members.slice(0, 7).map((member) => <i className={member.presence} key={member.memberKey} style={avatarStyle(member.memberKey)} />)}</span>
            {isExpanded ? <CaretUpIcon /> : <CaretDownIcon />}
          </button>
          {isExpanded && <div className="team-member-grid">{department.members.map((member) => <article className={`team-member-card ${member.presence}`} key={member.memberKey}>
            <div className="team-member-head"><i style={avatarStyle(member.memberKey)} aria-hidden="true"/><span><strong>{memberDisplayName(member.memberKey, member.displayName)}</strong><small>{publicRoleLabel(member.role, department.departmentKey)}</small></span><em>{member.presence === 'leave' ? '暂离' : member.presence === 'working' ? '工作中' : '空闲'}</em></div>
            <p>{member.presence === 'working'
              ? publicStatusCopy(member.currentWork ?? member.statusText, '正在处理本轮工作。')
              : member.presence === 'leave' ? '暂时无法接单。' : '当前空闲，可以接单。'}</p>
            <footer><span>{member.presence === 'working' ? '任务处理中' : '当前没有任务'}</span><b>完成 {member.completedCount} 项</b></footer>
          </article>)}</div>}
        </section>;
      })}</div>
    </>}
  </section>;
}

function publicDepartmentName(departmentKey: string): string {
  return ({
    chief_editor: '主编室',
    deputy_editor: '副编室',
    planning_writer: '策划编剧组',
    lead_writer: '主笔组',
    independent_reviewer: '独立审查组',
    continuity_editor: '资料记录组',
    visual_renderer: '封面制作组'
  } as Readonly<Record<string, string>>)[departmentKey] ?? '编辑部';
}

const FIXED_DEPARTMENT_KEYS: readonly PublicRoleKey[] = [
  'chief_editor',
  'deputy_editor',
  'planning_writer',
  'lead_writer',
  'independent_reviewer',
  'continuity_editor',
  'visual_renderer'
];

function canonicalRoleForMemberKey(memberKey: string): PublicRoleKey | null {
  if (memberKey.startsWith('chief-')) return 'chief_editor';
  if (memberKey.startsWith('deputy-')) return 'deputy_editor';
  if (memberKey.startsWith('planner-')) return 'planning_writer';
  if (memberKey.startsWith('writer-')) return 'lead_writer';
  if (memberKey.startsWith('review-')) return 'independent_reviewer';
  if (memberKey.startsWith('continuity-')) return 'continuity_editor';
  if (memberKey.startsWith('visual-')) return 'visual_renderer';
  return null;
}

function avatarStyle(memberKey: string): React.CSSProperties {
  const path = memberAvatarPath(memberKey);
  return path === null
    ? { backgroundPosition: memberAvatarPosition(memberKey) }
    : { backgroundImage: `url(${path})`, backgroundPosition: '50% 50%', backgroundSize: 'cover' };
}

type EditorialMember = EditorialDepartmentView['departments'][number]['members'][number];

function effectivePresence(member: EditorialMember): EditorialMember['presence'] {
  if (member.presence === 'leave') return 'leave';
  return member.presence === 'working' && member.currentWork?.trim() ? 'working' : 'ready';
}

function mergeMember<T extends EditorialMember>(previous: T, current: T): T {
  const rank = { ready: 1, leave: 2, working: 3 } as const;
  const primary = rank[current.presence] > rank[previous.presence] ? current : previous;
  return {
    ...previous,
    presence: primary.presence,
    statusText: primary.statusText,
    currentWork: primary.currentWork,
    completedCount: Math.max(previous.completedCount, current.completedCount)
  } as T;
}
