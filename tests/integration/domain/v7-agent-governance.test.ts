import { afterEach, describe, expect, it } from 'vitest';
import { V7AgentGovernanceService } from '../../../apps/api/src/application/agents/v7-agent-governance-service.js';
import { resolveV7TaskPolicy } from '../../../apps/api/src/application/agents/v7-agent-runtime-policy.js';
import { V7AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { resolveSettingTaskRoster } from '../../../apps/api/src/application/books/v7-task-roster-snapshot.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7统一岗位、模型与任务参数', () => {
  it('已绑定席位可追踪，设定独立准入；新增成员不改写旧任务模型', () => {
    context = createTestContext();
    const repository = new V7AgentGovernanceRepository(context.database);
    const service = new V7AgentGovernanceService(repository, new SequenceIds(), new FixedClock(),
      {codingPlan:true,agentPlan:true,image:true});
    const connected=service.connectedMembers();
    expect(connected.length).toBe(23+repository.candidateSlots().filter(m=>m.modelProfileKey!==null).length);
    expect(new Set(connected.map(m=>m.memberKey)).size).toBe(connected.length);
    const roster=service.settingRoster();
    const design=roster.filter(m=>m.roleKey==='screenwriter'&&m.fallbackPriority<100).sort((a,b)=>a.fallbackPriority-b.fallbackPriority);
    expect(design.map(m=>m.model.modelId)).toEqual(['deepseek-v4-pro','deepseek-v4-flash','kimi-k2.7-code']);
    const reviewers=roster.filter(m=>m.roleKey==='chief_editor'&&m.fallbackPriority<100).sort((a,b)=>a.fallbackPriority-b.fallbackPriority);
    expect(reviewers.map(m=>m.model.modelId)).toEqual(['kimi-k3','doubao-seed-2.1-turbo','glm-5.3-flash']);
    const extra=reviewers.find(m=>m.model.modelId==='glm-5.3-flash')!;
    expect(repository.resolveTaskPolicy(extra.memberKey,'setting_review').temperature).toBe(.25);
    expect(()=>repository.resolveTaskPolicy(extra.memberKey,'setting_design')).toThrow();
    const frozen=roster.filter(m=>service.snapshot().members.some(old=>old.memberKey===m.memberKey));
    expect(resolveSettingTaskRoster(JSON.stringify(frozen),roster)).toHaveLength(frozen.length);
    expect(()=>resolveSettingTaskRoster(JSON.stringify(frozen),roster.map((m,i)=>i===0?{...m,model:{...m.model,modelId:'changed'}}:m))).toThrow();
    service.updateMember('admin',extra.memberKey,{expectedRevision:service.snapshot().revision,modelProfileKey:null});
    expect(service.settingRoster().some(m=>m.memberKey===extra.memberKey)).toBe(false);
    expect(()=>repository.resolveTaskPolicy(extra.memberKey,'setting_review')).toThrow();
  });
  it('默认成员可以真正停岗；更换模型保留身份和已有任务快照', () => {
    context = createTestContext();
    const service = new V7AgentGovernanceService(new V7AgentGovernanceRepository(context.database), new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    const before = service.snapshot().members.find((member) => member.memberKey === 'chief-deepseek-v4-pro')!;
    const frozen = service.taskSnapshot(before, 'opening_review');
    service.updateMember('admin', before.memberKey, { expectedRevision: service.snapshot().revision, enabled: false });
    expect(service.snapshot().members.find((member) => member.memberKey === before.memberKey)?.enabled).toBe(false);
    expect(service.snapshot().members.filter((member) => member.fixedRoleKey === 'chief_editor' && member.defaultForRole)).toHaveLength(1);
    service.updateMember('admin', before.memberKey, { expectedRevision: service.snapshot().revision, modelProfileKey: 'kimi-k3' });
    const after = service.snapshot().members.find((member) => member.memberKey === before.memberKey)!;
    expect(after.displayName).toBe(before.displayName);
    expect(after.fixedRoleKey).toBe(before.fixedRoleKey);
    expect(frozen.modelProfileKey).toBe('deepseek-v4-pro');
    expect(after.modelProfileKey).toBe('kimi-k3');
  });
  it('登记23名全局唯一成员，新增豆包方案成员，主笔保留六种模型', () => {
    context = createTestContext();
    const service = new V7AgentGovernanceService(new V7AgentGovernanceRepository(context.database), new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    const snapshot = service.snapshot();
    expect(snapshot.members).toHaveLength(23);
    expect(new Set(snapshot.members.map((member) => member.displayName)).size).toBe(23);
    expect(service.members('planning_writer').map((member) => member.modelProfileKey)).toEqual([
      'deepseek-v4-pro', 'glm-5.3', 'kimi-k3'
    ]);
    expect(service.members('lead_writer').map((member) => member.modelProfileKey)).toEqual([
      'deepseek-v4-pro', 'kimi-k3', 'deepseek-v4-flash', 'glm-5.3', 'kimi-k2.7-code', 'doubao-seed-2.1-turbo'
    ]);
    expect(service.members('lead_writer').find((member) => member.defaultForRole)?.modelProfileKey)
      .toBe('deepseek-v4-pro');
    const writer = service.members('lead_writer').find((member) => member.modelProfileKey === 'glm-5.3')!;
    expect(service.reviewersFor(writer).every((reviewer) => reviewer.modelProfileKey !== writer.modelProfileKey)).toBe(true);
  });

  it('候选可停岗保存，未验证的岗位组合及暂停模型不能直接上岗', () => {
    context = createTestContext();
    const service = new V7AgentGovernanceService(new V7AgentGovernanceRepository(context.database), new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    expect(() => service.updateMember('admin', 'planner-glm-5-3', {
      expectedRevision: service.snapshot().revision, modelProfileKey: 'doubao-seed-2.1-turbo'
    })).toThrow('尚未完成');
    service.updateMember('admin', 'planner-glm-5-3', {
      expectedRevision: service.snapshot().revision, enabled: false, modelProfileKey: 'doubao-seed-2.1-turbo'
    });
    expect(() => service.updateMember('admin', 'planner-glm-5-3', {
      expectedRevision: service.snapshot().revision, enabled: true
    })).toThrow('尚未完成');
    expect(() => service.updateMember('admin', 'chief-glm-5-3', {
      expectedRevision: service.snapshot().revision,
      modelProfileKey: 'doubao-seed-2.1-turbo'
    })).toThrow('尚未完成');
    expect(() => service.updateMember('admin', 'writer-glm-5-3', {
      expectedRevision: service.snapshot().revision, enabled: true
    })).toThrow('复测');
    expect(service.snapshot().members.some((member) => member.modelProfileKey === 'minimax-m3')).toBe(false);
  });

  it('已有数据库的退役成员停岗，候选模型不被启动种子改回旧模型', () => {
    context = createTestContext();
    const repository = new V7AgentGovernanceRepository(context.database);
    new V7AgentGovernanceService(repository, new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    context.database.prepare(`INSERT INTO v7_agent_governance_member_settings(
      member_key,fixed_role_key,model_profile_key,enabled,default_for_role,fallback_priority,
      temperature_adjustment,prompt_instruction,revision,updated_by,updated_at
    ) VALUES(?,?,?,?,?,?,0,'',1,'legacy','2026-08-27T00:00:00.000Z')`).run(
      'visual-minimax-m3', 'visual_planner', 'minimax-m3', 1, 1, 1
    );
    context.database.prepare(`INSERT INTO v7_agent_governance_member_settings(
      member_key,fixed_role_key,model_profile_key,enabled,default_for_role,fallback_priority,
      temperature_adjustment,prompt_instruction,revision,updated_by,updated_at
    ) VALUES(?,?,?,?,?,?,0,'',1,'legacy','2026-08-27T00:00:00.000Z')`).run(
      'planner-deepseek-v4-flash', 'planning_writer', 'deepseek-v4-flash', 1, 0, 4
    );
    context.database.prepare(`UPDATE v7_agent_governance_member_settings
      SET model_profile_key='deepseek-v4-flash' WHERE member_key='planner-glm-5-3'`).run();
    const service = new V7AgentGovernanceService(repository, new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    expect(service.snapshot().members).toHaveLength(23);
    expect(service.snapshot().members.find((member) => member.memberKey === 'planner-glm-5-3')?.modelProfileKey).toBe('deepseek-v4-flash');
    expect(service.members('planning_writer').some((member) => member.memberKey === 'planner-glm-5-3')).toBe(false);
    expect(context.database.prepare(`SELECT enabled,default_for_role FROM v7_agent_governance_member_settings
      WHERE member_key='visual-minimax-m3'`).get()).toEqual({ enabled: 0, default_for_role: 0 });
    expect(context.database.prepare(`SELECT enabled,default_for_role FROM v7_agent_governance_member_settings
      WHERE member_key='planner-deepseek-v4-flash'`).get()).toEqual({ enabled: 0, default_for_role: 0 });
  });

  it('通用任务参数不再把未知旧成员当作零微调成员执行', () => {
    context = createTestContext();
    const repository = new V7AgentGovernanceRepository(context.database);
    expect(repository.resolveTaskPolicy('chief-deepseek-v4-pro', 'setting_review')).toMatchObject({
      governanceRevision: 1,
      temperature: 0.25
    });
    expect(() => repository.resolveTaskPolicy('chief-retired-v1', 'setting_review'))
      .toThrow('已经退役或不存在');

    new V7AgentGovernanceService(repository, new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    context.database.prepare(`UPDATE v7_agent_governance_member_settings SET enabled=0
      WHERE member_key='chief-deepseek-v4-pro'`).run();
    expect(() => repository.resolveTaskPolicy('chief-deepseek-v4-pro', 'setting_review'))
      .toThrow('当前不可执行');
  });

  it('后台调整会递增版本，任务温度按岗位微调后冻结', () => {
    context = createTestContext();
    const service = new V7AgentGovernanceService(new V7AgentGovernanceRepository(context.database), new SequenceIds(), new FixedClock(),
      { codingPlan: true, agentPlan: true, image: true });
    const before = service.snapshot();
    service.updateMember('admin', 'writer-glm-5-3', { expectedRevision: before.revision, temperatureAdjustment: .05 });
    const afterMember = service.snapshot();
    service.updateTaskPolicy('admin', 'manuscript', { expectedRevision: afterMember.revision, defaultTemperature: .70 });
    const resolved = resolveV7TaskPolicy(context.database, 'writer-glm-5-3', 'manuscript');
    expect(resolved.governanceRevision).toBe(afterMember.revision + 1);
    expect(resolved.temperature).toBe(.75);
  });
});
