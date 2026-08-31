import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, CheckCircle, Robot, WarningCircle } from '@phosphor-icons/react';
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
    <header className="agent-team-heading"><div><span>V7 UNIFIED EDITORIAL OFFICE</span><h1>V7创作团队</h1><p>成员只长期绑定模型与可用性；执行任务时，再由资料策划 Agent 签发本轮题材身份、工作责任和创意空间。后台只展示状态与审计，不暴露密钥。</p></div><button type="button" onClick={() => void load()}><ArrowClockwise/>刷新</button></header>
    <div className="agent-team-metrics"><Metric label="岗位" value={`${data.summary.roleCount}`} detail="职责互不混用"/><Metric label="成员" value={`${data.summary.memberCount}`} detail="全局唯一身份"/><Metric label="在岗" value={`${data.summary.onDutyCount}`} detail="可以接新任务"/><Metric label="请假" value={`${data.summary.leaveCount}`} detail="自动交接" warning={data.summary.leaveCount > 0}/></div>
    {(notice || error) && <div className={`agent-team-notice ${error ? 'error' : 'success'}`}>{error ? <WarningCircle/> : <CheckCircle/>}<span>{error ?? notice}</span></div>}
    <section className="agent-credential-strip"><Credential label="Coding Plan" ready={data.credentials.codingPlan}/><Credential label="Agent Plan" ready={data.credentials.agentPlan}/><Credential label="图片能力" ready={data.credentials.image}/><p>配置版本 {data.revision}。执行中的任务保留创建时的成员与参数快照。</p></section>
    <div className="agent-role-grid">{data.roles.map((role) => <section className="agent-role-panel" key={role.roleKey}>
      <header><div className="agent-role-icon"><Robot/></div><div><span>固定岗位</span><h2>{role.publicName}</h2><p>{role.publicResponsibility}</p></div><strong>{role.members.filter((m) => m.status === 'on_duty').length}/{role.members.length} 在岗</strong></header>
      <details className="agent-prompt-editor"><summary>查看岗位能力与交付标准</summary><div className="agent-prompt-body"><p><strong>能力：</strong>{role.capabilities.join('；')}</p><p><strong>工具：</strong>{role.tools.join('；')}</p><p><strong>交付：</strong>{role.outputContract}</p><p><strong>失败：</strong>{role.failureContract}</p></div></details>
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
  return <article className={`agent-member-card ${member.enabled ? 'enabled' : 'disabled'}`}>
    <div className="agent-member-identity"><span className="agent-avatar">{member.displayName.slice(0,1)}</span><div><h3>{member.displayName}</h3><p>{member.modelName} · {member.plan === 'image' ? '图片' : member.plan === 'agent' ? 'Agent Plan' : 'Coding Plan'}</p></div><span className={`agent-duty-state ${member.status === 'on_duty' ? 'on' : 'off'}`}>{member.status === 'on_duty' ? '在岗' : '请假'}</span></div>
    <div className="agent-member-order"><label><span>绑定模型</span><select value={member.modelProfileKey} disabled={busy} onChange={(e) => void update(member.memberKey,{modelProfileKey:e.target.value},`已调整${member.displayName}的模型`)}>{role.allowedModelProfileKeys.map((key) => <option key={key} value={key}>{data.modelProfiles.find((p)=>p.profileKey===key)?.publicName ?? key}</option>)}</select></label><label><span>交接顺序</span><input type="number" min="1" max="100" value={member.fallbackPriority} disabled={busy} onChange={(e)=>void update(member.memberKey,{fallbackPriority:Number(e.target.value)},`已调整${member.displayName}的交接顺序`)}/></label></div>
    <div className="agent-member-actions">{member.defaultForRole ? <span className="agent-default-mark"><CheckCircle/>默认成员</span> : <button type="button" className="secondary" disabled={busy} onClick={()=>void update(member.memberKey,{defaultForRole:true},`已将${member.displayName}设为默认成员`)}>设为默认</button>}<button type="button" className={member.enabled?'danger':'primary'} disabled={busy || (member.enabled && enabledCount===1)} onClick={()=>void update(member.memberKey,{enabled:!member.enabled},`已将${member.displayName}${member.enabled?'请假':'返岗'}`)}>{busy?'保存中…':member.enabled?'请假':'返岗'}</button></div>
  </article>;
}

function PolicyCard({ policy, busy, update }: { policy: V7UnifiedAgentGovernance['taskPolicies'][number]; busy: boolean; update:(key:string,value:number,message:string)=>Promise<void> }): React.JSX.Element {
  const [value,setValue]=useState(policy.defaultTemperature);
  return <article className="agent-member-card"><div className="agent-member-identity"><span className="agent-avatar">温</span><div><h3>{policy.publicName}</h3><p>{policy.rationale}</p></div></div><label><span>默认温度（{policy.minimumTemperature}—{policy.maximumTemperature}）</span><input type="range" min={policy.minimumTemperature} max={policy.maximumTemperature} step="0.01" value={value} onChange={(e)=>setValue(Number(e.target.value))}/><strong>{value.toFixed(2)}</strong></label><button type="button" disabled={busy || value===policy.defaultTemperature} onClick={()=>void update(policy.taskKind,value,`已调整${policy.publicName}的默认温度`)}>{busy?'保存中…':'保存'}</button></article>;
}
function Metric({label,value,detail,warning=false}:{label:string;value:string;detail:string;warning?:boolean}){return <div className={warning?'warning':''}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function Credential({label,ready}:{label:string;ready:boolean}){return <div className={ready?'ready':'missing'}>{ready?<CheckCircle/>:<WarningCircle/>}<span><strong>{label}</strong><small>{ready?'已就绪':'未配置'}</small></span></div>}
