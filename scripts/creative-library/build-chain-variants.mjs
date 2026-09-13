import {readFileSync,writeFileSync} from 'node:fs';
const c5=JSON.parse(readFileSync('scripts/creative-library/generated/chain-rhythm.json','utf8'));
const limit='仅供链页面·链分章设计。余韵0—3章，最多3章，可以不写；已在高潮或结果章收束就不额外安排。不凑三章，不强制各方震惊。可在章内用短场景完成，长期影响融入后续正常剧情，不以余韵名义持续延长。';
const entries=c5.entries.map(e=>({...e,expectedRevision:e.expectedRevision+1,expectedPayload:e.payload,payload:e.expectedPayload}));
const additions=entries.filter(e=>['宏观节奏','情绪节奏'].includes(e.payload.method.usageTree)).map(e=>{
 const p=structuredClone(e.payload),original=p.name;
 p.name=p.shortPhrase=p.method.title=original.includes('余韵')?original+'（链分章）':original+'＋余韵';
 p.summary='链分章专用：借用“'+original+'”安排本链各章，按结果分量选择0—3章余韵。';
 p.aliases=[original,'链分章','余韵'];p.method.aliases=[original,'链分章'];
 p.method.instruction='在链页面，基于已经确定的本链目标、过程、结果安排章纲。保留来源节奏的特点，把各环节缩放到本链各章，不按全书或卷的容量规划。来源结构：'+e.payload.method.instruction+'\n分章落实：兑现关键冲突后，判断是否需要当事人反应、关系或利益变化、相关方行动来呈现结果影响；已有同类收束环节就完善它，不重复叠加。'+limit;
 p.method.boundary='来源：'+e.code+'「'+original+'」，原卡独立保留。本卡不用于开书、全书分卷、卷分链或单章正文生成。'+limit+'\n适用边界：选择适合本链的节奏，不要求每条链都使用同一种结构；只安排有实际内容的反应与影响，不以重复惊叹或重新复述事件填充章节。';
 p.method.applicableLayers=['chain_chapters'];p.method.conditionalUses=[];
 return {identity:'r209-c6/chain-variant-'+e.code,sourceCode:e.code,payload:p};
});
if(entries.length!==33||additions.length!==32)throw Error('节奏清单变化，重新核对');
writeFileSync('scripts/creative-library/generated/chain-variants.json',JSON.stringify({batch:'r209-c6',expectedReleaseId:'a785f7dc-bdb9-4af3-bf8a-5506465828dc',entries,additions},null,2));
console.log(JSON.stringify({restore:entries.length,newCards:additions.length}));
