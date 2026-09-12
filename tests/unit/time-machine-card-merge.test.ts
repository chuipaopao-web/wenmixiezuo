import {it,expect} from 'vitest';
import type {ContextCard} from '@wenmi/time-machine-core';
import {prepareCardMerge} from '../../apps/api/src/application/books/time-machine-card-merge.js';
const card=(text:string,sourceKeys:string[])=>({fields:{premise:[{text,sourceKeys}],protagonists:[],world:[],openingEnding:[],preferences:[],prohibitions:[]}} as unknown as ContextCard);
it('aliases the same original source consistently across cards and restores provenance without changing evidence',()=>{
 const a=card('只有付出代价才能发动',['setting:ability:version-001']);
 const b=card('代价有例外',['setting:ability:version-001','setting:exception:version-002']);
 const before=JSON.stringify([a,b]);const merge=prepareCardMerge([a,b]);
 expect(merge.fields[0]!.premise[0]!.sourceKeys).toEqual(['s1']);
 expect(merge.fields[1]!.premise[0]!.sourceKeys).toEqual(['s1','s2']);
 expect(merge.restore({fields:{world:[{text:'发动需要代价，特殊条件下例外',sourceKeys:['s1','s2','s1']}]}})).toEqual({fields:{world:[{text:'发动需要代价，特殊条件下例外',sourceKeys:['setting:ability:version-001','setting:exception:version-002']}]}});
 expect(JSON.stringify([a,b])).toBe(before);
});
it('does not allow an invented source or an unscoped original key',()=>{
 const merge=prepareCardMerge([card('事实',['source'])]);
 for(const source of ['s2','source',3])expect(()=>merge.restore({fields:{premise:[{text:'事实',sourceKeys:[source]}]}})).toThrow('来源短编号');
});
it('rejects cumulative oversized output without truncating conditions',()=>{
 const merge=prepareCardMerge([card('事实',['source'])]);
 const input={fields:{premise:[{text:'条件'.repeat(3100),sourceKeys:['s1']}]}};
 expect(()=>merge.restore(input)).toThrow('合并后资料仍过长');
 expect(input.fields.premise[0]!.text).toHaveLength(6200);
});
