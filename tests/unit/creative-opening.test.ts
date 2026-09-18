import { describe,it,expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { normalizeCreativeProfile, creativeDirective } from '@wenmi/agent-catalog';
import { buildOpeningAgentPrompt } from '../../rebuild/packages/backend/src/legacy-opening/opening-agent/opening-prompt-compiler.js';
import { withBookCreativeProfile } from '../../apps/api/src/application/agents/book-creative-context.js';

describe('创意方向跨节点传递',()=>{
 it('不再全量注入旧库，统一检索运行时按需补充，原始作者意图独立保留',()=>{
  const base={taskId:'creative-test',nodeKey:'opening_package_design' as const,roleKey:'screenwriter' as const,taskKind:'opening_design' as const,workstationKey:'opening' as const,operationMode:'fresh' as const,operation:'v7_opening_package_design_v1' as const,basedOnTaskId:null,authorIdea:'张三在仙侠世界开坦克。',publishingPlatform:'fanqie' as const,ideaVersion:1,referencePack:{references:[],excludedReason:'没有额外参考'},openingPackage:null,review:null,taxonomy:null,validationRepair:null,memberInstruction:'',creativeProfile:normalizeCreativeProfile({scale:5,styles:['沙雕搞怪','猎奇新鲜']})};
  const design=JSON.parse(buildOpeningAgentPrompt(base));
  expect(design.creativeAssets).toBeNull();
  expect(design.internalReferences).toBeNull();
  expect(design.outputTemplate).toHaveProperty('title');
  expect(design.authorSource.originalIdea).toBe(base.authorIdea);
  expect(design.creativeDirection.review).toContain('不因不现实');
  const review=JSON.parse(buildOpeningAgentPrompt({...base,nodeKey:'opening_package_review',roleKey:'chief_editor',taskKind:'opening_review',operation:'v7_opening_package_review_v1'}));
  expect(review.creativeAssets).toBeNull();expect(review.creativeDirection.scale).toBe('极限整活');
 });
 it('验证真实可执行的类型、尺度和偏向，拒绝伪造类型与超量选择',()=>{
  expect(normalizeCreativeProfile().scale).toBe(4);
  for(const workType of ['novel','short_story','memoir','script'] as const) expect(normalizeCreativeProfile({workType}).workType).toBe(workType);
  expect(()=>normalizeCreativeProfile({workType:'space_opera'})).toThrow('作品类型无效');
  expect(()=>normalizeCreativeProfile({scale:99})).toThrow();
  expect(()=>normalizeCreativeProfile({styles:['越权提示']})).toThrow();
  const styles=['沙雕搞怪','猎奇新鲜','经营成长','悬念解谜','快节奏爽'];
  const profile=normalizeCreativeProfile({styles});
  expect(profile.styles).toEqual(styles);
  expect(()=>normalizeCreativeProfile({styles:[...styles,'群像史诗']})).toThrow('最多四个辅助');
  expect(normalizeCreativeProfile({styles:['沙雕搞怪','沙雕搞怪','猎奇新鲜']}).styles).toEqual(styles.slice(0,2));
  for(const stage of ['opening','setting','volume','chapter']) {
   expect(creativeDirective(profile,stage)).toMatchObject({primaryStyle:styles[0],secondaryStyles:styles.slice(1)});
   expect(creativeDirective(profile,stage)?.preferences).toContain('不要求每卷、每章同时体现全部');
  }
  expect(creativeDirective(normalizeCreativeProfile({scale:1}),'setting')?.review).toContain('线索与结论');
 });
 it('四类作品类型各有独立创作方向语义，长篇保持既有网文策略',()=>{
  const base={taskId:'creative-type-test',nodeKey:'opening_package_design' as const,roleKey:'screenwriter' as const,taskKind:'opening_design' as const,workstationKey:'opening' as const,operationMode:'fresh' as const,operation:'v7_opening_package_design_v1' as const,basedOnTaskId:null,authorIdea:'张三在仙侠世界开坦克。',publishingPlatform:'fanqie' as const,ideaVersion:1,referencePack:{references:[],excludedReason:'没有额外参考'},openingPackage:null,review:null,taxonomy:null,validationRepair:null,memberInstruction:''};
  const novel=JSON.parse(buildOpeningAgentPrompt({...base,creativeProfile:normalizeCreativeProfile({workType:'novel'})}));
  expect(novel.stageBoundary.instruction).toContain('三席全案策划');
  expect(novel.finalInstructions.join('\n')).toContain('番茄可用口语');
  expect(creativeDirective(normalizeCreativeProfile({workType:'novel'}),'opening')?.stageInstruction).toContain('金手指');
  const shortStory=JSON.parse(buildOpeningAgentPrompt({...base,creativeProfile:normalizeCreativeProfile({workType:'short_story'})}));
  expect(shortStory.creativeDirection.preferences).toContain('有限篇幅');
  expect(shortStory.stageBoundary.instruction).toContain('有限篇幅');
  const memoir=JSON.parse(buildOpeningAgentPrompt({...base,creativeProfile:normalizeCreativeProfile({workType:'memoir'})}));
  expect(memoir.creativeDirection.preferences).toContain('真实经历');
  expect(memoir.creativeDirection.preferences).toContain('待补充');
  expect(memoir.creativeDirection.stageInstruction).not.toContain('主动设计适合本书的特殊优势');
  expect(memoir.finalInstructions.join('\n')).not.toContain('番茄可用口语');
  const script=JSON.parse(buildOpeningAgentPrompt({...base,creativeProfile:normalizeCreativeProfile({workType:'script'})}));
  expect(script.creativeDirection.preferences).toContain('场景');
  expect(script.stageBoundary.instruction).not.toContain('三席全案策划');
 });
 it('按账号和书籍取偏好，后续只传短规则，技术重试保留原方向',()=>{
  const db=new DatabaseSync(':memory:');
  try{
   db.exec('CREATE TABLE book_creative_profiles(owner_id TEXT,book_id TEXT,profile_json TEXT)');
   db.prepare('INSERT INTO book_creative_profiles VALUES(?,?,?)').run('owner-a','book-a',JSON.stringify(normalizeCreativeProfile({scale:5})));
   const prompt=JSON.stringify({operation:'setting_design',author:'张三'});
   expect(withBookCreativeProfile(db,'owner-b','book-a',prompt,'setting')).toBe(prompt);
   expect(withBookCreativeProfile(db,'owner-a','book-b',prompt,'setting')).toBe(prompt);
   const first=withBookCreativeProfile(db,'owner-a','book-a',prompt,'setting');
   expect(JSON.parse(first).creativeDirection.scale).toBe('极限整活');
   expect(first).not.toContain('G001');
   db.prepare('UPDATE book_creative_profiles SET profile_json=?').run(JSON.stringify(normalizeCreativeProfile({scale:1})));
   expect(withBookCreativeProfile(db,'owner-a','book-a',first,'setting')).toBe(first);
  }finally{db.close();}
 });
});
