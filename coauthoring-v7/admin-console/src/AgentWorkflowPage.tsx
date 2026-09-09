import { useMemo, useState } from 'react';
import workflowDocument from '../../../docs/AGENT_WORKFLOW_SPEC.md?raw';
import './agent-workflow.css';

export function splitWorkflowDocument(text:string):{title:string;body:string}[]{
 return text.split(/^## /m).slice(1).map(part=>{const end=part.indexOf('\n');return {title:part.slice(0,end).trim(),body:part.slice(end+1).trim()};});
}
export const WORKFLOW_SECTIONS=splitWorkflowDocument(workflowDocument);
function DocumentBody({text}:{text:string}):React.JSX.Element {
 const lines=text.split(/\r?\n/);const blocks:React.JSX.Element[]=[];
 for(let i=0;i<lines.length;){
  const line=lines[i]!.trim();if(!line){i++;continue;}
  if(line.startsWith('|')){
   const rows:string[][]=[];while(i<lines.length&&lines[i]!.trim().startsWith('|')){
    const cells=lines[i++]!.trim().slice(1,-1).split('|').map(c=>c.trim());
    if(!cells.every(c=>/^:?-+:?$/.test(c)))rows.push(cells);
   }
   blocks.push(<div className="workflow-table" key={i}><table><thead><tr>{rows[0]?.map((c,k)=><th key={k} scope="col">{c}</th>)}</tr></thead><tbody>{rows.slice(1).map((row,k)=><tr key={k}>{row.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>);continue;
  }
  if(/^\d+\. /.test(line)){
   const items:string[]=[];while(i<lines.length&&/^\d+\. /.test(lines[i]!.trim()))items.push(lines[i++]!.trim().replace(/^\d+\. /,''));
   blocks.push(<ol key={i}>{items.map((item,k)=><li key={k}>{item}</li>)}</ol>);continue;
  }
  const paragraph=[line];i++;while(i<lines.length&&lines[i]!.trim()&&!lines[i]!.trim().startsWith('|')&&!/^\d+\. /.test(lines[i]!.trim()))paragraph.push(lines[i++]!.trim());
  blocks.push(<p key={i}>{paragraph.join(' ')}</p>);
 }
 return <>{blocks}</>;
}
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
