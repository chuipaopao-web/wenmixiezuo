import {describe,it,expect} from 'vitest';
import {compileContext,parseCard,type ContextCard} from '../../rebuild/packages/time-machine-core/src/context.js';
const scope={ownerId:'private-owner',bookId:'private-book'};
const card:ContextCard={...scope,manifest:{sources:[{kind:'opening',id:'o',revision:'v1',hash:'a'.repeat(64)},{kind:'intent',id:'i',revision:'v1',hash:'b'.repeat(64)}],templateRevision:'1',redactionRevision:'1'},fields:{premise:[{text:'无灵根修理工开工坊',sourceKeys:['opening:o:v1']}],protagonists:[{text:'林舟',sourceKeys:['opening:o:v1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
const budget={window:3000,output:1000,tools:500,safety:200,routeRevision:'1'};
const counter={id:'test-byte-upper-bound',mode:'conservative' as const,count:(text:string)=>Buffer.byteLength(text,'utf8')};
describe('short card context boundary',()=>{
 it('keeps provenance while excluding private account metadata',()=>{const result=compileContext(scope,card,'设计骨架',budget,counter);expect(result.input).not.toContain(scope.ownerId);expect(result.input).not.toContain(scope.bookId);expect(result.input).toContain('opening:o:v1');expect(result.tokens.total).toBeLessThan(budget.window);});
 it('rejects foreign scope, fabricated references and unexpected fields',()=>{expect(()=>compileContext({...scope,bookId:'other'},card,'设计',budget,counter)).toThrow('当前书籍');const c=structuredClone(card);c.fields.premise[0]!.sourceKeys=['setting:invented:v1'];expect(()=>parseCard(c)).toThrow('引用');expect(()=>parseCard({...card,apiKey:'secret'})).toThrow('未知字段');});
 it('never silently truncates and separates cache by owner, version and route',()=>{expect(()=>compileContext(scope,card,'设计',{...budget,window:1000},counter)).toThrow('超预算');const a=compileContext(scope,card,'设计',budget,counter);const other={ownerId:'other',bookId:scope.bookId};expect(compileContext(other,{...card,...other},'设计',budget,counter).cacheKey).not.toBe(a.cacheKey);expect(compileContext(scope,card,'设计',{...budget,routeRevision:'2'},counter).cacheKey).not.toBe(a.cacheKey);});
 it('rejects missing route or invalid token accounting',()=>{expect(()=>compileContext(scope,card,'设计',{...budget,routeRevision:''},counter)).toThrow('路由');expect(()=>compileContext(scope,card,'设计',budget,{...counter,count:()=>NaN})).toThrow('计量');});
});
