import type { BookBlueprint, PlanningTreeDocument, PlanningTreeNode } from '@wenmi/v7-backend';
export function sampleBlueprint(keys=['v1','v2','v3','v4','v5','v6']):BookBlueprint {
  return {schema:'book-blueprint-v1',endingPromise:'张三统一诸州，以公开法度约束旧部，兑现百姓安居的目标。',
    storylines:[{key:'rise',title:'从小兵到建立新秩序',goal:'在乱世守住家人与乡里。',development:'先用军功取得话语权，再学习治理和结盟。',resolution:'统一后让法度约束自己与亲信。'}],
    stages:[{key:'foundation',title:'立足与治理',startState:'无兵无地，依附地方军伍。',gain:'获得军中信任和地方治理能力。',cost:'承担同伴伤亡及豪强敌意。',causalBridge:'赢得立足点后，必须用治理守住成果。',rhythm:'求生承压—立功兑现—治理积累。',volumeKeys:keys,storylineKeys:['rise']}]};
}
export function sampleBook():PlanningTreeDocument {
  const amounts=[40000,80000,100000,120000,130000,130000];
  const node=(key:string,kind:PlanningTreeNode['kind'],sequence:number,words:number):PlanningTreeNode=>({
    key,kind,sequence,title:kind==='book'?'张三建立新秩序':`第${sequence}卷：${['军中求生','县城立足','治理破局','诸城结盟','诸州决战','统一与新法'][sequence-1]}`,
    story:{summary:'通过主动选择改变处境。',majorEvents:['承担共同责任，解决眼前困局。'],protagonistChange:'由依赖他人到能够守护一方。',outcome:'获得信任，也承担更大责任。',nextStep:'新的关系带来新的选择。'},
    emotion:{publicSummary:'从惶恐到获得信任。',openingEmotion:'担忧',pressureMovement:'局势逐步变化。',releaseEmotion:'欣慰',intensity:'mixed'},
    experience:{publicSummary:'看见努力改变现实。',pressureRhythm:'承压与积累交替。',payoffCadence:'关键选择带来可见结果。',informationRhythm:'随行动揭示局势。',contrastWithPrevious:'从个人生存转向共同责任。',designReason:'后期涉及治理与多方协调，篇幅增加。'},
    causality:{trigger:'旧局面已无法维持。',causes:['资源短缺与旧规则限制。'],coreConflict:'求生目标与旧秩序冲突。',turningPoint:'主动承担责任。',consequences:['改变资源与关系。']},threads:{foreshadowing:[],openQuestions:[]},
    budget:{wordTarget:words,chapterRange:null},linkedTree:kind==='volume'?{treeKind:'volume',scopeId:'scope-'+key}:null,children:[]});
  const root=node('book','book',1,600000);root.children=amounts.map((n,i)=>node('v'+(i+1),'volume',i+1,n));
  const blueprint=sampleBlueprint();const stage=blueprint.stages[0]!;
  blueprint.stages=[{...stage,volumeKeys:['v1','v2']},{...stage,key:'expand',title:'治理与结盟',volumeKeys:['v3','v4']},{...stage,key:'resolve',title:'统一与新法',volumeKeys:['v5','v6'],causalBridge:'平息内争，完成制度约束，主目标得到兑现。'}];
  return {schema:'v7-planning-tree-v1',treeKind:'book',scopeId:'book-synthetic-141',title:root.title,root,bookBlueprint:blueprint,
    designStrategy:{libraryRefs:[],originalStrategies:[{title:'以治理承接胜利',applicationNote:'地位提升带来新的治理责任。'}],decisionNote:'阶段按责任变化划分，各阶段跨两卷。'}};
}
