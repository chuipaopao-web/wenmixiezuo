// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {AuditedMethodsPage} from './AuditedMethodsPage';
import {AUDITED_METHODS,AUDIT_ORIGINAL_COUNT,AUDIT_COPY_CHANGES} from '../../backend/planning-methods/audited-method-catalog';
vi.mock('./RhythmAssetsPage',()=>({RhythmAssetsPage:()=> <p>真实供给配置入口</p>}));
afterEach(cleanup);
it('原338来源全部可追溯，恢复用途不同项，所有卡有逐项条件',()=>{
 const keys=[...AUDITED_METHODS.map(m=>m.key),...AUDITED_METHODS.flatMap(m=>m.aliases.map(a=>a.key))];
 expect(new Set(keys).size).toBe(AUDIT_ORIGINAL_COUNT);expect(keys.length).toBe(338);expect(AUDITED_METHODS).toHaveLength(333);
 for(const key of ['counterpoint-juxtaposition','bittersweet-exchange','clues-reframe-understanding'])expect(AUDITED_METHODS.some(m=>m.key===key)).toBe(true);
 expect(AUDIT_COPY_CHANGES).toBeGreaterThan(30);
 expect(AUDITED_METHODS.every(m=>m.when.length>10&&m.intro.length>5&&m.states.length===5)).toBe(true);
 expect(new Set(AUDITED_METHODS.map(m=>m.when)).size).toBe(333);
});
it('时光机不自动供给具体素材，宏观节奏可以用于卷链，原则不伪装模板',()=>{
 expect(AUDITED_METHODS.filter(m=>m.family!=='叙事方法').every(m=>m.states[0]==='-'&&m.states[1]==='-')).toBe(true);
 expect(AUDITED_METHODS.find(m=>m.key==='six-act')!.states.slice(2,4)).toEqual(['c','c']);
 expect(AUDITED_METHODS.find(m=>m.key==='causal-chain')!.states.every(s=>s==='r')).toBe(true);
 expect(AUDITED_METHODS.find(m=>m.key==='bittersweet-exchange')!.intro).not.toContain('永久');
});
it('查校正用途与原名，清空结果不显示无关说明，真实运行入口明确',()=>{
 render(<AuditedMethodsPage/>);expect(screen.getByRole('heading',{name:'方法库与适用规则'})).toBeVisible();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'全书基线'}));expect(screen.getByRole('heading',{name:'全书基线不需要方法目录'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'完整库'}));
 fireEvent.change(screen.getByLabelText('查找校正方法'),{target:{value:'资源匮乏'}});
 expect(screen.getByRole('button',{name:/资源挤压/})).toBeVisible();
 fireEvent.change(screen.getByLabelText('查找校正方法'),{target:{value:'不存在的名称'}});expect(screen.getByText('选择左侧方法查看。')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'当前生效的方法配置'}));expect(screen.getByText('真实供给配置入口')).toBeVisible();
});
