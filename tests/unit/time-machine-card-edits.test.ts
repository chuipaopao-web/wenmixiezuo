import {describe,it,expect} from 'vitest';
import {applyTimeMachineCardEdits} from '../../apps/api/src/application/books/time-machine-card-edits.js';
import type {ContextCard} from '@wenmi/time-machine-core';
const claim=(text:string)=>({text,sourceKeys:['opening:o:1']});
const card:ContextCard={ownerId:'owner',bookId:'book',manifest:{sources:[{kind:'opening',id:'o',revision:'1',hash:'a'.repeat(64)},{kind:'intent',id:'i',revision:'1',hash:'b'.repeat(64)}],templateRevision:'1',redactionRevision:'1'},fields:{premise:[claim('建立工坊')],protagonists:[claim('林舟')],world:[claim('旧规则'),claim('另一规则')],openingEnding:[],preferences:[],prohibitions:[]}};
describe('explicit short-card edits',()=>{
 it('preserves unrelated claims and applies positions against the original card',()=>{
  const result=applyTimeMachineCardEdits(card,{edits:[{field:'world',action:'remove',index:0,expectedText:'旧规则'},{field:'world',action:'replace',index:1,expectedText:'另一规则',claim:claim('修正规则')}]});
  expect(result.fields.world).toEqual([claim('修正规则')]);expect(result.fields.protagonists).toEqual(card.fields.protagonists);expect(card.fields.world).toHaveLength(2);
 });
 it('rejects deleting the last protagonist and invented evidence',()=>{
  expect(()=>applyTimeMachineCardEdits(card,{edits:[{field:'protagonists',action:'remove',index:0,expectedText:'林舟'}]})).toThrow('缺少核心');
  expect(()=>applyTimeMachineCardEdits(card,{edits:[{field:'world',action:'add',claim:{text:'假规则',sourceKeys:['setting:fake:1']}}]})).toThrow('引用');
 });
 it('rejects stale positions, duplicate edits and whole-card replacement',()=>{
  const edit={field:'world',action:'remove',index:0,expectedText:'不匹配'};
  expect(()=>applyTimeMachineCardEdits(card,{edits:[edit]})).toThrow('不匹配');
  const valid={...edit,expectedText:'旧规则'};
  expect(()=>applyTimeMachineCardEdits(card,{edits:[valid,valid]})).toThrow('不匹配');
  expect(()=>applyTimeMachineCardEdits(card,{fields:card.fields})).toThrow('edits');
 });
});
