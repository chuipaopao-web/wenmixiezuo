import type {DatabaseSync} from 'node:sqlite';

export function listTimeMachineTasks(db:DatabaseSync,ownerId:string,bookId?:string,limit=80){
 const rows=db.prepare(`SELECT r.id,r.book_id,b.title,r.kind,r.state,r.phase,r.scheme,r.created_at,r.updated_at,
 json_extract(r.snapshot_json,'$.members') AS members,
 json_extract(r.result_json,'$.review.pass') AS review_pass,
 EXISTS(SELECT 1 FROM tm2_adoptions a JOIN tm2_books t ON t.owner=a.owner AND t.book=a.book AND t.adoption=a.id WHERE a.owner=r.owner_id AND a.book=r.book_id AND a.candidate=r.id) AS adopted,
 EXISTS(SELECT 1 FROM tm2_design_runs d WHERE d.owner_id=r.owner_id AND d.book_id=r.book_id AND d.kind='design' AND d.created_at>=r.created_at) AS designed
 FROM tm2_design_runs r JOIN books b ON b.owner_id=r.owner_id AND b.book_id=r.book_id
 WHERE r.owner_id=? AND b.status='active' AND (? IS NULL OR r.book_id=?)
 AND NOT EXISTS(SELECT 1 FROM tm2_design_runs newer WHERE newer.owner_id=r.owner_id AND newer.book_id=r.book_id AND newer.kind=r.kind AND COALESCE(newer.scheme,'')=COALESCE(r.scheme,'') AND (newer.created_at>r.created_at OR (newer.created_at=r.created_at AND newer.rowid>r.rowid)))
 ORDER BY r.updated_at DESC LIMIT ?`).all(ownerId,bookId??null,bookId??null,limit);
 return rows.map(r=>{
  const phase=String(r.phase),members=JSON.parse(String(r.members));
  const member=phase.startsWith('card-review')||phase.startsWith('review')||phase.startsWith('recommend')?members.chief:phase.startsWith('card')||phase.startsWith('merge')?members.researcher:members.writer;
  const done=Boolean(r.adopted)||(r.kind==='recommend'&&Boolean(r.designed));
  const status=r.state==='queued'?'waiting':r.state==='working'?'working':r.state==='failed'?'failed':done?'completed':'waiting_for_you';
  const stage=phase.startsWith('card-review')?'正在核对资料':phase.startsWith('card')||phase.startsWith('merge')?'正在整理资料':phase.startsWith('methods')?'正在选择设计方法':phase.startsWith('self')?'正在自检方案':phase.startsWith('skeleton')?'正在设计全书骨架':phase.startsWith('volumes')?'正在设计分卷方向':phase.startsWith('review')?'正在核对方案':phase.startsWith('recommend')?'正在推荐故事线':'等待成员接手';
  const message=status==='working'?stage:status==='waiting'?'等待成员接手':status==='failed'?'本次未完成，已保存进度，请回时光机查看处理。':status==='completed'?'本轮结果已确认或进入后续设计。':r.review_pass===0?'方案需要调整，请回时光机查看。':r.kind==='recommend'?'故事线已推荐，请选择后继续。':'全书方案已生成，等待您选择。';
  return {taskId:String(r.id),taskKind:r.kind==='recommend'?'time_machine_recommend':'time_machine_design',bookId:String(r.book_id),bookTitle:String(r.title),status,message,progress:0,progressKnown:false,memberKey:member?.memberKey??null,memberName:member?.displayName??null,treeKind:null,scopeId:null,actionable:true,canStop:false,updatedAt:String(r.updated_at)};
 });
}
