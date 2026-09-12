import {parseCard,type ContextCard} from '@wenmi/time-machine-core';

/** Apply explicit edits only. Unmentioned claims retain their text and provenance. */
export function applyTimeMachineCardEdits(card:ContextCard,value:unknown):ContextCard {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('短卡修正格式错误');
 const payload=value as Record<string,unknown>;
 if(Object.keys(payload).some(key=>key!=='edits')||!Array.isArray(payload.edits)||payload.edits.length>30)throw Error('请只返回edits条目修正');
 const fields=structuredClone(card.fields),seen=new Set<string>();
 const removals:{field:keyof ContextCard['fields'];index:number}[]=[];
 for(const raw of payload.edits){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('修正条目格式错误');
  const edit=raw as Record<string,unknown>;
  if(Object.keys(edit).some(key=>!['field','action','index','expectedText','claim'].includes(key)))throw Error('修正条目包含未知字段');
  const field=edit.field as keyof ContextCard['fields'];
  if(!Object.hasOwn(fields,field))throw Error('修正栏目不存在');
  if(edit.action==='add'){
   if(edit.index!==undefined||edit.expectedText!==undefined)throw Error('新增条目无需原条目位置');
   fields[field].push(edit.claim as ContextCard['fields'][typeof field][number]);
  }else if(edit.action==='replace'||edit.action==='remove'){
   const index=edit.index as number,key=`${field}:${index}`;
   if(!Number.isSafeInteger(index)||index<0||seen.has(key)||card.fields[field][index]?.text!==edit.expectedText||typeof edit.expectedText!=='string')throw Error('原条目位置或原文不匹配');
   seen.add(key);
   if(edit.action==='replace')fields[field][index]=edit.claim as ContextCard['fields'][typeof field][number];
   else {if(edit.claim!==undefined)throw Error('删除条目无需新内容');removals.push({field,index});}
  }else throw Error('修正动作不支持');
 }
 for(const {field,index} of removals.sort((a,b)=>b.index-a.index))fields[field].splice(index,1);
 return parseCard({...card,fields});
}
