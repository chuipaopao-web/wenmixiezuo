import { useMemo, useState } from 'react';
import workflowDocument from '../../../docs/AGENT_WORKFLOW_SPEC.md?raw';
import { splitSpecDocument, SpecDocumentBody } from './spec-document';
import './agent-workflow.css';

export function splitWorkflowDocument(text:string):{title:string;body:string}[]{return splitSpecDocument(text);}
export const WORKFLOW_SECTIONS=splitWorkflowDocument(workflowDocument);
function DocumentBody({text}:{text:string}):React.JSX.Element {return <SpecDocumentBody text={text}/>;}
export function AgentWorkflowPage():React.JSX.Element {
 const [query,setQuery]=useState('');const [selected,setSelected]=useState('0');
 const matches=useMemo(()=>WORKFLOW_SECTIONS.map((s,i)=>({...s,id:String(i)})).filter(s=>(s.title+' '+s.body).toLowerCase().includes(query.trim().toLowerCase())),[query]);
 const current=matches.find(s=>s.id===selected)??matches[0];
 const visible=selected==='all'?matches:current?[current]:[];
 return <section className="rhythm-page workflow-page">
  <header><h2>智能体工作流程</h2><p>流程规范 v1.1 · 方法查询闭环已接入，事实补读工具另行开发。实际生效版本和验证结果见方法配置与开发路线。本文与项目详细文档同源发布。</p></header>
  <section className="rhythm-panel"><fieldset><label>搜索流程文档<input aria-label="搜索流程文档" value={query} onChange={e=>setQuery(e.target.value)} placeholder="例如：卷设计、工具、预算、失败恢复"/></label>
  <label>文档章节<select aria-label="文档章节" value={selected==='all'?'all':current?.id??''} onChange={e=>setSelected(e.target.value)}><option value="all">查看全部章节</option>{matches.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label></fieldset><p role="status">共{WORKFLOW_SECTIONS.length}节，匹配{matches.length}节</p></section>
  {visible.map(s=><article className="rhythm-panel workflow-section" key={s.id}><h3>{s.title}</h3><DocumentBody text={s.body}/></article>)}
  {!visible.length&&<p role="status">没有匹配章节，请调整关键词。</p>}
 </section>;
}
