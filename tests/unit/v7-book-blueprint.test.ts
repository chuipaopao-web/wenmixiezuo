import {expect,it} from 'vitest';
import {validatePlanningTree,parsePlanningTreeOutput,projectPlanningTreeForChild,buildAuthorPlanningTreeView} from '@wenmi/v7-backend';
import {sampleBook} from '../helpers/book-blueprint-fixture.js';
it('阶段可跨卷，篇幅合计正确，正式投影保留故事线；下层只拿相关阶段',()=>{
 const book=sampleBook();expect(validatePlanningTree(book)).toEqual([]);
 const view=buildAuthorPlanningTreeView({document:book,revision:1,status:'candidate',actuals:[]});expect(view.bookBlueprint?.stages).toHaveLength(3);
 const pack=projectPlanningTreeForChild(book,'scope-v3') as {bookBlueprint:{stages:Array<{key:string}>}};
 expect(pack.bookBlueprint.stages.map(s=>s.key)).toEqual(['expand']);
 expect(book.bookBlueprint?.stages).toHaveLength(3);
});
it('拒绝漏卷、重复卷、错误故事线和错误总字数',()=>{
 const book=sampleBook();book.bookBlueprint!.stages[1]!.volumeKeys=['v2','v4'];expect(validatePlanningTree(book).join()).toContain('恰好');
 book.bookBlueprint!.stages[1]!.volumeKeys=['v3','v4'];book.bookBlueprint!.stages[0]!.storylineKeys=['missing'];expect(validatePlanningTree(book).join()).toContain('引用');
 book.bookBlueprint!.stages[0]!.storylineKeys=['rise'];book.root.budget.wordTarget=100;expect(validatePlanningTree(book).join()).toContain('字数');
});
it('旧树继续可读，新任务缺阶段需补交，已确认字数和卷数不可静默改变',()=>{
 const book=sampleBook();const old=structuredClone(book);delete old.bookBlueprint;
 expect(()=>parsePlanningTreeOutput(JSON.stringify(old),'book',old.scopeId)).not.toThrow();
 expect(()=>parsePlanningTreeOutput(JSON.stringify(old),'book',old.scopeId,undefined,true)).toThrow('bookBlueprint');
 expect(()=>parsePlanningTreeOutput(JSON.stringify(book),'book',book.scopeId,undefined,true,{targetWords:600000,targetVolumes:6})).not.toThrow();
 expect(()=>parsePlanningTreeOutput(JSON.stringify(book),'book',book.scopeId,undefined,true,{targetWords:600000,targetVolumes:12})).toThrow('12卷');
});
