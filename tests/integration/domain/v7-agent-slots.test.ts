import { afterEach, describe, expect, it } from 'vitest';
import { MEMBER_SLOTS, ROLES, TEXT_MODELS, candidateModels } from '@wenmi/agent-catalog';
import { V7_ROLE_PROMPT_ASSETS, sha256, stableStringify } from '@wenmi/v7-backend';
import { V7PromptGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-prompt-governance-repository.js';
import { V7AgentGovernanceService } from '../../../apps/api/src/application/agents/v7-agent-governance-service.js';
import { V7AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });
const create = () => {
  context = createTestContext();
  const repository = new V7AgentGovernanceRepository(context.database);
  const service = new V7AgentGovernanceService(repository,new SequenceIds(),new FixedClock(),{codingPlan:true,agentPlan:true,image:true});
  return { repository,service };
};

describe('fixed member slots and replaceable model bindings', () => {
  it('upgrades existing role prompt history with new versions instead of overwriting immutable seeds', () => {
    create();
    const prompts=new V7PromptGovernanceRepository(context!.database);
    for(const source of V7_ROLE_PROMPT_ASSETS) {
      expect(source.version).toBe(2);
      const old=stableStringify({...source.content,responsibility:'上一版岗位职责'});
      context!.database.prepare(`INSERT INTO v7_prompt_asset_versions
        (asset_id,asset_key,kind,version,status,governance_revision,title,summary,content_json,content_hash,created_by,created_at,published_by,published_at)
        VALUES(?,?,'role_prompt',1,'published',1,?,?,?,?,'legacy','2026-09-01T00:00:00Z','legacy','2026-09-01T00:00:00Z')`)
        .run(`${source.assetKey}@1`,source.assetKey,source.title,source.summary,old,sha256(old));
    }
    prompts.ensureSourceRegistrySeeded('2026-09-06T01:00:00Z');
    prompts.ensureSourceRegistrySeeded('2026-09-06T02:00:00Z');
    for(const source of V7_ROLE_PROMPT_ASSETS) {
      expect(prompts.publishedAsset(source.assetKey)?.assetId).toBe(source.assetId);
      expect(prompts.assetById(`${source.assetKey}@1`)?.content.responsibility).toBe('上一版岗位职责');
    }
  });
  it('has 54 text and 2 image identities, seven actual text profiles and distinct portraits', () => {
    expect(MEMBER_SLOTS).toHaveLength(56);
    expect(TEXT_MODELS).toHaveLength(7);
    expect(new Set(MEMBER_SLOTS.map(slot=>slot.memberKey)).size).toBe(56);
    expect(new Set(MEMBER_SLOTS.map(slot=>slot.displayName)).size).toBe(56);
    expect(new Set(MEMBER_SLOTS.map(slot=>`${slot.avatarPath}:${slot.avatarPosition}`)).size).toBe(56);
    for(const role of ROLES) {
      const slots=MEMBER_SLOTS.filter(slot=>slot.roleKey===role.roleKey);
      expect(slots).toHaveLength(role.kind==='image'?2:9);
      expect(slots.every(slot=>slot.initialModelProfileKey===null || candidateModels(role.roleKey).some(model=>model.profileKey===slot.initialModelProfileKey))).toBe(true);
      if(role.kind==='text') expect(new Set(slots.flatMap(slot=>slot.initialModelProfileKey ? [slot.initialModelProfileKey]:[])).size).toBe(7);
    }
    expect(MEMBER_SLOTS.filter(slot=>slot.initialModelProfileKey===null)).toHaveLength(13);
  });
  it('binds and unbinds with audit, preserves choices across startup and leaves runtime snapshots intact', () => {
    const {repository,service}=create();
    const key='member-planning_writer-9';
    const frozen=service.taskSnapshot(service.members('planning_writer')[0]!, 'opening_design');
    const before=service.snapshot().revision;
    service.updateMember('admin',key,{expectedRevision:before,modelProfileKey:'glm-5.2'});
    expect(repository.candidateSlots().find(slot=>slot.memberKey===key)?.modelProfileKey).toBe('glm-5.2');
    expect(()=>service.updateMember('admin',key,{expectedRevision:before,modelProfileKey:'kimi-k3'})).toThrow('刚刚');
    service.updateMember('admin',key,{expectedRevision:service.snapshot().revision,modelProfileKey:null});
    repository.ensureSeeded(new Date().toISOString());
    expect(repository.candidateSlots().find(slot=>slot.memberKey===key)?.modelProfileKey).toBeNull();
    expect(context!.database.prepare('SELECT count(*) AS n FROM v7_agent_slot_events').get()).toMatchObject({n:2});
    expect(service.snapshot().members).toHaveLength(23);
    expect(service.members().some(member=>member.memberKey===key)).toBe(false);
    expect(frozen.modelProfileKey).toBe('deepseek-v4-pro');
  });
  it('rejects wrong model type, invented profiles and premature activation without changing revisions', () => {
    const {repository,service}=create();
    const revision=service.snapshot().revision;
    for(const [key,patch] of [
      ['member-visual_renderer-2',{modelProfileKey:'kimi-k3'}],
      ['member-planning_writer-9',{modelProfileKey:'doubao-seedream'}],
      ['member-planning_writer-9',{modelProfileKey:'invented-model'}],
      ['member-planning_writer-9',{enabled:true}],
      ['member-planning_writer-9',{defaultForRole:true}]
    ] as const) expect(()=>service.updateMember('admin',key,{expectedRevision:revision,...patch})).toThrow();
    expect(service.snapshot().revision).toBe(revision);
    expect(repository.candidateSlots()).toHaveLength(33);
    const view=service.adminView() as {summary:{memberCount:number;candidateCount:number;unboundCount:number};roles:Array<{members:Array<{configurationOnly?:boolean;enabled:boolean}>}>};
    expect(view.summary).toMatchObject({memberCount:56,candidateCount:20,unboundCount:13});
    expect(view.roles.flatMap(role=>role.members).filter(member=>member.configurationOnly).every(member=>!member.enabled)).toBe(true);
  });
});
