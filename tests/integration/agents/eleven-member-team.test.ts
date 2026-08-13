import { afterEach, describe, expect, it } from 'vitest';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { creativeMemberContracts } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { ReviewModelCompatibilityService, ModelBindingV2Service } from '../../../apps/api/src/application/agents/model-binding-v2-service.js';

describe('十一人创作团队', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('新书创建十一名女性成员，小文秘书不冒充第十二名Agent', () => {
    context = createTestContext();
    const book = initializeDomainBook(context, 'owner-one', new SequenceIds(), new FixedClock());
    const members = context.database.prepare(`SELECT a.display_name, r.role_key, r.display_name AS title
      FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? ORDER BY a.created_at, a.agent_id`).all('owner-one', book.bookId);
    expect(members).toHaveLength(11);
    expect(members).toEqual(expect.arrayContaining(creativeMemberContracts.map((member) => expect.objectContaining({
      display_name: member.memberName, role_key: member.roleKey, title: member.shortTitle
    }))));
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_instances WHERE display_name = '小文秘书'`).get()).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_model_bindings WHERE owner_id = ? AND book_id = ?`).get('owner-one', book.bookId)).toEqual({ count: 11 });
  });

  it('模型绑定拒绝同模型双编剧、豆包编剧和不允许的写手', () => {
    const service = Object.create(ModelBindingV2Service.prototype) as ModelBindingV2Service;
    const base = Object.fromEntries(creativeMemberContracts.map((member) => [member.roleKey, { ...member.defaultModel }])) as Parameters<ModelBindingV2Service['validate']>[0];
    expect(base.deputy_editor).toEqual({
      provider: 'volcengine-ark-agent-plan',
      modelId: 'minimax-m3',
      plan: 'agent'
    });
    expect(() => service.validate({ ...base, second_screenwriter: base.lead_screenwriter })).toThrow('不同模型');
    expect(() => service.validate({ ...base, lead_screenwriter: base.experience_reviewer })).toThrow('豆包');
    expect(() => service.validate({ ...base, lead_writer: base.literary_reviewer })).toThrow('写手');
    expect(() => service.validate({ ...base, backup_writer: base.lead_writer })).toThrow('主笔与副笔必须使用不同模型');
  });

  it('点评席必须三者彼此异模型并与活动写手异模型', () => {
    const rows = creativeMemberContracts.map((member, index) => ({
      agentId: `agent-${index}`, roleKey: member.roleKey, roleTemplateId: member.roleTemplateId, memberName: member.memberName,
      shortTitle: member.shortTitle, provider: member.defaultModel.provider, modelId: member.defaultModel.modelId,
      modelSnapshotId: `model-${index}`, activationState: 'idle'
    }));
    const writer = rows.find((row) => row.roleKey === 'lead_writer')!;
    const panel = new ReviewModelCompatibilityService().select(writer, rows);
    expect([panel.fact.modelId, panel.literary.modelId, panel.experience.modelId, writer.modelId]).toHaveLength(4);
    expect(new Set([panel.fact.modelId, panel.literary.modelId, panel.experience.modelId, writer.modelId]).size).toBe(4);
    const backupWriter = rows.find((row) => row.roleKey === 'backup_writer')!;
    const backupPanel = new ReviewModelCompatibilityService().select(backupWriter, rows);
    expect(backupPanel.fact.roleKey).toBe('setting');
    expect(backupPanel.fact.modelId).toBe('glm-5.2');
  });
});
