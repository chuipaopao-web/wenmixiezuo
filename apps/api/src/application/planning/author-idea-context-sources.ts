import type { ContextSource } from '../memory/context-pack-service.js';

export interface AuthorIdeaContextItem {
  id:string;
  intentStrength:string;
  originalText:string;
  scopeNotes:string|null;
  subjectId?:string;
}

export interface AuthorIdeaContextSourceOptions {
  sourceTypePrefix:string;
  sourceId:string;
  layer:'planning'|'execution';
}

/**
 * 作者原话必须保留原始强度。传输层的 hard 表示保证装入资料包，
 * 不等于内容是既成事实；constraintStrength 才表达创作约束强弱。
 */
export function authorIdeaContextSources(
  ideas:AuthorIdeaContextItem[],options:AuthorIdeaContextSourceOptions
):{hardSources:ContextSource[];optionalSources:ContextSource[]} {
  const active=ideas.filter(idea=>idea.originalText.trim().length>0);
  const groups={
    must:active.filter(idea=>idea.intentStrength==='must'),
    preference:active.filter(idea=>idea.intentStrength==='preference'),
    inspiration:active.filter(idea=>idea.intentStrength==='inspiration'),
    question:active.filter(idea=>idea.intentStrength==='question')
  };
  const source=(kind:keyof typeof groups,priority:number,constraintStrength:NonNullable<ContextSource['constraintStrength']>,reason:string):ContextSource=>({
    sourceType:`${options.sourceTypePrefix}:${kind}`,
    sourceId:`${options.sourceId}:${kind}`,
    content:JSON.stringify(groups[kind]),reason,priority,constraintStrength,truthStatus:'planned',scopeType:'task',scopeId:options.sourceId
  });
  const hardSources:ContextSource[]=[];
  if(groups.must.length>0)hardSources.push(source('must',100,'current_task',
    '作者明确标为必须遵守的当前对象要求；必须执行，若撞上已确认事实须停止并向作者说明冲突。'));
  if(groups.preference.length>0)hardSources.push(source('preference',90,'soft_reference',
    options.layer==='planning'
      ?'作者强烈偏好；优先体现在故事方向中，专业上必须调整时说明理由，不得冒充硬事实。'
      :'作者强烈偏好；执行时优先落实，只有与已确认事实或上层冻结责任冲突时才作最小调整并说明。'));
  const optionalSources:ContextSource[]=[];
  if(groups.inspiration.length>0)optionalSources.push(source('inspiration',55,'soft_reference',
    '作者灵感；只提供启发，可以变形、组合或不用，不能自动升级为正式约束。'));
  if(groups.question.length>0)optionalSources.push(source('question',60,'open_space',
    '作者待回答的问题；只帮助识别未知和需要说明之处，不能自动写入规划或正文，作者确认后才成为决定。'));
  return{hardSources,optionalSources};
}