import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { ArrowClockwise, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import {
  fetchFeatureCapabilities,
  type AdminFeatureBaseline,
  type AdminFeatureCapabilitiesData,
  type AdminFeatureCapability,
  type AdminFeatureStatus
} from './admin-api';

export function FeatureCapabilitiesPage({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const [baseline,setBaseline]=useState<AdminFeatureBaseline>('stable-baseline');
  const [status,setStatus]=useState<AdminFeatureStatus|''>('');
  const [moduleId,setModuleId]=useState('');
  const [query,setQuery]=useState('');
  const deferredQuery=useDeferredValue(query);
  const [data,setData]=useState<AdminFeatureCapabilitiesData|null>(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [localError,setLocalError]=useState<string|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setRefreshing(true);
    try{
      const next=await fetchFeatureCapabilities({
        baseline,
        ...(status===''?{}:{status}),
        ...(moduleId===''?{}:{moduleId}),
        ...(deferredQuery.trim()===''?{}:{query:deferredQuery.trim()})
      },signal);
      setData(next); setLocalError(null); onError(null);
    }catch(reason){
      if(signal?.aborted) return;
      const message=safeMessage(reason);
      setLocalError(message); onError(message);
    }finally{
      if(!signal?.aborted){setLoading(false);setRefreshing(false);}
    }
  },[baseline,status,moduleId,deferredQuery,onError]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);

  if(loading&&data===null) return <div className="admin-page-state"><span className="admin-spinner"/>正在核对功能资产…</div>;
  if(data===null) return <div className="admin-page-state"><strong>功能台账暂时不可用</strong><button type="button" onClick={()=>{setLoading(true);void load();}}><ArrowClockwise/>重新加载</button></div>;

  const summary=data.summary;
  return <div className="admin-capability-page">
    <header className="admin-page-heading">
      <div><h1>功能台账</h1><p>所有作者端、独立后台和系统能力都有稳定编号、版本去向与代码证据；疑似遗失不会被当成已经下线。</p></div>
      <button type="button" className="admin-capability-refresh" disabled={refreshing} onClick={()=>void load()}>
        <ArrowClockwise className={refreshing?'spinning':''}/>{refreshing?'核对中…':'重新核对'}
      </button>
    </header>

    <section className="admin-capability-baseline" aria-label="对照版本">
      <label>对照基线<select value={baseline} onChange={(event)=>{setBaseline(event.target.value as AdminFeatureBaseline);setModuleId('');}}>
        {data.registry.availableBaselines.map((item)=><option key={item.key} value={item.key}>{item.label} · {item.revision}</option>)}
      </select></label>
      <div><strong>{data.registry.baseline.label} · {data.registry.baseline.revision}</strong><span>{data.registry.baseline.purpose}</span></div>
      <small>台账 {data.registry.version} · 更新 {data.registry.updatedAt}</small>
    </section>

    <section className="admin-metrics compact admin-capability-metrics" aria-label="功能资产统计">
      <article className="admin-metric"><span>功能模块</span><strong>{summary.modules}</strong></article>
      <article className="admin-metric"><span>登记能力</span><strong>{summary.capabilities}</strong></article>
      <article className="admin-metric"><span>当前可用</span><strong>{summary.currentAvailable}</strong></article>
      <article className={'admin-metric '+(summary.statuses.suspected_missing>0?'danger':'')}><span>疑似遗失</span><strong>{summary.statuses.suspected_missing}</strong></article>
    </section>

    {data.losses.length>0&&<section className="admin-capability-losses" aria-label="疑似遗失功能">
      <header><div><WarningCircle/><h2>需要处理的疑似遗失</h2></div><p>以下能力有历史证据且后端闭环仍在，但当前找不到作者入口，也没有明确下线决定。</p></header>
      <div>{data.losses.map((item)=><article key={item.id}>
        <div><strong>{item.name}</strong><code>{item.id}</code></div>
        <p>{item.impact}</p>
        <dl>
          <div><dt>旧入口</dt><dd>{item.previousEntry??'—'}</dd></div>
          <div><dt>核查结论</dt><dd>{item.decision??'—'}</dd></div>
          <div><dt>建议</dt><dd>{item.recommendation??'—'}</dd></div>
        </dl>
      </article>)}</div>
    </section>}

    <section className="admin-capability-filters" aria-label="功能筛选">
      <label className="admin-search"><MagnifyingGlass/><input aria-label="搜索功能、入口或证据" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="搜索功能、入口或代码证据…"/></label>
      <select aria-label="筛选功能状态" value={status} onChange={(event)=>setStatus(event.target.value as AdminFeatureStatus|'')}>
        <option value="">全部状态</option>
        {Object.entries(data.registry.statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="筛选功能模块" value={moduleId} onChange={(event)=>setModuleId(event.target.value)}>
        <option value="">全部模块</option>
        {data.moduleOptions.map((item)=><option key={item.id} value={item.id}>{data.registry.surfaceLabels[item.surface]} · {item.name}</option>)}
      </select>
      <span>{summary.filteredCapabilities} 项结果</span>
    </section>

    {localError!==null&&<p className="admin-capability-inline-error" role="alert">{localError}，当前保留上次成功结果。</p>}

    {data.modules.length===0?<div className="admin-page-state admin-capability-empty"><strong>没有符合条件的功能</strong><button type="button" onClick={()=>{setQuery('');setStatus('');setModuleId('');}}>清除筛选</button></div>:
      <div className="admin-capability-modules">
        {data.modules.map((module)=><section key={module.id} className="admin-data-section">
          <header><div><h2>{module.name}</h2><p>{data.registry.surfaceLabels[module.surface]} · {module.id}</p></div><strong>{module.capabilities.length} 项</strong></header>
          <div className="admin-table-wrap"><table className="admin-capability-table">
            <thead><tr><th>功能</th><th>版本状态</th><th>当前入口</th><th>说明与证据</th></tr></thead>
            <tbody>{module.capabilities.map((item)=><CapabilityRow key={item.id} item={item} labels={data.registry.statusLabels}/>)}</tbody>
          </table></div>
        </section>)}
      </div>}
  </div>;
}

function CapabilityRow({item,labels}:{item:AdminFeatureCapability;labels:Record<AdminFeatureStatus,string>}):React.JSX.Element{
  return <tr className={item.status==='suspected_missing'?'is-missing':''}>
    <td data-label="功能"><strong>{item.name}</strong><small>{item.id}</small></td>
    <td data-label="版本状态"><span className={'admin-capability-status '+item.status}>{labels[item.status]}</span></td>
    <td data-label="当前入口"><span>{item.currentEntry??'当前无入口'}</span>{item.replacement&&<small>去向：{item.replacement}</small>}</td>
    <td data-label="说明与证据"><p>{item.description}</p><details><summary>查看判定与代码证据</summary>
      <dl>
        {item.previousEntry&&<div><dt>旧入口</dt><dd>{item.previousEntry}</dd></div>}
        {item.decision&&<div><dt>判定</dt><dd>{item.decision}</dd></div>}
        {item.impact&&<div><dt>影响</dt><dd>{item.impact}</dd></div>}
        <div><dt>代码证据</dt><dd>{item.evidence.map((path)=><code key={path}>{path}</code>)}</dd></div>
      </dl>
    </details></td>
  </tr>;
}
function safeMessage(reason:unknown):string{
  if(reason&&typeof reason==='object'){
    const message=Reflect.get(reason,'message');
    if(typeof message==='string'&&message.length>0&&message.length<240&&!/(?:SQL|sqlite|node_modules|Bearer\s|\b(?:sk|ak)-)/iu.test(message)) return message;
  }
  return '功能台账读取失败';
}
