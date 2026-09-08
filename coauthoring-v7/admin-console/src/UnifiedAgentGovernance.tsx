import { useCallback, useEffect, useState } from 'react';
import { openingRanking, ROLES, MEMBER_SLOTS, memberNameWithModel } from '@wenmi/agent-catalog';
import {MemberWorkspace} from './MemberWorkspace';
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
  const [tab, setTab] = useState<'members' | 'evaluation' | 'policies'>('members');
  const [memberKey,setMemberKey]=useState<string|null>(()=>new URL(location.href).searchParams.get('member'));
  useEffect(()=>{const restore=()=>setMemberKey(new URL(location.href).searchParams.get('member'));window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  function openMember(key:string|null){const url=new URL(location.href);url.searchParams.set('section','agents');if(key)url.searchParams.set('member',key);else url.searchParams.delete('member');history.pushState({},'',url);setMemberKey(key);}
  function changeTab(next:typeof tab){setTab(next);}
  const [roleFilter, setRoleFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [search, setSearch] = useState('');
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

  if (data === null) return <section className="platform-remote-state"><span className="asset-spinner"/><strong>正在读取创作团队</strong><p>{error ?? '正在核对岗位、成员和模型。'}</p>{error && <button type="button" onClick={() => void load()}><ArrowClockwise/>重试</button>}</section>;
  const selectedRole=data.roles.find(role=>role.members.some(m=>m.memberKey===memberKey));
  const selectedMember=selectedRole?.members.find(m=>m.memberKey===memberKey);
  if(memberKey&&selectedRole&&selectedMember)return <><div role="status">{notice}</div>{error&&<p role="alert">{error}</p>}<MemberWorkspace key={memberKey} role={selectedRole} member={selectedMember} onBack={()=>openMember(null)} configuration={<MemberCard data={data} role={selectedRole} member={selectedMember} busy={busy!==null} update={updateMember}/>}/></>;
  if(memberKey)return <section><h2>当前后台未找到该成员</h2><p>请核对连接的环境和成员目录版本。</p><button onClick={()=>openMember(null)}>返回全部成员</button></section>;
  return <div className="agent-team-page">
    <header className="agent-team-heading"><div><span>EDITORIAL WORKSPACE</span><h1>成员与模型</h1><p>按岗位管理成员、模型绑定与在岗状态。提示词和上下文统一进入“功能与AI流程”管理。</p></div><button type="button" onClick={() => void load()}><ArrowClockwise/>刷新</button></header>
    {data.summary.memberCount!==MEMBER_SLOTS.length&&<p role="alert" className="prompt-context-notice error">当前连接的服务返回{data.summary.memberCount}位成员，与共用目录的{MEMBER_SLOTS.length}位不一致。请更新该环境后端；这里不伪造缺失成员或在岗状态。</p>}
    <div className="agent-team-metrics"><Metric label="岗位" value={`${data.summary.roleCount}`} detail="职责互不混用"/><Metric label="成员" value={`${data.summary.memberCount}`} detail="全局唯一身份"/><Metric label="在岗" value={`${data.summary.onDutyCount}`} detail="可以接新任务"/><Metric label="请假" value={`${data.summary.leaveCount}`} detail="自动交接" warning={data.summary.leaveCount > 0}/></div>
    {(notice || error) && <div className={`agent-team-notice ${error ? 'error' : 'success'}`}>{error ? <WarningCircle/> : <CheckCircle/>}<span>{error ?? notice}</span></div>}
    <section className="agent-credential-strip"><Credential label="Coding Plan" ready={data.credentials.codingPlan}/><Credential label="Agent Plan" ready={data.credentials.agentPlan}/><Credential label="图片能力" ready={data.credentials.image}/><p>配置版本 {data.revision}。执行中的任务保留创建时的成员与参数快照。</p></section>
    <div className="prompt-context-tabs" role="tablist" aria-label="成员管理">
      <button role="tab" aria-selected={tab === 'members'} onClick={() => changeTab('members')}>全部成员（{data.summary.memberCount}）</button>
      <button role="tab" aria-selected={tab === 'evaluation'} onClick={() => changeTab('evaluation')}>模型速度与准入</button>
      <button role="tab" aria-selected={tab === 'policies'} onClick={() => changeTab('policies')}>任务参数</button>
    </div>
    {tab === 'evaluation' && <><SettingEvaluation data={data}/><OpeningEvaluation data={data}/></>}
    {tab === 'members' && <>
    <p>文字岗位各9位，封面画师2位。待验证 {data.summary.candidateCount ?? 0} 位，未绑定 {data.summary.unboundCount ?? 0} 位。成员身份已建立不代表所有节点都已准入；开书接单单独标注。</p>
    <div className="admin-context-filters">
      <label>岗位<select aria-label="岗位" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="all">全部岗位</option>{data.roles.map(role => <option key={role.roleKey} value={role.roleKey}>{role.publicName}（{role.members.length}）</option>)}</select></label>
      <label>成员状态<select aria-label="成员状态" value={memberFilter} onChange={e => setMemberFilter(e.target.value)}><option value="all">全部状态</option><option value="opening">开书接单</option><option value="on_duty">在岗</option><option value="candidate">待验证</option><option value="unbound">未绑定</option><option value="off">停岗</option></select></label>
      <label>查找成员或模型<input value={search} onChange={e => setSearch(e.target.value)} placeholder="姓名、模型名称或编号" /></label>
    </div>
    <div className="agent-role-grid member-directory">{data.roles.toSorted((a,b)=>ROLES.findIndex(r=>r.roleKey===a.roleKey)-ROLES.findIndex(r=>r.roleKey===b.roleKey)).filter(role => roleFilter === 'all' || role.roleKey === roleFilter).map((role) => {
      const members = role.members.filter(member => {
        const statusMatch = memberFilter === 'all' || (memberFilter === 'opening' ? Boolean(member.openingNode) : memberFilter === 'off' ? !member.enabled && !member.configurationOnly : member.status === memberFilter);
        return statusMatch && [member.displayName, member.modelName, member.memberKey, member.modelProfileKey ?? ''].join(' ').toLowerCase().includes(search.trim().toLowerCase());
      });
      return <section className="agent-role-panel" key={role.roleKey}>
      <header><div className="agent-role-icon"><Robot/></div><div><span>固定岗位</span><h2>{role.publicName}</h2><p>{role.publicResponsibility}</p></div><strong>{role.members.filter((m) => m.status === 'on_duty').length}/{role.members.length} 在岗</strong></header>
      <details className="agent-prompt-editor"><summary>查看岗位能力与交付标准</summary><div className="agent-prompt-body"><p><strong>能力：</strong>{role.capabilities.join('；')}</p><p><strong>工具：</strong>{role.tools.join('；')}</p><p><strong>交付：</strong>{role.outputContract}</p><p><strong>失败：</strong>{role.failureContract}</p></div></details>
      {role.modelCandidates && <details className="agent-prompt-editor"><summary>候选模型与上岗条件</summary><div className="agent-prompt-body"><p>通道兼容不等于文学质量通过。待验证模型可在成员停岗后保存；复测准入完成后才能接新任务。</p>{role.modelCandidates.map((candidate) => <p key={candidate.profileKey}><strong>{candidate.publicName} · {admissionLabel(candidate.status)}</strong>：{candidate.reason}</p>)}</div></details>}
      <p>当前显示 {members.length} / {role.members.length} 位</p>
      <div className="agent-member-list member-summary-grid">{members.map((member) => {
        const identity=publicMemberIdentity(member.memberKey);
        return <article className="agent-member-card" key={member.memberKey}><div className="agent-member-identity"><span className="agent-avatar" aria-hidden="true" style={{backgroundImage:`url('${identity?.avatarPath??V7_MEMBER_AVATAR_SPRITE}')`,backgroundSize:identity?.avatarSize??V7_MEMBER_AVATAR_SIZE,backgroundPosition:identity?.avatarPosition}}/><div><h3>{member.displayName}</h3><p>{role.publicName}</p></div></div><p>{member.modelName}</p><p>{member.openingNode?'开书接单':member.status==='on_duty'?'在岗':member.status==='unbound'?'未绑定':member.status==='candidate'?'待验证':'停岗'}</p><button type="button" aria-label={`管理${member.displayName}的模型与状态`} onClick={()=>openMember(member.memberKey)}>管理模型与状态 →</button></article>;
      })}</div>
    </section>})}</div></>}
    {tab === 'policies' && <section className="agent-role-panel"><header><div className="agent-role-icon"><Robot/></div><div><span>按任务控制</span><h2>性能与温度</h2><p>不同任务使用不同温度区间，不再给所有成员套同一个数值。</p></div></header><div className="agent-member-list">{data.taskPolicies.map((policy) => <PolicyCard key={policy.taskKind} policy={policy} busy={busy !== null} update={updatePolicy}/>)}</div></section>}
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
    <div className="agent-member-identity"><span className="agent-avatar" aria-hidden="true" style={{ backgroundImage: `url('${identity?.avatarPath ?? V7_MEMBER_AVATAR_SPRITE}')`, backgroundSize: identity?.avatarSize ?? V7_MEMBER_AVATAR_SIZE, backgroundPosition: publicMemberIdentity(member.memberKey)?.avatarPosition ?? '100% 100%', flexShrink: 0 }}/><div><h3>{member.displayName}</h3><p>{member.modelName}{member.plan === null ? '' : ` · ${member.plan === 'image' ? '图片' : member.plan === 'agent' ? 'Agent Plan' : 'Coding Plan'}`}</p></div><span className={`agent-duty-state ${member.status === 'on_duty' ? 'on' : 'off'}`}>{member.openingNode ? '开书接单' : member.status === 'on_duty' ? '在岗' : member.status === 'unbound' ? '未绑定' : member.status === 'candidate' ? '待验证' : '停岗'}</span></div>
    <div className="agent-member-order"><label><span>绑定模型</span><select value={member.modelProfileKey ?? ''} disabled={busy} onChange={(e) => void update(member.memberKey,{modelProfileKey:e.target.value || null},`已调整${member.displayName}的模型`)}>{member.configurationOnly && <option value="">未绑定（预留位置）</option>}{candidates.map((candidate) => <option key={candidate.profileKey} value={candidate.profileKey} disabled={member.enabled && candidate.status !== 'compatible' && candidate.profileKey !== member.modelProfileKey}>{candidate.publicName} · {admissionLabel(candidate.status)}</option>)}</select></label>{!member.configurationOnly && <label><span>交接顺序</span><input type="number" min="1" max="100" value={member.fallbackPriority} disabled={busy} onChange={(e)=>void update(member.memberKey,{fallbackPriority:Number(e.target.value)},`已调整${member.displayName}的交接顺序`)}/></label>}</div>
    {member.admission && <p>{member.admission.reason}</p>}
    {member.settingNode && <p>设定{member.settingNode === 'chief_editor' ? '审查：按本轮合格速度顺序接单。' : '设计：按指定模型优先顺序接单。'}</p>}
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
function SettingEvaluation({data}:{data:V7UnifiedAgentGovernance}):React.JSX.Element|null {
  const report=data.settingEvaluation;if(!report)return null;
  const ranked=openingRanking('review',report);
  return <section className="agent-role-panel setting-evaluation" aria-label="设定审查评测"><h2>设定审查速度与准入</h2><p>{report.scope}</p><p>测试时间：{new Date(report.testedAt).toLocaleString('zh-CN')}。设定设计优先DeepSeek Pro、DeepSeek Flash、Kimi 2.7，本轮未测试设计。</p><div className="agent-policy-grid">{[...report.rows].sort((a,b)=>a.milliseconds-b.milliseconds).map(row=>{
    const rank=ranked.findIndex(r=>r.profileKey===row.profileKey);
    return <article className="agent-member-card" key={row.profileKey}><h3>{data.modelProfiles.find(m=>m.profileKey===row.profileKey)?.publicName??row.profileKey}</h3><p><strong>{(row.milliseconds/1000).toFixed(1)}秒</strong> · {rank<0?'未准入':`合格第${rank+1}名`}</p><p>输出Token：{row.outputTokens??'未取得'} · {row.structurePassed?'正式结构通过':'正式结构未通过'} · {row.quality==='passed'?'样本内容通过':row.quality==='failed'?'样本内容未通过':'内容未验证'}</p><p>{row.assessment}</p></article>;
  })}</div></section>;
}
function OpeningEvaluation({data}:{data:V7UnifiedAgentGovernance}):React.JSX.Element|null {
  const report=data.openingEvaluation;
  if (!report?.rows.length) return null;
  return <section className="agent-role-panel" aria-label="开书节点评测">
    <h2>开书节点评测</h2><p>{report.scope}</p>
    <p>测试时间：{new Date(report.testedAt).toLocaleString('zh-CN')}。完整返回耗时，单轮样本；设计与审查分别排名，失败不参与排名，换模型后按新绑定核验。</p>
    {(['design','review'] as const).map(node=>{
      const ranked=openingRanking(node,report);
      const rows=report.rows.filter(row=>row.node===node && row.profileKey!=='glm-5.2').toSorted((a,b)=>{
        const ai=ranked.findIndex(row=>row.profileKey===a.profileKey),bi=ranked.findIndex(row=>row.profileKey===b.profileKey);
        return (ai<0?100:ai)-(bi<0?100:bi) || a.milliseconds-b.milliseconds;
      });
      return <section key={node} aria-label={node==='design'?'开书设计速度榜':'开书审查速度榜'}>
        <h3>{node==='design'?'开书设计速度榜':'开书审查速度榜'}</h3>
        <p>{node==='design'?'前端展示已绑定、可接单且有效成绩最快的三位设计成员。':'审查单独计时、优先使用有效成绩更快的成员，并排除本次设计所用模型。'}</p>
        <div className="agent-policy-grid">{rows.map(row=>{
          const rank=ranked.findIndex(item=>item.profileKey===row.profileKey);
          const selected=data.openingSelection?.find(item=>item.modelId===row.profileKey && item.roleKey===(node==='design'?'screenwriter':'chief_editor'));
          return <article className="agent-member-card" key={row.profileKey}>
            <h4>{data.modelProfiles.find(model=>model.profileKey===row.profileKey)?.publicName ?? row.profileKey}</h4>
            <p><strong>{node==='design'?'开书设计':'开书审查'} · {Math.round(row.milliseconds/1000)}秒</strong> · {rank<0?'未入榜':`第${rank+1}名`}</p>
            {row.repairMilliseconds!==undefined && <p>首次返回{Math.round((row.firstMilliseconds??0)/1000)}秒，结构修复{Math.round(row.repairMilliseconds/1000)}秒；按可用结果总耗时排名。</p>}
            <p>{row.structurePassed?'字段结构通过':'未正常交付'} · 内容{row.quality==='passed'?'样本通过':row.quality==='failed'?'未通过':'未验证'}</p>
            <p>{row.assessment}</p>{selected && <p>{memberNameWithModel(publicMemberIdentity(selected.memberKey)?.displayName ?? '成员',selected.modelId)} · {node==='design'?'前端已展示':'开书审查在岗'}</p>}
          </article>;
        })}</div>
      </section>;
    })}
  </section>;
}
function Metric({label,value,detail,warning=false}:{label:string;value:string;detail:string;warning?:boolean}){return <div className={warning?'warning':''}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
function Credential({label,ready}:{label:string;ready:boolean}){return <div className={ready?'ready':'missing'}>{ready?<CheckCircle/>:<WarningCircle/>}<span><strong>{label}</strong><small>{ready?'已就绪':'未配置'}</small></span></div>}
