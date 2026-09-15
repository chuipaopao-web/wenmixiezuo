import {describe,it,expect} from 'vitest';
import {loadModelRuntimeConfig} from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import {ModelAdapterFactory} from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import {modelBindingForProfile,modelProfileKeyForBinding} from '../../coauthoring-v7/backend/agent-governance/agent-governance-registry.js';

describe('all models use Agent Plan',()=>{
 it('activates with Agent credentials alone and routes every public text model to agent',()=>{
  const config=loadModelRuntimeConfig({WENMI_ARK_AGENT_PLAN_API_KEY:'test-only-agent'});
  expect(config.activeMode).toBe('subscription-plan');expect(config.missingCredentials).toEqual([]);
  for(const profile of [...Object.values(config.roleProfiles),...config.publicProfiles]){
   expect(profile.plan).toBe('agent');expect(profile.provider).toBe('volcengine-ark-agent-plan');
   expect(new ModelAdapterFactory(config).resolve(profile.provider,profile.modelId,'structured_planning').provider).toBe(profile.provider);
  }
 });
 it('never uses a legacy coding credential or silently converts a frozen coding task',()=>{
  const config=loadModelRuntimeConfig({WENMI_ARK_CODING_PLAN_API_KEY:'test-only-old'});
  expect(config.endpoints.coding.apiKey).toBeUndefined();expect(config.activeMode).toBe('subscription-plan');
  expect(()=>new ModelAdapterFactory(config).resolve('volcengine-ark-coding-plan','deepseek-v4-pro','structured_planning')).toThrow('Coding Plan已停用');
  expect(()=>new ModelAdapterFactory(config).resolve('volcengine-ark-agent-plan','deepseek-v4-pro','structured_planning')).toThrow('凭证未配置');
 });
 it('missing explicit subscription credentials fails closed without becoming a fixture',()=>{
  const config=loadModelRuntimeConfig({WENMI_MODEL_MODE:'subscription-plan'});
  expect(config.activeMode).toBe('subscription-plan');expect(config.missingCredentials).toEqual(['agent-plan']);
 });
 it('keeps model identity across current bindings and read-only legacy decoding',()=>{
  for(const modelId of ['deepseek-v4-pro','deepseek-v4-flash','glm-5.3','glm-5.3-flash','kimi-k2.7-code','kimi-k3','doubao-seed-2.1-turbo']){
   expect(modelBindingForProfile(modelId)).toEqual({provider:'volcengine-ark-agent-plan',modelId,plan:'agent'});
   expect(modelProfileKeyForBinding({provider:'volcengine-ark-coding-plan',modelId,plan:'coding'})).toBe(modelId);
  }
 });
});
