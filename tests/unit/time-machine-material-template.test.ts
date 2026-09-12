import {it,expect} from 'vitest';
import {planningMaterial} from '../../apps/api/src/application/books/time-machine-card-template.js';
it('separates chosen future intent from confirmed material and optional method references without losing conditions',()=>{
 const fields={protagonists:[{text:'无灵根；机甲仅在有灵石且机魂同意时行动',sourceKeys:['opening:opening:1']}]};
 const chosen='主线1：建立工坊；支线2：机魂伙伴';
 const recommended=JSON.parse(planningMaterial(fields,chosen));
 const baseline=JSON.parse(planningMaterial(fields,chosen,{selected:[]}));
 expect(baseline.bookMaterial).toEqual(recommended.bookMaterial);
 expect(baseline.bookMaterial.fields.protagonists).toEqual([fields.protagonists[0].text]);
 expect(JSON.stringify(baseline.bookMaterial)).not.toContain('sourceKeys');
 expect(fields.protagonists[0].sourceKeys).toEqual(['opening:opening:1']);
 expect(baseline.storylineIntent.text).toBe(chosen);
 expect(baseline.storylineIntent.status).toContain('不是正文事实');
 expect(recommended).not.toHaveProperty('methodReference');
});
