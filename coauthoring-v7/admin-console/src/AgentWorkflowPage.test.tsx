// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {AgentWorkflowPage,WORKFLOW_SECTIONS} from './AgentWorkflowPage';
import {AUDITED_METHODS,AUDIT_MERGES} from '../../backend/planning-methods/audited-method-catalog';
import {DEFAULT_RHYTHM_POLICY} from '../../backend/planning-methods/rhythm-policy';
afterEach(cleanup);
it('单一正文包含完整执行合同，区分已实现和待实施',()=>{
 expect(WORKFLOW_SECTIONS).toHaveLength(17);
 const text=WORKFLOW_SECTIONS.map(s=>s.body).join('\n');
 for(const token of ['章纲设计','正文创作','search_methods','read_sources','SelectionRecord','结果未知','直接沿用','局部补充','重新选材'])expect(text).toContain(token);
 expect(text).toContain('校正版尚未成为运行引用版本');expect(text).toContain('不是固定两次调用');
});
it('校正卡可以被代码定位但不冒充已接入生产，合并来源全部可解析',()=>{
 const originals=[...AUDITED_METHODS.map(m=>m.key),...AUDITED_METHODS.flatMap(m=>m.aliases.map(a=>a.key))];
 expect(new Set(originals).size).toBe(338);
 for(const merge of AUDIT_MERGES){const target=AUDITED_METHODS.find(m=>m.key===merge.to)!;expect(target.aliases.some(a=>a.key===merge.from)).toBe(true);}
 expect(DEFAULT_RHYTHM_POLICY.cards).toHaveLength(330);expect(AUDITED_METHODS).toHaveLength(333);
});
it('可通过目录和搜索查看各层及空结果，原文不解释成HTML',()=>{
 render(<AgentWorkflowPage/>);
 expect(screen.getByRole('heading',{name:'1. 当前到底实现了什么'})).toBeVisible();
 fireEvent.change(screen.getByLabelText('文档章节'),{target:{value:'5'}});
 expect(screen.getByRole('heading',{name:'6. 每层需要的资料与查询规则'})).toBeVisible();
 expect(screen.getByText('正文创作')).toBeVisible();
 fireEvent.change(screen.getByLabelText('搜索流程文档'),{target:{value:'不存在的词语xyz'}});
 expect(screen.getByText('没有匹配章节，请调整关键词。')).toBeVisible();
 fireEvent.change(screen.getByLabelText('搜索流程文档'),{target:{value:'工具合同'}});
 expect(screen.getByRole('heading',{name:'9. 工具合同与查询过程'})).toBeVisible();
});
