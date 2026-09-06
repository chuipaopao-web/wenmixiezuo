import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, CheckCircle, Robot, WarningCircle } from '@phosphor-icons/react';
import { publicMemberIdentity, V7_MEMBER_AVATAR_SIZE, V7_MEMBER_AVATAR_SPRITE } from '../../backend/agent-governance/member-identities';
import {
  fetchV7UnifiedAgentGovernance,
  updateV7UnifiedAgentMember,
  updateV7UnifiedTaskPolicy,
  type V7UnifiedAgentGovernance
} from './platform-api';

export function UnifiedAgentGovernance(): React.JSX.Element {
  const [data, setData] = useState<V7UnifiedAgentGovernance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setData(await fetchV7UnifiedAgentGovernance(signal)); setError(null); }
    catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '成员配置暂时无法读取。'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const updateMember = async (memberKey: string, patch: Record<string, unknown>, message: string) => {
    if (data === null) return;
    setBusy(memberKey); setError(null); setNotice(null);
    try {
      setData(await updateV7UnifiedAgentMember(memberKey, { expectedRevision: data.revision, ...patch, reason: message }));
      setNotice(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '成员配置没有保存。'); }
    finally { setBusy(null); }
  };
  const updatePolicy = async (taskKind: string, defaultTemperature: number, message: string) => {
    if (data === null) return;
    setBusy(`policy:${taskKind}`); setError(null); setNotice(null);
    try {
      setData(await updateV7UnifiedTaskPolicy(taskKind, { expectedRevision: data.revision, defaultTemperature, reason: message }));
      setNotice(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务参数没有保存。'); }
    finally { setBusy(null); }
  };

  if (data === null) return <section className="platform-remote-state"><span className="asset-spinner"/><strong>正在读取V7创作团队</strong><p>{error ?? '正在核对岗位、成员和模型。'}</p>{error && <button type="button" onClick={() => void load()}><ArrowClockwise/>重试</button>}</section>;
  return <div className="agent-team-page">
    <header className="agent-team-heading"><div><span>V7 UNIFIED EDITORIAL OFFICE</span><h1>V7创作团队</h1><p>成员姓名与岗位固定，模型可以更换。任务按工位、作者要求和书籍资料加载所需指令；更换模型不会改写历史任务。</p></div><button type="button" onClick={() => void load()}><ArrowClockwise/>刷新</button></header>
    <div className="agent-team-metrics"><Metric label="岗位" value={`${data.summary.roleCount}`} detail="职责互不混用"/><Metric label="成员" value={`${data.summary.memberCount}`} detail="全局唯一身份"/><Metric label="在岗" value={`${data.summary.onDutyCount}`} detail="可以接新任务"/><Metric label="请假" value={`${data.summary.leaveCount}`} detail="自动交接" warning={data.summary.leaveCount > 0}/></div>
    {(notice || error) && <div className={`agent-team-notice ${error ? 'error' : 'success'}`}>{error ? <WarningCircle/> : <CheckCircle/>}<span>{error ?? notice}</span></div>}
    <section className="agent-credential-strip"><Credential label="Coding Plan" ready={data.credentials.codingPlan}/><Credential label="Agent Plan" ready={data.credentials.agentPlan}/><Credential label="图片能力" ready={data.credentials.image}/><p>配置版本 {data.revision}。执行中的任务保留创建时的成员与参数快照。</p></section>
    <OpeningEvaluation data={data}/>
    <p>文字岗位各9位，封面画师2位。待验证 {data.summary.candidateCount ?? 0} 位，未绑定 {data.summary.unboundCount ?? 0} 位。新增组合仅保存配置，按具体业务节点验证后接单。</p><div className="agent-role-grid">{data.roles.map((role) => <section className="agent-role-panel" key={role.roleKey}>
      <header><div className="agent-role-icon"><Robot/></div><div><span>固定岗位</span><h2>{role.publicName}</h2><p>{role.publicResponsibility}</p></div><strong>{role.members.filter((m) => m.status === 'on_duty').length}/{role.members.length} 在岗</strong></header>
      <details className="agent-prompt-editor"><summary>查看岗位能力与交付标准</summary><div className="agent-prompt-body"><p><strong>能力：</strong>{role.capabilities.join('；')}</p><p><strong>工具：</strong>{role.tools.join('；')}</p><p><strong>交付：</strong>{role.outputContract}</p><p><strong>失败：</strong>{role.failureContract}</p></div></details>
      {role.modelCandidates && <details className="agent-prompt-editor"><summary>候选模型与上岗条件</summary><div className="agent-prompt-body"><p>通道兼容不等于文学质量通过。待验证模型可在成员停岗后保存；复测准入完成后才能接新任务。</p>{role.modelCandidates.map((candidate) => <p key={candidate.profileKey}><strong>{candidate.publicName} · {admissionLabel(candidate.status)}</strong>：{candidate.reason}</p>)}</div></details>}
      <div className="agent-member-list">{role.members.map((member) => <MemberCard key={member.memberKey} data={data} role={role} member={member} busy={busy === member.memberKey} update={updateMember}/>)}</div>
    </section>)}</div>
    <section className="agent-role-panel"><header><div className="agent-role-icon"><Robot/></div><div><span>按任务控制</span><h2>性能与温度</h2><p>不同任务使用不同温度区间，不再给所有成员套同一个数值。</p></div></header><div className="agent-member-list">{data.taskPolicies.map((policy) => <PolicyCard key={policy.taskKind} policy={policy} busy={busy === `policy:${policy.taskKind}`} update={updatePolicy}/>)}</div></section>
  </div>;
}

function MemberCard({ data, role, member, busy, update }: {
  data: V7UnifiedAgentGovernance; role: V7UnifiedAgentGovernance['roles'][number];
  member: V7UnifiedAgentGovernance['roles'][number]['members'][number]; busy: boolean;
  update: (memberKey: string, patch: Record<string, unknown>, message: string) => Promise<void>;
}): React.JSX.Element {
  const enabledCount = role.members.filter((item) => item.enabled).length;
  const candidates = role.modelCandidates ?? role.allowedModelProfileKeys.map((profileKey) => ({
    profileKey, publicName: data.modelProfiles.find((p) => p.profileKey === profileKey)?.publicName ?? profileKey,
    status: 'compatible' as const, reason: ''
  }));
  const identity = publicMemberIdentity(member.memberKey);
  const canReturn = !member.configurationOnly && (member.admission === undefined || member.admission.status === 'compatible');
  return <article className={`agent-member-card ${member.enabled ? 'enabled' : 'disabled'}`}>
    <div className="agent-member-identity"><span className="agent-avatar" aria-hidden="true" style={{ backgroundImage: `url('${identity?.avatarPath ?? V7_MEMBER_AVATAR_SPRITE}')`, backgroundSize: identity?.avatarSize ?? V7_MEMBER_AVATAR_SIZE, backgroundPosition: publicMemberIdentity(member.memberKey)?.avatarPosition ?? '100% 100%', flexShrink: 0 }}/><div><h3>{publicMemberIdentity(member.memberKey)?.displayName ?? member.displayName}</h3><p>{member.modelName}{member.plan === null ? '' : ` · ${member.plan === 'image' ? '图片' : member.plan === 'agent' ? 'Agent Plan' : 'Coding Plan'}`}</p></div><span className={`agent-duty-state ${member.status === 'on_duty' ? 'on' : 'off'}`}>{member.status === 'on_duty' ? '在岗' : member.status === 'unbound' ? '未绑定' : member.status === 'candidate' ? '待验证' : '停岗'}</span></div>
    <div className="agent-member-order"><label><span>绑定模型</span><select value={member.modelProfileKey ?? ''} disabled={busy} onChange={(e) => void update(member.memberKey,{modelProfileKey:e.target.value || null},`已调整${member.displayName}的模型`)}>{member.configurationOnly && <option value="">未绑定（预留位置）</option>}{candidates.map((candidate) => <option key={candidate.profileKey} value={candidate.profileKey} disabled={member.enabled && candidate.status !== 'compatible' && candidate.profileKey !== member.modelProfileKey}>{candidate.publicName} · {admissionLabel(candidate.status)}</option>)}</select></label>{!member.configurationOnly && <label><span>交接顺序</span><input type="number" min="1" max="100" value={member.fallbackPriority} disabled={busy} onChange={(e)=>void update(member.memberKey,{fallbackPriority:Number(e.target.value)},`已调整${member.displayName}的交接顺序`)}/></label>}</div>
    {member.admission && <p>{member.admission.reason}</p>}
    {(role.roleKey === 'planning_writer' || role.roleKey === 'chief_editor') && <p>{(() => {
      const row = data.openingEvaluation?.rows.find(row => row.profileKey === member.modelProfileKey && row.node === (role.roleKey === 'chief_editor' ? 'review' : 'design'));
      return row ? `当前绑定模型的开书${row.node === 'design' ? '设计' : '审查'}实测：${Math.round(row.milliseconds / 1000)}秒，${row.structurePassed ? '结构通过' : '未正常交付'}；${row.assessment}` : '当前绑定模型暂无开书节点评测记录。';
    })()}</p>}
    {!member.configurationOnly && <div className="agent-member-actions">{member.defaultForRole ? <span className="agent-default-mark"><CheckCircle/>默认成员</span> : <button type="button" className="secondary" disabled={busy || !canReturn} onClick={()=>void update(member.memberKey,{defaultForRole:true},`已将${member.displayName}设为默认成员`)}>设为默认</button>}<button type="button" className={member.enabled?'danger':'primary'} disabled={busy || (!member.enabled && !canReturn) || (member.enabled && enabledCount===1)} onClick={()=>void update(member.memberKey,{enabled:!member.enabled},`已将${member.displayName}${member.enabled?'请假':'返岗'}`)}>{busy?'保存中…':member.enabled?'请假':'返岗'}</button></div>}
  </article>;
}

function PolicyCard({ policy, busy, update }: { policy: V7UnifiedAgentGovernance['taskPolicies'][number]; busy: boolean; update:(key:string,value:number,message:string)=>Promise<void> }): React.JSX.Element {
  const [value,setValue]=useState(policy.defaultTemperature);
  return <article className="agent-member-card"><div className="agent-member-identity"><span className="agent-avatar">温</span><div><h3>{policy.publicName}</h3><p>{policy.rationale}</p></div></div><label><span>默认温度（{policy.minimumTemperature}—{policy.maximumTemperature}）</span><input type="range" min={policy.minimumTemperature} max={policy.maximumTemperature} step="0.01" value={value} onChange={(e)=>setValue(Number(e.target.value))}/><strong>{value.toFixed(2)}</strong></label><button type="button" disabled={busy || value===policy.defaultTemperature} onClick={()=>void update(policy.taskKind,value,`已调整${policy.publicName}的默认温度`)}>{busy?'保存中…':'保存'}</button></article>;
}
function admissionLabel(status: 'compatible' | 'pending' | 'suspended'): string { return status === 'compatible' ? '通道兼容' : status === 'pending' ? '待验证' : '暂停复测'; }
function OpeningEvaluation({data}:{data:V7UnifiedAgentGovernance}):React.JSX.Element|null {
  const report=data.openingEvaluation;
  if (!report?.rows.length) return null;
  return <section className="agent-role-panel" aria-label="开书节点评测">
    <h2>开书节点评测</h2><p>{report.scope}</p>
    <p>测试时间：{new Date(report.testedAt).toLocaleString('zh-CN')}。这是本次样本结果，参数或模型变更后需要复测；不自动改变成员上岗状态。</p>
    <div className="agent-policy-grid">{data.modelProfiles.filter(model => report.rows.some(row => row.profileKey === model.profileKey)).map(model => <article className="agent-member-card" key={model.profileKey}>
      <h3>{model.publicName}</h3>{report.rows.filter(row => row.profileKey === model.profileKey).map(row => <div key={row.node}>
        <p><strong>{row.node === 'design' ? '开书设计' : '开书审查'} · {Math.round(row.milliseconds/1000)}秒</strong></p>
        <p>{row.structurePassed ? '字段结构通过' : '未正常交付'} · 内容{row.quality === 'passed' ? '样本通过' : row.quality === 'failed' ? '未通过' : '未验证'}</p><p>{row.assessment}</p>
      </div>)}
    </article>)}</div>
  </section>;
}
function Metric({label,value,detail,warning=false}:{label:string;value:string;detail:string;warning?:boolean}){return <div className={warning?'warning':''}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function Credential({label,ready}:{label:string;ready:boolean}){return <div className={ready?'ready':'missing'}>{ready?<CheckCircle/>:<WarningCircle/>}<span><strong>{label}</strong><small>{ready?'已就绪':'未配置'}</small></span></div>}
