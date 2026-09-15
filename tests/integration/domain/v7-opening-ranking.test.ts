import {afterEach,describe,expect,it} from 'vitest';
import {OPENING_EVALUATION_REPORT,openingRanking} from '@wenmi/agent-catalog';
import {creationRosterFromGlobal,planningRosterFromGlobal} from '@wenmi/v7-backend';
import {V7AgentGovernanceService} from '../../../apps/api/src/application/agents/v7-agent-governance-service.js';
import {V7AgentGovernanceRepository} from '../../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import {FixedClock,SequenceIds,createTestContext,type TestContext} from '../../helpers/test-context.js';
let context:TestContext|undefined;
const originalRows=OPENING_EVALUATION_REPORT.rows;
afterEach(()=>{context?.close();context=undefined;Object.defineProperty(OPENING_EVALUATION_REPORT,'rows',{value:originalRows});});
const row=(profileKey:string,node:'design'|'review',milliseconds:number,structurePassed=true)=>({profileKey,node,milliseconds,structurePassed,quality:'passed' as const,assessment:'fixture',outputTokens:100});
describe('opening node ranking and bounded admission',()=>{
 it('honors Pro defaults despite old priorities, preserves explicit choices and independent fallback',()=>{
  context=createTestContext();const repository=new V7AgentGovernanceRepository(context.database);
  const service=new V7AgentGovernanceService(repository,new SequenceIds(),new FixedClock(),{codingPlan:true,agentPlan:true,image:true});
  for(const member of service.snapshot().members.filter(m=>m.modelProfileKey==='deepseek-v4-pro')){
   service.updateMember('admin',member.memberKey,{expectedRevision:service.snapshot().revision,enabled:true,defaultForRole:true});
  }
  const members=service.snapshot().members;
  expect(members.filter(m=>m.modelProfileKey==='deepseek-v4-pro').every(m=>m.displayName.endsWith('·4p'))).toBe(true);
  expect(service.openingRoster().filter(m=>m.model.modelId==='deepseek-v4-pro').every(m=>m.displayName.endsWith('·4p'))).toBe(true);
  expect(creationRosterFromGlobal(members).filter(m=>m.defaultForRole).every(m=>m.model.modelId==='deepseek-v4-pro')).toBe(true);
  expect(planningRosterFromGlobal(members).filter(m=>m.defaultForRole).every(m=>m.model.modelId==='deepseek-v4-pro')).toBe(true);
  const reviewers=service.fallback('independent_reviewer',undefined,'deepseek-v4-pro');
  expect(reviewers.length).toBeGreaterThan(0);
  expect(reviewers.every(m=>m.modelProfileKey!=='deepseek-v4-pro')).toBe(true);
  const optional=reviewers[0]!;
  expect(service.fallback('independent_reviewer',optional.memberKey)[0]?.memberKey).toBe(optional.memberKey);
 });
 it('归队GLM可启用已验证开书设计，并作为编制成员进入设定编选',()=>{
  Object.defineProperty(OPENING_EVALUATION_REPORT,'rows',{value:[row('glm-5.3','design',10),row('deepseek-v4-pro','design',50)]});
  context=createTestContext();const repository=new V7AgentGovernanceRepository(context.database);
  const service=new V7AgentGovernanceService(repository,new SequenceIds(),new FixedClock(),{codingPlan:true,agentPlan:true,image:true});
  service.updateMember('admin','planner-glm-5-3',{expectedRevision:service.snapshot().revision,enabled:true});
  expect(service.openingRoster().filter(m=>m.roleKey==='screenwriter')[0]?.memberKey).toBe('planner-deepseek-v4-pro');
  expect(openingRanking('design')[0]?.profileKey).toBe('glm-5.3');
  expect(()=>repository.resolveTaskPolicy('planner-glm-5-3','opening_design')).not.toThrow();
  const admin = service.adminView() as { settingSelection: Array<{ modelId: string; roleKey: string }> };
  // 5079844a起GLM恢复正式编制，启用后同时进入设定编选，不再处于停岗隔离状态。
  expect(admin.settingSelection.some(m=>m.modelId==='glm-5.3'&&m.roleKey==='screenwriter')).toBe(true);
 });
 it('keeps design and review independent, excludes invalid and retired results',()=>{
  const report={version:'test',testedAt:'2026-09-06',scope:'test',rows:[row('deepseek-v4-pro','design',50),row('kimi-k3','review',1),row('deepseek-v4-flash','design',2,false),row('glm-5.2','design',1),row('kimi-k2.7-code','design',30)]};
  expect(openingRanking('design',report).map(r=>r.profileKey)).toEqual(['kimi-k2.7-code','deepseek-v4-pro']);
  expect(openingRanking('review',report).map(r=>r.profileKey)).toEqual(['kimi-k3']);
 });
 it('准入名次绑定加编制成员共同组成开书阵容；解绑与换未验证模型仍取消准入且不动全局岗位',()=>{
  Object.defineProperty(OPENING_EVALUATION_REPORT,'rows',{value:[row('deepseek-v4-pro','design',50),row('deepseek-v4-flash','design',20),row('kimi-k2.7-code','design',30),row('doubao-seed-2.1-turbo','design',60),row('kimi-k3','review',10),row('deepseek-v4-flash','review',5)]});
  context=createTestContext();const repository=new V7AgentGovernanceRepository(context.database);
  const service=new V7AgentGovernanceService(repository,new SequenceIds(),new FixedClock(),{codingPlan:true,agentPlan:true,image:true});
  const bindings=()=>service.snapshot().members.map(({memberKey,modelProfileKey,enabled})=>({memberKey,modelProfileKey,enabled}));
  const before=bindings();
  const designers=service.openingRoster().filter(m=>m.roleKey==='screenwriter');
  // 5079844a起开书阵容=已验证名次+全部在编规划成员（不再截断三席），任务级准入仍由resolveTaskPolicy按名次把关。
  expect(designers.map(m=>m.model.modelId)).toEqual(['deepseek-v4-pro','deepseek-v4-flash','kimi-k2.7-code','doubao-seed-2.1-turbo','glm-5.3','kimi-k3']);
  const slot=designers[1]!;
  expect(repository.resolveTaskPolicy(slot.memberKey,'opening_design').temperature).toBeGreaterThan(0);
  expect(()=>repository.resolveTaskPolicy(slot.memberKey,'manuscript')).toThrow();
  service.updateMember('admin',slot.memberKey,{expectedRevision:service.snapshot().revision,modelProfileKey:'glm-5.3'});
  expect(service.openingRoster().some(m=>m.memberKey===slot.memberKey)).toBe(false);
  expect(()=>repository.resolveTaskPolicy(slot.memberKey,'opening_design')).toThrow();
  service.updateMember('admin',slot.memberKey,{expectedRevision:service.snapshot().revision,modelProfileKey:null});
  expect(service.openingRoster().some(m=>m.memberKey===slot.memberKey)).toBe(false);
  expect(bindings()).toEqual(before);
  expect(service.snapshot().members.every(m=>m.memberKey!==slot.memberKey)).toBe(true);
 });
});
