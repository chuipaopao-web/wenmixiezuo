import {afterEach,describe,expect,it} from 'vitest';
import {OPENING_EVALUATION_REPORT,openingRanking} from '@wenmi/agent-catalog';
import {V7AgentGovernanceService} from '../../../apps/api/src/application/agents/v7-agent-governance-service.js';
import {V7AgentGovernanceRepository} from '../../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import {FixedClock,SequenceIds,createTestContext,type TestContext} from '../../helpers/test-context.js';
let context:TestContext|undefined;
const originalRows=OPENING_EVALUATION_REPORT.rows;
afterEach(()=>{context?.close();context=undefined;Object.defineProperty(OPENING_EVALUATION_REPORT,'rows',{value:originalRows});});
const row=(profileKey:string,node:'design'|'review',milliseconds:number,structurePassed=true)=>({profileKey,node,milliseconds,structurePassed,quality:'passed' as const,assessment:'fixture',outputTokens:100});
describe('opening node ranking and bounded admission',()=>{
 it('keeps design and review independent, excludes invalid and retired results',()=>{
  const report={version:'test',testedAt:'2026-09-06',scope:'test',rows:[row('deepseek-v4-pro','design',50),row('kimi-k3','review',1),row('deepseek-v4-flash','design',2,false),row('glm-5.2','design',1),row('kimi-k2.7-code','design',30)]};
  expect(openingRanking('design',report).map(r=>r.profileKey)).toEqual(['kimi-k2.7-code','deepseek-v4-pro']);
  expect(openingRanking('review',report).map(r=>r.profileKey)).toEqual(['kimi-k3']);
 });
 it('selects three actual bindings; unbinding and swapping to an unverified model remove admission without changing global roles',()=>{
  Object.defineProperty(OPENING_EVALUATION_REPORT,'rows',{value:[row('deepseek-v4-pro','design',50),row('deepseek-v4-flash','design',20),row('kimi-k2.7-code','design',30),row('doubao-seed-2.1-turbo','design',60),row('kimi-k3','review',10),row('deepseek-v4-flash','review',5)]});
  context=createTestContext();const repository=new V7AgentGovernanceRepository(context.database);
  const service=new V7AgentGovernanceService(repository,new SequenceIds(),new FixedClock(),{codingPlan:true,agentPlan:true,image:true});
  const bindings=()=>service.snapshot().members.map(({memberKey,modelProfileKey,enabled})=>({memberKey,modelProfileKey,enabled}));
  const before=bindings();
  const designers=service.openingRoster().filter(m=>m.roleKey==='screenwriter');
  expect(designers.map(m=>m.model.modelId)).toEqual(['deepseek-v4-flash','kimi-k2.7-code','deepseek-v4-pro']);
  const slot=designers[0]!;
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
