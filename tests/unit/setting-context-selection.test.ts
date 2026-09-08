import { describe, expect, it } from 'vitest';
import { selectSettingContext, settingSelectionPages, settingSelectionPrompt, SETTING_SELECTION_PROMPT_LIMIT } from '../../apps/api/src/application/books/setting-context-selection.js';

const facts = Array.from({ length: 30 }, (_, i) => ({ id: `${i}:0`, itemKey: `setting-${i}`, label: `规则${i}`, authority: i % 2 ? 'candidate' : 'confirmed', text: `规则${i}：凭驿券通行；夜禁，军令例外。${'旧设定'.repeat(750)}` }));
describe('设定资料分批选择', () => {
  it('超过原工位容量的资料完整分页，保留末页必要事实，不混入未选内容', async () => {
    const original = JSON.stringify(facts); const prompts: string[] = [];
    const result = await selectSettingContext({facts, prefix:'作者要求：保留军令例外', select: async prompt => {
      prompts.push(prompt);
      const page = JSON.parse(prompt.split('【可选事实】')[1]!.split('\n')[0]!);
      return JSON.stringify({selectedFactIds:page.filter((f: {id:string})=>f.id==='29:0').map((f:{id:string})=>f.id), blocked:false});
    }, build: ids => facts.filter(f=>ids.has(f.id))});
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts.every(p=>Array.from(p).length<=SETTING_SELECTION_PROMPT_LIMIT)).toBe(true);
    expect(result).toEqual([facts[29]]); expect(JSON.stringify(facts)).toBe(original);
    expect(settingSelectionPages(facts,'').flat()).toEqual(facts);
  });
  it('不接受跨页或不存在ID，单条过长不裁切', async () => {
    await expect(selectSettingContext({facts, prefix:'', select:async()=>'{"selectedFactIds":["missing"]}',build:()=>true})).rejects.toThrow('不存在');
    expect(()=>settingSelectionPages([{...facts[0]!,text:'甲'.repeat(50_000)}],'')).toThrow('单条');
  });
  it('合并仍超量时重新选择，无法再缩减则停止，不无限调用', async () => {
    let calls=0;
    const result = await selectSettingContext({facts:facts.slice(0,3),prefix:'',select:async()=>JSON.stringify({selectedFactIds:++calls===1?['0:0','1:0']:['1:0']}),build:ids=>{if(ids.size>1)throw Error('overflow');return [...ids];}});
    expect(result).toEqual(['1:0']); expect(calls).toBe(2);
    await expect(selectSettingContext({facts:facts.slice(0,1),prefix:'',select:async()=>'{"selectedFactIds":["0:0"]}',build:()=>{throw Error('overflow');}})).rejects.toThrow('容量');
    expect(settingSelectionPrompt('',[])).toContain('空数组');
  });
});
