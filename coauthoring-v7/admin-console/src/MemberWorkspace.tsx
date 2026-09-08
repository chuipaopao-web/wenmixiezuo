import {useEffect,useState,type ReactNode} from 'react';
import {publicMemberIdentity} from '@wenmi/agent-catalog';
import {PromptContextCenter} from './PromptContextCenter';
import {OpeningContextSnapshot} from './OpeningContextGuide';
import {fetchV7PromptAssets,fetchV7PromptManifests,fetchV7PromptManifest,type V7PromptAssetSummary,type V7PromptManifestSummary,type V7PromptManifestDetail,type V7UnifiedAgentGovernance} from './platform-api';

type Role=V7UnifiedAgentGovernance['roles'][number];
type Member=Role['members'][number];
const strings=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'):[];
const current=(a:V7PromptAssetSummary)=>a.published ?? a.latestDraft;

/** Shared rules are edited in place; each member's executed input stays immutable. */
export function MemberWorkspace({role,member,configuration,onBack}:{role:Role;member:Member;configuration:ReactNode;onBack:()=>void}) {
  const [tab,setTab]=useState<'context'|'model'>('context');
  const [assets,setAssets]=useState<V7PromptAssetSummary[]>([]);
  const [station,setStation]=useState('');
  const [rows,setRows]=useState<V7PromptManifestSummary[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<V7PromptManifestDetail|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [editor,setEditor]=useState<string|null>(null);
  const [dirty,setDirty]=useState(false);
  const [reload,setReload]=useState(0);
  useEffect(()=>{const c=new AbortController();fetchV7PromptAssets({},c.signal).then(a=>{if(!c.signal.aborted)setAssets(a);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[reload]);
  useEffect(()=>{
    const c=new AbortController();setLoading(true);setRows([]);setSelected(null);setDetail(null);setError(null);
    fetchV7PromptManifests({memberKey:member.memberKey,...(station?{workstationKey:station}:{}),limit:20},c.signal)
      .then(items=>{if(c.signal.aborted)return;const scoped=items.filter(r=>r.memberKey===member.memberKey&&(!station||r.workstationKey===station));setRows(scoped);setSelected(scoped[0]?.manifestId??null);})
      .catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[member.memberKey,station,reload]);
  useEffect(()=>{
    setDetail(null);if(!selected)return;const c=new AbortController();
    fetchV7PromptManifest(selected,c.signal).then(d=>{if(c.signal.aborted)return;if(d.manifest.memberKey!==member.memberKey)throw Error('记录与当前成员不一致，已停止展示。');setDetail(d);})
      .catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
  },[selected,member.memberKey]);
  useEffect(()=>{if(!dirty)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  useEffect(()=>{if(!dirty)return;const guard=(e:Event)=>{e.preventDefault();setError('当前规则尚未保存，请先保存草稿再切换。');};window.addEventListener('wenmi:admin-navigate',guard);return()=>window.removeEventListener('wenmi:admin-navigate',guard);},[dirty]);
  function leave(action:()=>void){if(dirty){setError('当前规则尚未保存，请先保存草稿再切换。');return;}setError(null);action();}
  const stations=assets.filter(a=>a.kind==='workstation_prompt'&&strings(current(a)?.content.taskKinds).some(k=>(role.taskKinds??[]).includes(k)));
  const stationAsset=assets.find(a=>a.assetKey==='workstation.'+station);
  const stationKeys=[...new Set([...stations.map(a=>String(current(a)?.content.workstationKey??a.assetKey.slice(12))),...rows.map(r=>r.workstationKey)])];
  const taskKinds=stationAsset?strings(current(stationAsset)?.content.taskKinds).filter(k=>(role.taskKinds??[]).includes(k)):role.taskKinds??[];
  const skills=assets.filter(a=>a.kind==='skill'&&strings(current(a)?.content.triggerTaskKinds).some(k=>taskKinds.includes(k)));
  const roleAsset=assets.find(a=>a.assetKey==='role.'+role.roleKey);
  const identity=publicMemberIdentity(member.memberKey);
  const openEditor=(key:string)=>leave(()=>setEditor(key));
  return <section className="member-workspace" aria-label="成员管理详情">
    <button type="button" className="member-back" onClick={()=>leave(onBack)}>← 全部岗位与成员</button>
    <header className="member-workspace-heading"><span className="agent-avatar" aria-hidden="true" style={{backgroundImage:`url('${identity?.avatarPath??''}')`,backgroundSize:identity?.avatarSize,backgroundPosition:identity?.avatarPosition}}/><div><small>{role.publicName}</small><h1>{member.displayName}</h1><p>{member.modelName} · {member.openingNode?'开书接单':member.status==='on_duty'?'在岗':member.status==='unbound'?'未绑定':member.status==='candidate'?'待验证':'停岗'}</p></div></header>
    <div className="prompt-context-tabs" role="tablist" aria-label="成员详情">
      <button role="tab" aria-selected={tab==='context'} className={tab==='context'?'active':''} onClick={()=>leave(()=>setTab('context'))}>岗位、工位与资料</button>
      <button role="tab" aria-selected={tab==='model'} className={tab==='model'?'active':''} onClick={()=>leave(()=>setTab('model'))}>模型与状态</button>
    </div>
    {error&&<p role="alert" className="prompt-context-notice error">{error}</p>}
    {tab==='model'?configuration:<>
      <section className="member-rule-overview">
        <div><h2>固定岗位 · {role.publicName}</h2><p>{role.publicResponsibility}</p><button disabled={!roleAsset} onClick={()=>openEditor('role.'+role.roleKey)}>管理岗位共用规则</button></div>
        <label>任务工位<select aria-label="成员任务工位" value={station} onChange={e=>leave(()=>{setStation(e.target.value);setEditor(null);})}><option value="">全部工位 · 最近输入</option>{stationKeys.map(key=><option key={key} value={key}>{current(assets.find(a=>a.assetKey==='workstation.'+key)??{published:null,latestDraft:null} as V7PromptAssetSummary)?.title??key}</option>)}</select></label>
      </section>
      {stationAsset&&<section className="member-station-rule"><h2>{current(stationAsset)?.title}</h2><p>{String(current(stationAsset)?.content.responsibility??'')}</p><dl><dt>需要的资料</dt><dd>{strings(current(stationAsset)?.content.requiredInputs).join('；')}</dd><dt>不应带入</dt><dd>{strings(current(stationAsset)?.content.forbiddenInputs).join('；')}</dd></dl><button onClick={()=>openEditor(stationAsset.assetKey)}>管理本工位共用上下文</button></section>}
      <p className="member-scope-note">岗位规则影响同岗位成员；工位与Skill规则影响使用它的任务。成员姓名、岗位固定，任务人设随书籍与工位形成。这里只修改共用配置，用户实际资料保持只读。工位列表表示岗位合同范围，是否可接单仍以节点准入为准。</p>
      {skills.length>0&&<div className="member-rule-links" aria-label="本岗位相关执行规则">{skills.map(a=><button key={a.assetKey} onClick={()=>openEditor(a.assetKey)}>{current(a)?.title??a.assetKey}</button>)}</div>}
      {editor?<section className="member-embedded-editor"><button onClick={()=>leave(()=>{setEditor(null);setReload(v=>v+1);})}>← 返回成员最近资料</button><p>修改作用范围：{editor.startsWith('role.')?'同岗位所有成员':'所有使用此规则的任务'}。发布后的新任务采用新版本，历史执行输入不改写。</p><PromptContextCenter key={editor} initialAssetKey={editor} allowedAssetKeys={[editor]} editorOnly memberKey={member.memberKey} onDirtyChange={setDirty}/></section>:<section className="member-recent-context" aria-label="成员最近收到的资料">
        <header><div><h2>最近收到的资料与上下文</h2><p>只查{member.displayName}的实际调用，默认展示最新一条；共用规则的效果以当时冻结输入为准。</p></div><button onClick={()=>setReload(v=>v+1)}>刷新资料</button></header>
        {loading?<p role="status">正在读取该成员的调用…</p>:!rows.length?<p role="status">该成员{station?'在此工位':''}还没有可展示的调用记录。可先管理共用规则，不使用其他成员的记录代替。</p>:<>
          <label>选择实际调用<select aria-label="成员调用记录" value={selected??''} onChange={e=>setSelected(e.target.value)}>{rows.map(r=><option key={r.manifestId} value={r.manifestId}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.workstationKey} · {r.execution.state}</option>)}</select></label>
          {detail?<MemberInput detail={detail}/>:!error&&<p role="status">正在读取实际输入…</p>}
        </>}
      </section>}
    </>}
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
