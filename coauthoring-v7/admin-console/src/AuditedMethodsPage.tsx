import { useEffect, useState } from 'react';
import { fetchRhythmPolicy, type RhythmPolicyView } from './platform-api';
import { AUDITED_METHODS, AUDIT_CATEGORIES, AUDIT_TASKS, AUDIT_SUPPLY, AUDIT_MERGES, AUDIT_RESTORED,
 AUDIT_ORIGINAL_COUNT, AUDIT_COPY_CHANGES, auditMethodName, type AuditSupply } from '../../backend/planning-methods/audited-method-catalog.js';
import { RhythmAssetsPage } from './RhythmAssetsPage';
import { ADDITIONAL_METHODS } from '../../backend/planning-methods/additional-methods';
import './rhythm-assets.css';

export function AuditedMethodsPage():React.JSX.Element {
 const [view,setView]=useState<'library'|'runtime'>('library');
 const [runtime,setRuntime]=useState<RhythmPolicyView|null>(null);
 useEffect(()=>{const abort=new AbortController();void fetchRhythmPolicy(abort.signal).then(setRuntime).catch(()=>setRuntime(null));return()=>abort.abort();},[view]);
 const [task,setTask]=useState('0');const [supply,setSupply]=useState('c');const [category,setCategory]=useState('all');
 const [query,setQuery]=useState('');const [page,setPage]=useState(0);const [selected,setSelected]=useState('four-act');
 const changeView=(next:'library'|'runtime')=>{if(window.dispatchEvent(new Event('wenmi:admin-navigate',{cancelable:true})))setView(next);};
 const liveMethods=[...AUDITED_METHODS,...ADDITIONAL_METHODS].map(m=>{const c=runtime?.policy.format==='audited-v4'?runtime.policy.cards.find(c=>c.key===m.key):undefined;return c?{...m,title:c.title,intro:c.instruction,when:c.boundary}:m;});
 const stageRows=liveMethods.filter(m=>task==='all'||(task!=='baseline'&&(supply==='all'||m.states[Number(task)]===supply)));
 const categories=[...new Set(stageRows.flatMap(m=>[m.category,...m.aliases.map(a=>a.category)]))];
 const rows=stageRows.filter(m=>(category==='all'||m.category===category||m.aliases.some(a=>a.category===category))&&
 [m.title,m.intro,m.when,...m.aliases.map(a=>a.title)].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const pages=Math.max(1,Math.ceil(rows.length/12)),index=Math.min(page,pages-1),visible=rows.slice(index*12,index*12+12);
 const card=rows.find(m=>m.key===selected)??visible[0];
 return <section className="rhythm-page">
  <nav className="rhythm-tabs" aria-label="方法管理视图"><button aria-pressed={view==='library'} onClick={()=>changeView('library')}>方法库与适用规则</button><button aria-pressed={view==='runtime'} onClick={()=>changeView('runtime')}>当前生效的方法配置</button></nav>
  {view==='runtime'?<RhythmAssetsPage/>:<>
  <header className="rhythm-heading"><div><h2>方法库与适用规则</h2><p>按用途查方法，按任务看适用；不把整库当成单次上下文。</p><p>原始{AUDIT_ORIGINAL_COUNT}条逐项复核，{AUDIT_MERGES.length}组合并后保留{AUDITED_METHODS.length}张卡；修订{AUDIT_COPY_CHANGES}项简介，恢复{AUDIT_RESTORED.length}项独立定义。</p></div><span>方法库 R190</span></header>
  <p>另补充{ADDITIONAL_METHODS.length}项群像、对话、动作空间、感官和趣味方法，共{liveMethods.length}项；不改变原始来源记录。</p>
  <p role="status">{runtime?.policy.format==='audited-v4'?`本页使用当前运行版本v${runtime.version}的方法定义。新任务按需查询，历史任务保留原版本。实际调用和选择见“当前生效的方法配置”。`:runtime?'当前运行仍为历史配置，本页展示校正定义；请查看当前生效的方法配置。':'尚未读取运行版本；当前展示校正参考定义，不代表线上生效状态。'}</p>
  <nav className="rhythm-tabs" aria-label="设计任务">
   {[['baseline','全书基线'],...AUDIT_TASKS.map((name,i)=>[String(i),name]),['all','完整库']].map(([value,label])=><button key={value} aria-pressed={task===value} onClick={()=>{setTask(value!);setPage(0);setCategory('all');setSelected('');}}>{label}</button>)}
  </nav>
  {task==='baseline'?<section className="rhythm-panel"><h3>全书基线不需要方法目录</h3><p>资料成员整理创作意图、主角起点、核心能力、故事舞台、长期发展边界、已确认与未确定事项。只提取影响全书方向的事实；不在这一步编写完整故事。</p><p>短卡模板及当前实现可在顶部“信息短卡模板”查看。</p></section>:<>
  <section className="rhythm-panel"><fieldset><label>查找校正方法<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="名称、简介、用途或原名"/></label>
   <label>供给方式<select aria-label="供给方式" value={supply} disabled={task==='all'} onChange={e=>{setSupply(e.target.value);setCategory('all');setPage(0);}}><option value="all">所有方式</option>{Object.entries(AUDIT_SUPPLY).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>用途分类<select aria-label="用途分类" value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}><option value="all">所有用途</option>{categories.map(c=><option key={c} value={c}>{AUDIT_CATEGORIES[c]}</option>)}</select></label>
  </fieldset></section>
  <p>找到{rows.length}项 · 第{index+1}/{pages}页。候选是可选择范围，不要求全部使用。</p>
  <div className="rhythm-columns"><section className="rhythm-panel"><h3>方法清单</h3>
   {visible.map(m=><div className="rhythm-card-row" key={m.key}><button aria-pressed={card?.key===m.key} onClick={()=>setSelected(m.key)}><small>{m.family} · {AUDIT_CATEGORIES[m.category]}</small><strong style={{display:'block'}}>{m.title}</strong><span style={{display:'block',fontWeight:400}}>{m.intro}</span></button></div>)}
   {!visible.length&&<p>没有符合当前条件的方法，可以切换供给方式或清空搜索。</p>}
   <nav className="rhythm-tabs" aria-label="校正方法分页"><button disabled={index===0} onClick={()=>setPage(index-1)}>上一页</button><button disabled={index===pages-1} onClick={()=>setPage(index+1)}>下一页</button></nav>
  </section><section className="rhythm-panel"><h3>适用说明</h3>{card?<><h4>{card.title}</h4><p>{card.intro}</p><h4>何时使用、注意什么</h4><p>{card.when}</p>
    {card.states.map((state,i)=><p key={i}>{AUDIT_TASKS[i]}：{AUDIT_SUPPLY[state as AuditSupply]}</p>)}
    {card.aliases.map(a=><p key={a.key}>保留原名：{a.title}（{AUDIT_CATEGORIES[a.category]}）</p>)}
    <details><summary>查看本条复核记录</summary><p>原简介：{card.originalIntro}</p><p>{card.originalIntro===card.intro?'简介含义准确，保留原文；适用条件已逐项重新判断。':'已修正简介；新说明见上方，原记录保留。'}</p><p>使用范围是供给建议，不是跨层禁用规则。作者明确指定时仍可读取完整定义。</p></details>
   </>:<p>选择左侧方法查看。</p>}</section></div></>}
  <details className="rhythm-panel"><summary>查看资料与方法的供给方案及接入状态</summary>
   <p>已实现：校正定义、逐条条件、用途与任务分页、合并追溯；实际运行版本单独展示。</p>
   <p>执行方式：设计成员先读短卡与分类导航，资料足够可直接设计；需要时通过工具查方法、选择具体用法，再用清理后的上下文设计。是否已生效以上方实际版本为准。</p>
   <p>资料成员负责作品事实短卡；设计成员负责选方法和创作；系统负责身份、版本、预算与组装。不增加专门选方法的成员。</p>
   <p>全书给长期方向，粗分卷分配阶段责任，卷链展开各自故事，章完成当前场景。六阶段可以用于完整卷链，四节拍不等于四卷。</p>
   <p>常规候选是简短起选目录；按需参考只在相关任务读取；承接已选只带上游真实选择；复核原则用于检查结果；不自动提供仍可从完整库查阅。单次预算计算全部输入，不能把某个字符数当准确性保证。</p>
  </details>
  <details className="rhythm-panel"><summary>合并与恢复记录</summary>{AUDIT_MERGES.map(m=><p key={m.from}>{auditMethodName(m.from)} → {auditMethodName(m.to)}：{m.reason}</p>)}{AUDIT_RESTORED.map(m=><p key={m.key}>独立保留：{auditMethodName(m.key)} / {auditMethodName(m.other)}：{m.reason}</p>)}</details>
  </>}
 </section>;
}
