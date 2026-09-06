import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BookBlueprintPanel} from './BookBlueprintPanel';
import type {PlanningTreeView} from './opening-api';
afterEach(cleanup);
it('阶段、卷和故事线分别展示，候选不能直接进入卷创作',()=>{
 const plan:PlanningTreeView={treeKind:'book',scopeId:'book-141',revision:1,status:'candidate',title:'测试书',root:{key:'root',title:'测试书',budget:{wordTarget:600000},children:[{key:'v1',kind:'volume',sequence:1,title:'军中求生',budget:{wordTarget:600000},story:{protagonistChange:'获得战友信任'},linkedTree:{scopeId:'volume-one'}}]} as PlanningTreeView['root'],
 bookBlueprint:{schema:'book-blueprint-v1',endingPromise:'建立新秩序',storylines:[{key:'line',title:'守护乡里',goal:'让乡亲安居',development:'由求生转向治理',resolution:'建立公开法度'}],stages:[{key:'stage',title:'立足与治理',startState:'无兵无地',gain:'获得同伴',cost:'承担责任',causalBridge:'形成新的秩序',rhythm:'承压后积累',volumeKeys:['v1'],storylineKeys:['line']}]}};
 const adjust=vi.fn(); const {rerender}=render(<BookBlueprintPanel tree={plan} onAdjust={adjust}/>);
 expect(screen.getByText('1个阶段 · 1卷 · 60万字')).toBeVisible();expect(screen.getByText('获得同伴')).toBeVisible();
 expect(screen.queryByRole('link',{name:/进入本卷/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'故事线'}));expect(screen.getByText('让乡亲安居')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'调整全书路线'}));expect(adjust).toHaveBeenCalledOnce();
 rerender(<BookBlueprintPanel tree={{...plan,status:'confirmed'}} onAdjust={adjust}/>);fireEvent.click(screen.getByRole('button',{name:'阶段路线'}));
 expect(screen.getByRole('link',{name:/进入本卷/}).getAttribute('href')).toContain('volumeId=volume-one');
});
