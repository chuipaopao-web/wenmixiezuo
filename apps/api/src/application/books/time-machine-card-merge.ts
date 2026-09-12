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

export const cardMergeGuidance=`这是全书方向资料的归纳合并，不是逐项汇编。返回JSON {"fields":{"premise":[],"protagonists":[],"world":[],"openingEnding":[],"preferences":[],"prohibitions":[]}}，每条为{"text":"归纳要点","sourceKeys":["s1"]}。来源编号已缩写为s1、s2等，输出sourceKeys必须使用本次输入的短编号，系统负责还原。
读者是准备推荐故事线和设计全书方向的主编，不是设计具体场景的编剧。premise保留题材和核心构想；protagonists保留核心人物目标与能力边界；world只说明全局秩序与矛盾；openingEnding保留作者指定节点；preferences保留体量风格；prohibitions只保留明确禁令。未知空数组。
将同一系统的数十条操作规则归纳为几项核心机制，不逐条复制。world通常只需要3—6个综合要点：比如配送系统的接单、结算、信用、纠纷细则应归纳其基本驱动力和不能突破的边界，而不是每条细则各占一个条目。这是归纳粒度示范，禁止把示范内容写进本书。
合并重复及同一主体的关联要点，只保留决定故事方向的核心构想、主角动机与能力边界、关键世界矛盾、作者指定开局结局和明确偏好禁令。局部操作步骤、例子、重复解释不搬入总卡，仍保存在原资料供后续查阅。
不能把不同人物、条件和例外混淆，不把建议变成事实。优先用少量完整句归纳同一事实，禁止直接把两卡数组拼接。六栏text合计不得超过2200字符，目标约1200—1800字符，资料少则更短；整卡通常10—18个综合要点，而不是几十条规则。来源只引用支持该要点的输入来源，不给每条附上全卡所有来源。不要为了凑字数扩写。归纳后仍须保留关键约束，后续会逐页回查原文。仅返回简短JSON，不输出解释或自查过程。`;
