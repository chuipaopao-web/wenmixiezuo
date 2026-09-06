import { useState } from 'react';
import type { PlanningTreeView } from './opening-api';
import './book-blueprint.css';

export function BookBlueprintPanel({tree,onAdjust}:{tree:PlanningTreeView;onAdjust:()=>void}):React.JSX.Element|null {
  const [tab,setTab]=useState<'stages'|'lines'>('stages');
  const plan=tree.bookBlueprint;
  if(!plan)return null;
  const volumes=tree.root.children.filter(v=>v.kind==='volume');
  const words=(keys:string[])=>volumes.filter(v=>keys.includes(v.key)).reduce((sum,v)=>sum+(v.budget.wordTarget??0),0);
  const volumeUrl=(scopeId:string):string=>{const url=new URL(window.location.href);url.searchParams.set('view','volume');url.searchParams.set('bookId',tree.scopeId);url.searchParams.set('volumeId',scopeId);return url.pathname+url.search;};
  return <section className="book-blueprint-panel" aria-label="全书阶段与故事线">
    <header><div><span>{tree.status==='candidate'?'待确认方案':'已确认规划'}</span><h2>从开局，走到结局</h2><p>{plan.stages.length}个阶段 · {volumes.length}卷 · {((tree.root.budget.wordTarget??0)/10000).toLocaleString('zh-CN')}万字</p></div><button type="button" onClick={onAdjust}>调整全书路线</button></header>
    <p className="book-blueprint-ending"><b>最终兑现</b>{plan.endingPromise}</p>
    <nav aria-label="全书设计内容"><button type="button" aria-pressed={tab==='stages'} onClick={()=>setTab('stages')}>阶段路线</button><button type="button" aria-pressed={tab==='lines'} onClick={()=>setTab('lines')}>故事线</button></nav>
    {tab==='stages'?<div className="book-stage-list">{plan.stages.map((stage,index)=><article key={stage.key}>
      <header><span className="book-stage-number">{String(index+1).padStart(2,'0')}</span><div><h3>{stage.title}</h3><small>{stage.volumeKeys.length}卷 · {(words(stage.volumeKeys)/10000).toLocaleString('zh-CN')}万字</small></div></header>
      <dl><div><dt>起点</dt><dd>{stage.startState}</dd></div><div><dt>获得与变化</dt><dd>{stage.gain}</dd></div><div><dt>付出的代价</dt><dd>{stage.cost}</dd></div><div><dt>节奏安排</dt><dd>{stage.rhythm}</dd></div><div><dt>{index===plan.stages.length-1?'收束与余波':'如何引出下一步'}</dt><dd>{stage.causalBridge}</dd></div></dl>
      <p className="book-stage-lines">推进：{plan.storylines.filter(l=>stage.storylineKeys.includes(l.key)).map(l=>l.title).join(' · ')}</p>
      <div className="book-stage-volumes">{volumes.filter(v=>stage.volumeKeys.includes(v.key)).map(v=><div key={v.key}><strong>{v.sequence}. {v.title}</strong><small>{((v.budget.wordTarget??0)/10000).toLocaleString('zh-CN')}万字</small><p>{v.story.protagonistChange}</p>{tree.status==='confirmed'&&v.linkedTree&&<a href={volumeUrl(v.linkedTree.scopeId)}>进入本卷创作 →</a>}</div>)}</div>
    </article>)}</div>:<div className="book-storyline-list">{plan.storylines.map(line=><article key={line.key}><h3>{line.title}</h3><dl><div><dt>追求什么</dt><dd>{line.goal}</dd></div><div><dt>如何推进</dt><dd>{line.development}</dd></div><div><dt>在哪收束</dt><dd>{line.resolution}</dd></div></dl><small>关联阶段：{plan.stages.filter(s=>s.storylineKeys.includes(line.key)).map(s=>s.title).join(' → ')}</small></article>)}</div>}
    <p className="book-blueprint-note">这里展示未来规划。正文实际进度仍单独记录；调整方案需要重新确认，不会改写已完成正文。</p>
  </section>;
}
