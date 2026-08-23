import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, ClockIcon, GaugeIcon, UsersThreeIcon } from '@phosphor-icons/react';
import type { EditorialMemberView, EditorialRolePoolView } from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { AgentAvatar } from '../shared/AgentAvatar';
import { V6ErrorState, V6LoadingState, V6PageHeader } from './V6Shared';
import { fetchEditorialTeam } from './v6-api';

export function EditorialTeamWorkspace({ bookId }: { bookId: string }): React.JSX.Element {
  const [pools, setPools] = useState<EditorialRolePoolView[] | null>(null);
  const [activeRole, setActiveRole] = useState<string>('chief_editor');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { const result = await fetchEditorialTeam(bookId, signal); setPools(result.pools); setError(null); }
    catch (reason) { if (signal?.aborted !== true) setError(authorErrorFromUnknown(reason, '编辑部加载失败')); }
  }, [bookId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const members = useMemo(() => pools?.flatMap((pool) => pool.members) ?? [], [pools]);
  const activePool = pools?.find((pool) => pool.roleKey === activeRole) ?? pools?.[0] ?? null;

  if (pools === null && error === null) return <V6LoadingState label="正在召集本书编辑部…" />;
  if (pools === null) return <V6ErrorState message={error ?? '编辑部暂时无法打开'} onRetry={() => void load()} />;

  return <section className="v6-page v6-team-page">
    <V6PageHeader eyebrow="本书协作成员" title="AI 编辑部" description="7 类岗位、初始 25 名成员。每个节点默认一人，作者可以更换或追加同岗位成员独立出方案。" />
    <section className="v6-team-summary">
      <div><UsersThreeIcon /><span><strong>{members.length}</strong><small>当前成员</small></span></div>
      <div><CheckCircleIcon /><span><strong>{members.filter((member) => member.status === 'available').length}</strong><small>现在可用</small></span></div>
      <div><ClockIcon /><span><strong>{members.filter((member) => member.status === 'working').length}</strong><small>工作中</small></span></div>
      <div><GaugeIcon /><span><strong>7 类</strong><small>岗位均可选择</small></span></div>
    </section>
    <div className="v6-team-layout">
      <aside className="v6-role-list" aria-label="岗位列表">{pools.map((pool) => <button type="button" key={pool.roleKey}
        className={activePool?.roleKey === pool.roleKey ? 'active' : ''} onClick={() => setActiveRole(pool.roleKey)}>
        <span>{pool.roleLabel}</span><small>{pool.members.length} 位成员</small>
      </button>)}</aside>
      <section className="v6-role-members">
        {activePool !== null && <header><div><span>{roleNumber(activePool.roleKey)}</span><h3>{activePool.roleLabel}</h3><p>{roleDescription(activePool.roleKey)}</p></div>
          <small>目标人数由后台配置 · 当前 {activePool.desiredCount} 人</small></header>}
        <div className="v6-team-member-grid">{activePool?.members.map((member) => <TeamMemberCard key={member.memberId} member={member} />)}</div>
      </section>
    </div>
    <p className="v6-team-footnote">同岗位、同批次成员收到完全相同的作者输入、资料包、Skill 与模板；各自独立出方案。闲置成员不会调用模型，也不会产生消耗。25 名只是初始配置，后台可继续增加。</p>
  </section>;
}

function TeamMemberCard({ member }: { member: EditorialMemberView }): React.JSX.Element {
  return <article className="v6-team-member">
    <AgentAvatar roleKey={member.avatarKey || member.roleKey} roleName={member.displayName} />
    <div><header><h4>{member.displayName}</h4><span data-status={member.status}>{statusLabel(member.status)}</span></header>
      <p>{member.roleLabel} · {member.supplierCompany}</p>
      <footer><span data-tier={member.baseCostTier}>基础消耗 {costLabel(member.baseCostTier)}</span></footer>
    </div>
  </article>;
}

function roleDescription(role: string): string {
  return ({
    chief_editor: '负责跨层级整理、正式里程碑审核与全书一致性。',
    deputy_editor: '负责当前局部对象的整理、融合和校正，不改动已确认全局结构。',
    screenwriter: '负责设定、故事线、分卷、事件和角色的创意方案。',
    writer: '负责表达方案、章纲与完整正文候选。',
    fact_reviewer: '独立检查事实、连续性、因果和正式资料冲突。',
    literary_reviewer: '独立检查文字、节奏、人物表达与文学完成度。',
    experience_reviewer: '独立检查读者体验、信息释放、期待与阅读阻力。'
  } as Record<string, string>)[role] ?? '';
}

function roleNumber(role: string): string {
  const order = ['chief_editor', 'deputy_editor', 'screenwriter', 'writer', 'fact_reviewer', 'literary_reviewer', 'experience_reviewer'];
  return String(order.indexOf(role) + 1).padStart(2, '0');
}

function statusLabel(status: EditorialMemberView['status']): string {
  return ({ available: '空闲', working: '工作中', completed: '等待下次任务', failed: '失败 · 可恢复', unavailable: '停用 · 不可选' } as const)[status];
}
function costLabel(tier: EditorialMemberView['baseCostTier']): string { return tier === 'low' ? '低' : tier === 'medium' ? '中' : '高'; }
