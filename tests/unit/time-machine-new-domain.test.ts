import {describe,it,expect} from 'vitest';
import {projectStory,markers,nextDisplayNumber,validatePlan,type StoryPlan,type FormalChapter,type RecordedEvent} from '../../rebuild/packages/time-machine-core/src/domain.js';
const scope={ownerId:'o',bookId:'b'};
const plan:StoryPlan={...scope,version:'p1',lines:[{id:'main',number:1,role:'main',title:'建立工坊',goal:'立足',parentIds:[]},{id:'branch',number:2,role:'stage',title:'订单',goal:'交付',parentIds:['main']}],seeds:[{id:'letter',number:1,title:'密信',promise:'谁寄的',lineIds:['branch']}]};
const chapter:FormalChapter={...scope,version:'c1',chapter:1,text:'订单交付了，但密信的来历仍然未知。'};
function event(id:string,change:RecordedEvent['change'],order=0):RecordedEvent{return {...scope,id,chapterVersion:chapter.version,chapter:1,order,dependencies:[],change,evidence:[{chapterVersion:'c1',start:0,end:chapter.text.length,quote:chapter.text}],memberId:'recorder',assessment:'supported'};}
describe('new independent time machine core',()=>{
 it('closed branch can bear fruit and an unresolved seed; replay is idempotent',()=>{
  const a=event('a',{kind:'line',targetId:'branch',state:'closed',summary:'订单交付'}),b=event('b',{kind:'seed',targetId:'letter',state:'planted',summary:'密信未解'},1);
  const p=projectStory(plan,[chapter],[b,a,a]);expect(p.events).toHaveLength(2);expect(markers(p,'branch')).toEqual({fruit:true,leafIds:['letter'],needsReview:false});
 });
 it('planning alone is not actual progress and retirement is not payoff',()=>{
  expect(markers(projectStory(plan,[],[]),'branch').fruit).toBe(false);
  const p=projectStory(plan,[chapter],[event('x',{kind:'line',targetId:'branch',state:'stopped',summary:'弃置'})]);expect(markers(p,'branch').fruit).toBe(false);
 });
 it('intersection does not erase lifecycle',()=>{
  const p=projectStory(plan,[chapter],[event('a',{kind:'line',targetId:'branch',state:'active',summary:'推进'}),event('b',{kind:'intersection',lineIds:['main','branch'],summary:'交汇'},1)]);expect(p.lines[1]!.state).toBe('active');expect(p.events).toHaveLength(2);
 });
 it('revised manuscript invalidates old and dependent events without claiming closure',()=>{
  const a=event('a',{kind:'line',targetId:'branch',state:'closed',summary:'交付'});
  const newer={...chapter,version:'c2',chapter:2};const b={...event('b',{kind:'seed',targetId:'letter',state:'answered',summary:'已回答'}),chapter:2,chapterVersion:'c2',dependencies:['a'],evidence:[{...a.evidence[0]!,chapterVersion:'c2'}]};
  const p=projectStory(plan,[{...chapter,version:'replacement'},newer],[a,b]);expect(p.invalidEventIds).toEqual(['a','b']);expect(markers(p,'branch').fruit).toBe(false);expect(p.seeds[0]!.needsReview).toBe(true);
 });
 it('uncertainty remains visible, not a confirmed fruit',()=>{const e={...event('a',{kind:'line',targetId:'branch',state:'closed',summary:'可能完成'}),assessment:'uncertain' as const};const p=projectStory(plan,[chapter],[e]);expect(markers(p,'branch')).toMatchObject({fruit:false,needsReview:true});});
 it('rejects cross-book evidence, invented excerpts and divergent replay',()=>{
  const e=event('a',{kind:'line',targetId:'branch',state:'active',summary:'推进'});
  expect(()=>projectStory(plan,[chapter],[{...e,bookId:'other'}])).toThrow('不属于');
  expect(()=>projectStory(plan,[chapter],[{...e,evidence:[{...e.evidence[0]!,quote:'伪造'}]}])).toThrow('证据');
  expect(()=>projectStory(plan,[chapter],[e,{...e,memberId:'other'}])).toThrow('内容发生变化');
 });
 it('preserves numbers on reorder and rejects cycles; shared seeds count once',()=>{
  expect(nextDisplayNumber([1,5,9])).toBe(10);const reordered={...plan,lines:[...plan.lines].reverse(),seeds:[{...plan.seeds[0]!,lineIds:['main','branch']}]};expect(projectStory(reordered,[],[]).seeds).toHaveLength(1);
  expect(()=>validatePlan({...plan,lines:[{...plan.lines[0]!,parentIds:['branch']},plan.lines[1]!]})).toThrow('循环');
 });
});
