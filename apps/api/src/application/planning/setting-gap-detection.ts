import {DomainError,errorCodes} from '../../domain/errors.js';
import type {BookScope} from '../../domain/scope.js';
import type {SettingGapService} from '../knowledge/setting-gap-service.js';

export const SETTING_GAP_OUTPUT_INSTRUCTION =
  '只有当前任务在不新增正式设定事实就无法继续时，才返回settingGaps（最多1项），写清缺什么、为什么此刻必须知道、影响哪些对象；作者偏好、可保留的谜团、可自由发挥处和普通剧情选择都不是设定缺口。settingGaps非空时可以只输出该字段；能继续设计时必须返回空数组，绝不自行补成全书事实。';

export interface DetectedSettingGap {
  question:string;
  whyNeeded:string;
  affectedObjects:string[];
}

export function parseDetectedSettingGaps(output:string):DetectedSettingGap[]{
  const values:unknown[]=[];
  try{values.push(JSON.parse(output) as unknown);}catch{}
  for(const object of jsonObjects(output))try{values.push(JSON.parse(object) as unknown);}catch{}
  for(const value of values){
    const record=asRecord(value);if(record===null)continue;
    const raw=record.settingGaps??record.setting_gaps;
    if(!Array.isArray(raw))continue;
    return raw.slice(0,3).map((item,index)=>{
      const gap=asRecord(item);if(gap===null)throw new Error(`第${index+1}项设定缺口格式无效。`);
      const question=text(gap.question,'缺少什么设定',400);
      const whyNeeded=text(gap.whyNeeded??gap.why_needed,'为什么当前任务必须知道',1000);
      const affectedRaw=gap.affectedObjects??gap.affected_objects??[];
      if(!Array.isArray(affectedRaw))throw new Error('设定缺口影响对象必须是数组。');
      const affectedObjects=[...new Set(affectedRaw.filter((item):item is string=>typeof item==='string')
        .map(item=>item.trim()).filter(Boolean))].slice(0,20);
      return{question,whyNeeded,affectedObjects};
    });
  }
  return[];
}

export function stopForDetectedSettingGaps(input:{
  output:string;service:SettingGapService|undefined;scope:BookScope;
  scopeType:'volume'|'event'|'chapter';scopeId:string;
}):void{
  const gaps=parseDetectedSettingGaps(input.output);
  if(gaps.length===0||input.service===undefined)return;
  for(const gap of gaps)input.service.discover(input.scope,{scopeType:input.scopeType,scopeId:input.scopeId,...gap});
  throw new DomainError(errorCodes.operationIncomplete,
    `AI发现${gaps.length}项当前设计确实需要的设定，请先选择“现在补充设计”“这一层先不用”或“保持未知”，再继续本轮生成。`,
    {settingGapCount:gaps.length},false,409);
}

function text(value:unknown,label:string,max:number):string{
  if(typeof value!=='string'||value.trim().length===0)throw new Error(label+'不能为空。');
  const result=value.trim();if(result.length>max)throw new Error(label+'过长。');return result;
}
function asRecord(value:unknown):Record<string,unknown>|null{return typeof value==='object'&&value!==null&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;}
function jsonObjects(value:string):string[]{
  const result:string[]=[];let start=-1,depth=0,inString=false,escaped=false;
  for(let index=0;index<value.length;index+=1){const char=value[index]!;
    if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue;}
    if(char==='"'){inString=true;continue;}if(char==='{'){if(depth===0)start=index;depth+=1;continue;}
    if(char==='}'&&depth>0){depth-=1;if(depth===0&&start>=0){result.push(value.slice(start,index+1));start=-1;}}
  }
  return result;
}