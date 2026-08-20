import {DomainError,errorCodes} from '../../domain/errors.js';
import type {Clock,IdGenerator} from '../../domain/ids.js';
import {assertBookScope,type BookScope} from '../../domain/scope.js';
import {SettingGapRepository,type SettingGapRow} from '../../infrastructure/db/repositories/setting-gap-repository.js';
import {UnitOfWork} from '../../infrastructure/db/unit-of-work.js';

export interface SettingGapView{
  gapId:string;scopeType:'volume'|'event'|'chapter';scopeId:string;question:string;whyNeeded:string;affectedObjects:string[];
  decision:'design_now'|'not_used_this_volume'|'keep_unknown'|null;status:'pending'|'needs_setting'|'decided';
  resolvedSettingVersionId:string|null;createdAt:string;updatedAt:string;
}
export class SettingGapService{
  private readonly repository:SettingGapRepository;
  public constructor(repository:SettingGapRepository,private readonly unitOfWork:UnitOfWork,
    private readonly ids:IdGenerator,private readonly clock:Clock){this.repository=repository;}
  public list(scope:BookScope):SettingGapView[]{assertBookScope(scope);return this.repository.list(scope).map(view);}
  public discover(scope:BookScope,input:{scopeType:'volume'|'event'|'chapter';scopeId:string;question:string;whyNeeded:string;
    affectedObjects?:string[]}):SettingGapView{
    assertBookScope(scope);const scopeId=required(input.scopeId,'发现位置'),question=required(input.question,'缺少的设定'),
      whyNeeded=required(input.whyNeeded,'为什么现在需要');
    const replay=this.repository.list(scope).find(row=>row.discovered_scope_type===input.scopeType
      &&row.discovered_scope_id===scopeId&&row.question===question&&row.decision_status!=='decided');
    if(replay!==undefined)return view(replay);
    const id=this.ids.next(),now=this.clock.now().toISOString();
    this.repository.insert(scope,{id,scopeType:input.scopeType,scopeId,question,whyNeeded,
      affectedObjects:[...new Set((input.affectedObjects??[]).map(item=>item.trim()).filter(Boolean))],now});
    return view(this.repository.get(scope,id)!);
  }
  public decide(scope:BookScope,gapId:string,input:{decision:'design_now'|'not_used_this_volume'|'keep_unknown';
    resolvedSettingVersionId?:string|null}):SettingGapView{
    assertBookScope(scope);const row=this.repository.get(scope,gapId);if(row===undefined)throw missing();
    const resolved=input.resolvedSettingVersionId?.trim()||null;
    const status=input.decision==='design_now'&&resolved===null?'needs_setting':'decided',now=this.clock.now().toISOString();
    this.unitOfWork.run(()=>{
      if(!this.repository.decide(scope,gapId,{decision:input.decision,resolvedVersionId:resolved,status,now}))
        throw new DomainError(errorCodes.bookVersionConflict,'这项缺口已经处理或状态发生变化，请刷新后再试。',{},false,409);
      if(status==='decided'&&input.decision!=='design_now')this.repository.insertClause(scope,{
        id:`${scope.bookId}:setting-gap:${gapId}`,kind:input.decision==='keep_unknown'?'blank':'boundary',
        statement:input.decision==='keep_unknown'?`保持未知：${row.question}`:`当前${scopeLabel(row.discovered_scope_type)}不使用：${row.question}`,
        strength:input.decision==='keep_unknown'?'open_space':'current_task',scopeType:row.discovered_scope_type,
        scopeId:row.discovered_scope_id,sourceVersionId:`setting-gap:${gapId}`,now});
    });
    return view(this.repository.get(scope,gapId)!);
  }
}
function view(row:SettingGapRow):SettingGapView{return{gapId:row.setting_gap_decision_id,scopeType:row.discovered_scope_type,
  scopeId:row.discovered_scope_id,question:row.question,whyNeeded:row.why_needed,
  affectedObjects:JSON.parse(row.affected_objects_json) as string[],decision:row.decision_status==='pending'?null:row.decision,
  status:row.decision_status,resolvedSettingVersionId:row.resolved_setting_version_id,createdAt:row.created_at,updatedAt:row.updated_at};}
function required(value:string,label:string){const text=value.trim();if(text.length===0)throw new DomainError(errorCodes.validation,label+'不能为空。');return text;}
function scopeLabel(value:string){return value==='volume'?'卷':value==='event'?'事件':'章节';}
function missing(){return new DomainError(errorCodes.bookNotFound,'设定缺口不存在或不属于当前书籍。',{},false,404);}