import {useCallback,useEffect,useState} from 'react';
import {decideSettingGap,fetchSettingGaps,type SettingGapData} from '../../lib/api/client';

export function SettingGapPanel({bookId}:{bookId:string}):React.JSX.Element{
  const[gaps,setGaps]=useState<SettingGapData[]>([]),[busyId,setBusyId]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>setGaps(await fetchSettingGaps(bookId,signal)),[bookId]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal).catch(()=>{if(!controller.signal.aborted)setError('暂时无法读取按需补设定清单，请稍后重试。');});
    return()=>controller.abort();},[load]);
  const decide=(gap:SettingGapData,decision:'design_now'|'not_used_this_volume'|'keep_unknown')=>{setBusyId(gap.gapId);setError(null);
    void decideSettingGap(bookId,gap.gapId,decision).then(()=>load()).catch(()=>setError('这项选择没有保存成功，请刷新后再试。')).finally(()=>setBusyId(null));};
  const active=gaps.filter(gap=>gap.status!=='decided');
  return <details className="setting-gap-panel" open={active.some(gap=>gap.status==='pending')}>
    <summary><span><strong>写到需要时再补设定</strong><small>{active.length===0?'当前没有阻塞项，不用提前填满。':`${active.length} 项需要你决定`}</small></span></summary>
    <div>{active.length===0?<p>卷、事件或章节设计发现确实缺少依据时，系统会把问题放在这里；不会擅自猜成全书事实。</p>:
      active.map(gap=><article key={gap.gapId}><header><div><small>{scopeLabel(gap.scopeType)}设计发现</small><h5>{gap.question}</h5></div>
        <span>{gap.status==='needs_setting'?'等待补设计':'待你选择'}</span></header><p>{gap.whyNeeded}</p>
        {gap.affectedObjects.length>0&&<small>可能影响：{gap.affectedObjects.join('、')}</small>}
        {gap.status==='needs_setting'?<em>已选择现在补设计。请在上方按需设定中完成相应条目；正式确认前，AI仍会把它当作未知。</em>:
          <div className="setting-gap-actions"><button type="button" disabled={busyId!==null} onClick={()=>decide(gap,'design_now')}>现在补充设计</button>
            <button type="button" disabled={busyId!==null} onClick={()=>decide(gap,'not_used_this_volume')}>这一层先不用</button>
            <button type="button" disabled={busyId!==null} onClick={()=>decide(gap,'keep_unknown')}>保持未知</button></div>}
      </article>)}</div>
    {error!==null&&<p className="planning-error" role="alert">{error}</p>}
  </details>;
}
function scopeLabel(scope:'volume'|'event'|'chapter'){return scope==='volume'?'当前卷':scope==='event'?'当前事件':'当前章节';}