import {useEffect,useRef,useState} from 'react';
import {request} from './opening-api';
import './BookSynopsisPanel.css';
interface SynopsisState{eligible:boolean;reason:string;adoptionId:string|null;profileVersion:number;saved:{id:string;text:string;stale:boolean}|null;latest:{id:string;state:string;text:string;adoptionId:string|null;profileVersion:number;expectedSavedId:string|null}|null}
export function BookSynopsisPanel({bookId}:{bookId:string}){
 const [state,setState]=useState<SynopsisState|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const dirty=useRef(false),alive=useRef(true),source=useRef<{adoptionId:string|null;profileVersion:number;expectedSavedId:string|null}|null>(null);
 const endpoint=`/api/time-machine/books/${encodeURIComponent(bookId)}/synopsis`;
 function apply(value:SynopsisState){
  setState(value);
  if(!dirty.current){const candidate=value.latest?.state==='candidate'&&value.latest.expectedSavedId===(value.saved?.id??null)?value.latest:null;
   setText(candidate?.text??value.saved?.text??'');source.current=candidate?{adoptionId:candidate.adoptionId,profileVersion:candidate.profileVersion,expectedSavedId:candidate.expectedSavedId}:{adoptionId:value.adoptionId,profileVersion:value.profileVersion,expectedSavedId:value.saved?.id??null};
   setNotice(candidate?'已生成草案，核对后保存。':value.saved?'已保存':'');
  }
 }
 async function refresh(){try{const value=await request<SynopsisState>(endpoint);if(alive.current){apply(value);setError('');}}catch{if(alive.current)setError('简介暂时未读取成功，请重新读取。');}}
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;};},[bookId]);
 useEffect(()=>{if(state?.latest?.state!=='working')return;const timer=setInterval(()=>void refresh(),2500);return()=>clearInterval(timer);},[state?.latest?.state]);
 async function generate(){
  setBusy(true);setError('');setNotice('主编正在设计简介…');
  try{const result=await request<{state:string}>(endpoint+'/generate',{method:'POST',body:JSON.stringify({requestKey:crypto.randomUUID()})});
   if(!alive.current)return;
   if(result.state==='failed'){setError('这次简介未完成，原内容保留，可以重新设计。');setNotice('');}
   else{dirty.current=false;await refresh();}
  }catch{if(alive.current){setError('尚未取得生成结果，请重新读取状态，避免重复发起。');setNotice('');}}
  finally{if(alive.current)setBusy(false);}
 }
 async function save(){
  if(!source.current)return;setBusy(true);setError('');
  try{const value=await request<SynopsisState>(endpoint,{method:'PUT',body:JSON.stringify({text,...source.current,requestKey:crypto.randomUUID()})});if(alive.current){dirty.current=false;apply(value);setNotice('已保存');}}
  catch(error){if(alive.current)setError(error instanceof Error?error.message:'简介未保存，请重试。');}
  finally{if(alive.current)setBusy(false);}
 }
 const working=busy||state?.latest?.state==='working';
 return <section className="book-synopsis-panel" aria-labelledby="book-synopsis-title">
  <header><h3 id="book-synopsis-title">作品简介</h3><span>给读者看的故事介绍</span></header>
  {!state&&!error&&<p role="status">正在读取简介…</p>}
  {state&&<><textarea aria-label="作品简介内容" rows={5} maxLength={1000} value={text} disabled={working} onChange={event=>{dirty.current=true;setText(event.target.value);setNotice('有未保存的修改');}} placeholder={state.eligible?'可请主编设计，也可以自己填写。':'采用全书基线后可生成；也可以先自己填写简介。'}/>
   {!state.eligible&&<p>{state.reason||'简介生成暂未准备好。'}</p>}
   {state.saved?.stale&&<p>全书资料或方向有变化，请核对已有简介。</p>}
   {state.latest?.state==='failed'&&!error&&<p>上次简介设计未完成，可重新设计，已保存内容仍保留。</p>}
   <footer><span role="status">{working?'主编正在处理，请稍候…':notice}</span><div>
    <button type="button" className="secondary-action" disabled={!state.eligible||working||dirty.current} onClick={()=>void generate()}>{text?'重新设计简介':'设计简介'}</button>
    <button type="button" className="primary-action" disabled={working||!text.trim()} onClick={()=>void save()}>保存简介</button>
   </div></footer>{dirty.current&&<small>修改后请先保存，再重新设计。</small>}</>}
  {error&&<div role="alert"><p>{error}</p><button type="button" className="secondary-action" disabled={busy} onClick={()=>void refresh()}>重新读取</button></div>}
 </section>;
}
