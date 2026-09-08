import {useEffect,useState,type ReactNode} from 'react';
import {publicMemberIdentity} from '@wenmi/agent-catalog';
import {OpeningContextSnapshot} from './OpeningContextGuide';
import {fetchRebuildControl,fetchV7PromptManifests,type V7PromptManifestSummary,type V7PromptManifestDetail,type V7UnifiedAgentGovernance} from './platform-api';
import type {RebuildUnit} from '../../backend/admin/rebuild-control-types.js';
import {detailText} from './WorkflowGuide';

type Role=V7UnifiedAgentGovernance['roles'][number];
type Member=Role['members'][number];
const values=(u:RebuildUnit,key:string)=>(detailText(u,'管理·'+key)??'').split(',').map(s=>s.trim());
const functionUrl=(id:string,sample=false)=>'?section=rebuild&mapView=functions&function='+encodeURIComponent(id)+(sample?'&functionView=sample':'');

export function MemberWorkspace({role,member,configuration,onBack}:{role:Role;member:Member;configuration:ReactNode;onBack:()=>void}) {
  const [units,setUnits]=useState<RebuildUnit[]>([]);
  const [rows,setRows]=useState<V7PromptManifestSummary[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    const c=new AbortController();
    Promise.all([fetchRebuildControl(c.signal),fetchV7PromptManifests({memberKey:member.memberKey,limit:10},c.signal)])
      .then(([data,items])=>{if(!c.signal.aborted){setUnits(data.units.filter(u=>detailText(u,'管理·功能介绍')));setRows(items.filter(r=>r.memberKey===member.memberKey));}})
      .catch(()=>{if(!c.signal.aborted)setError('关联功能和执行记录暂时无法读取，模型配置仍可使用。');});
    return()=>c.abort();
  },[member.memberKey]);
  const identity=publicMemberIdentity(member.memberKey);
  const navigate=(e:React.MouseEvent<HTMLAnchorElement>)=>{if(!window.dispatchEvent(new Event('wenmi:admin-navigate',{cancelable:true})))e.preventDefault();};
  return <section className="member-workspace" aria-label="成员管理详情">
    <button type="button" className="member-back" onClick={onBack}>← 全部岗位与成员</button>
    <header className="member-workspace-heading"><span className="agent-avatar" aria-hidden="true" style={{backgroundImage:`url('${identity?.avatarPath??''}')`,backgroundSize:identity?.avatarSize,backgroundPosition:identity?.avatarPosition}}/><div><small>{role.publicName}</small><h1>{member.displayName}</h1><p>{member.modelName}</p></div></header>
    {configuration}
    <section className="member-rule-overview"><div><h2>固定岗位 · {role.publicName}</h2><p>{role.publicResponsibility}</p><p>这里管理成员、模型与状态。岗位人设、提示词、资料与上下文统一在“功能与AI流程”调整。</p></div></section>
    {error&&<p role="alert">{error}</p>}
    <section><h2>参与的功能</h2><div className="member-rule-links">{units.filter(u=>values(u,'岗位').includes(role.roleKey)).map(u=><a key={u.id} href={functionUrl(u.id)} onClick={navigate}>{detailText(u,'管理·名称')??u.name}</a>)}</div></section>
    <section><h2>最近执行记录</h2><p>这里只显示执行记录；查看资料和调整规则请进入对应功能。</p>{rows.map(r=>{
      const u=units.find(u=>values(u,'工位').includes(r.workstationKey)&&values(u,'任务类型').includes(r.taskKind));
      return <p key={r.manifestId}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.execution.state} · {u?<a href={functionUrl(u.id,true)} onClick={navigate}>查看{detailText(u,'管理·名称')??u.name}的上下文</a>:'该任务的功能档案尚未登记'}</p>;
    })}</section>
  </section>;
}

export function MemberInput({detail}:{detail:V7PromptManifestDetail}) {
  const role=detail.promptAssets.rolePrompt,station=detail.promptAssets.workstationPrompt,genre=detail.genreProfile;
  const sources=detail.contextPack?.sources??[];
  return <section className="member-input-snapshot" aria-label="实际接收的输入">
    <p>完整输入 {Array.from(detail.manifest.compiledPrompt).length} 字符 · {detail.manifest.modelProfileKey} · {detail.execution.summary}</p>
    <h3>这次以什么身份工作</h3><dl><dt>岗位与工位</dt><dd>{role?.title??detail.manifest.roleKey} / {station?.title??detail.manifest.workstationKey}</dd><dt>本次任务</dt><dd>{detail.taskContract?.objective??'这条历史记录没有单独保存任务目标，见完整输入。'}</dd><dt>本书临时人设</dt><dd>{genre?`${genre.publicLabel}：${genre.workingIdentity}`:'本次未单独保存题材工作人设，以实际输入为准。'}</dd></dl>
    {genre&&<p>创作重点：{genre.writingPriorities.join('；')}；避免：{genre.avoidPatterns.join('；')}</p>}
    <div className="member-frozen-rules">{[role,station,...detail.promptAssets.skills].filter(a=>a!==null).map(a=><details key={a!.assetId}><summary>实际采用：{a!.title} · 第{a!.version}版</summary><pre>{JSON.stringify(a!.content,null,2)}</pre></details>)}</div>
    <OpeningContextSnapshot detail={detail}/>
    {detail.manifest.workstationKey!=='opening'&&<><h3>当时选入和排除的资料</h3>{sources.length?sources.map((s,i)=><p key={i}>{s.decision==='included'?'已选入':'未选入'}：{s.sourceKey} · {s.reason}</p>):<p>此记录没有保存逐项来源。</p>}<details><summary>查看本次资料包内容</summary><pre>{JSON.stringify(detail.contextPack?.content??null,null,2)}</pre></details></>}
    <details><summary>查看完整下发内容（只读）</summary><pre>{detail.manifest.compiledPrompt}</pre></details>
  </section>;
}
