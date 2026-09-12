import {it,expect} from 'vitest';
import {packCardSources} from '../../apps/api/src/application/books/time-machine-source-pages.js';
it('keeps modest Chinese sources together rather than splitting every 1800 characters',()=>{
 const docs=[{key:'opening:1',text:'甲'.repeat(3500)},{key:'setting:1',text:'乙'.repeat(500)}];
 expect(packCardSources(docs)).toEqual([docs]);
});
it('preserves all long source text and escaping with bounded pages and intact emoji',()=>{
 const docs=[{key:'opening:1',text:'中"\n\\😀'.repeat(2600)},{key:'setting:1',text:'末尾条件不可省略'}];
 const pages=packCardSources(docs);
 expect(pages.length).toBeGreaterThan(1);
 for(const page of pages)expect(JSON.stringify(JSON.stringify(page)).length).toBeLessThanOrEqual(5500);
 for(const doc of docs)expect(pages.flat().filter(d=>d.key===doc.key).map(d=>d.text).join('')).toBe(doc.text);
 for(const d of pages.flat()){expect(/^[\uDC00-\uDFFF]/u.test(d.text)).toBe(false);expect(/[\uD800-\uDBFF]$/u.test(d.text)).toBe(false);}
});
it('does not discard empty sources and rejects unrepresentable source identifiers',()=>{
 expect(packCardSources([{key:'empty',text:''}])).toEqual([[{key:'empty',text:''}]]);
 expect(()=>packCardSources([{key:'k'.repeat(6000),text:''}])).toThrow('来源标记');
});
