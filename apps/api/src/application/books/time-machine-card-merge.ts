import type {ContextCard} from '@wenmi/time-machine-core';

/** Short aliases only transport provenance; the stored card always uses original source keys. */
export function prepareCardMerge(cards:ContextCard[]) {
 const keys=[...new Set(cards.flatMap(card=>Object.values(card.fields).flatMap(claims=>claims.flatMap(claim=>claim.sourceKeys))))];
 const aliases=new Map(keys.map((key,index)=>[key,`s${index+1}`]));
 const originals=new Map([...aliases].map(([key,alias])=>[alias,key]));
 const fields=cards.map(card=>Object.fromEntries(Object.entries(card.fields).map(([field,claims])=>[field,claims.map(claim=>({...claim,sourceKeys:claim.sourceKeys.map(key=>aliases.get(key)!)}))])));
 return {fields,restore(value:unknown):unknown {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('合并短卡格式错误');
  const result=value as Record<string,unknown>;
  if(!result.fields||typeof result.fields!=='object'||Array.isArray(result.fields))throw Error('合并短卡缺少六栏');
  const restored=Object.fromEntries(Object.entries(result.fields).map(([field,claims])=>{
   if(!Array.isArray(claims))throw Error('短卡栏目必须是数组');
   return [field,claims.map(claim=>{
    if(!claim||typeof claim.text!=='string'||!Array.isArray(claim.sourceKeys))throw Error('短卡条目格式错误');
    const sourceKeys=[...new Set(claim.sourceKeys.map((alias:unknown)=>{
     if(typeof alias!=='string'||!originals.has(alias))throw Error('引用只能使用本次输入的来源短编号');
     return originals.get(alias)!;
    }))];
    return {text:claim.text,sourceKeys};
   })];
  }));
  // Reject oversized output rather than silently cutting facts or conditions.
  if(JSON.stringify(restored).length>6000)throw Error('合并后资料仍过长：请归纳到更少的完整要点，去掉不影响全书方向的细节，保留主角、能力条件和作者要求，不可直接拼接两卡');
  return {...result,fields:restored};
 }};
}

export const cardMergeGuidance=`这是全书方向资料的归纳合并，不是逐项汇编。来源编号已缩写为s1、s2等，输出sourceKeys必须使用本次输入的短编号，系统负责还原。
合并重复及同一主体的关联要点，只保留决定故事方向的核心构想、主角动机与能力边界、关键世界矛盾、作者指定开局结局和明确偏好禁令。局部操作步骤、例子、重复解释不搬入总卡，仍保存在原资料供后续查阅。
不能把不同人物、条件和例外混淆，不把建议变成事实。优先用少量完整句归纳同一事实，禁止直接把两卡数组拼接。六栏text合计目标约1500—2200字符，资料少则更短；来源只引用支持该要点的输入来源，不给每条附上全卡所有来源。不要为了凑字数扩写。归纳后仍须保留关键约束，后续会逐页回查原文。`;
