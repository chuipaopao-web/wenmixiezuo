import { afterEach, describe, expect, it } from 'vitest';
import type { V7CreationMemberDefinition, V7SettingMemberDefinition } from '@wenmi/v7-backend';
import {
  openingChiefTaskSnapshot,
  resolveSettingTaskRoster
} from '../../apps/api/src/application/books/v7-task-roster-snapshot.js';
import { V7CreationRuntimeRepository } from '../../apps/api/src/infrastructure/db/repositories/v7-creation-runtime-repository.js';
import {
  V7CreationModelGateway,
  type V7CreationModelAdapterResolver
} from '../../apps/api/src/infrastructure/models/v7-creation-model-gateway.js';
import type { ModelAdapter } from '../../apps/api/src/infrastructure/models/model-adapter.js';
import { FixedClock, createTestContext, type TestContext } from '../helpers/test-context.js';

const NOW = '2026-07-16T00:00:00.000Z';
let context: TestContext | undefined;

afterEach(() => {
  context?.close();
  context = undefined;
});

describe('V7历史任务冻结名册恢复', () => {
  it('设定任务优先使用创建时自包含快照，当前名册只在快照损坏时兜底', () => {
    const current = [
      settingMember('chief-current', '现任主编', 'chief_editor', 'glm-5.3'),
      settingMember('deputy-current', '现任副编', 'deputy_editor', 'glm-5.3'),
      settingMember('writer-current', '现任编剧', 'screenwriter', 'glm-5.3')
    ];
    const frozen = [
      settingMember('chief-frozen', '原主编', 'chief_editor', 'deepseek-v4-pro'),
      settingMember('deputy-frozen', '原副编', 'deputy_editor', 'deepseek-v4-flash'),
      settingMember('writer-frozen', '原编剧', 'screenwriter', 'kimi-k2.7-code')
    ];

    expect(resolveSettingTaskRoster(JSON.stringify(frozen), current).map((member) => member.memberKey))
      .toEqual(['chief-frozen', 'deputy-frozen', 'writer-frozen']);
    expect(resolveSettingTaskRoster('{broken', current).map((member) => member.memberKey))
      .toEqual(['chief-current', 'deputy-current', 'writer-current']);
  });

  it('设定清单的历史主编不需要仍存在于当前静态名册', () => {
    const frozen = openingChiefTaskSnapshot(JSON.stringify([{
      memberKey: 'chief-retired-v1',
      displayName: '原主编',
      roleKey: 'chief_editor',
      enabledByDefault: true,
      defaultForRole: true,
      fallbackPriority: 1,
      model: { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding' },
      promptInstruction: '只属于该历史任务的补充要求'
    }]));

    expect(frozen[0]).toMatchObject({
      memberKey: 'chief-retired-v1',
      displayName: '原主编',
      promptInstruction: '只属于该历史任务的补充要求'
    });
  });

  it.each(['working', 'unknown'] as const)(
    '创作节点已有%s调用时，跨成员升级不会产生第二次模型下单',
    async (state) => {
      context = createTestContext(`wenmi-v7-historical-${state}-`);
      seedBook(context, `book-${state}`);
      const repository = new V7CreationRuntimeRepository(context.database);
      repository.createWorkflow({
        workflowId: `workflow-${state}`,
        ownerId: 'owner-history',
        bookId: `book-${state}`,
        volumeScopeId: 'volume-1',
        firstVolume: true,
        authorGoal: null,
        idempotencyKey: `workflow-key-${state}`,
        requestHash: 'a'.repeat(64),
        now: NOW
      });
      repository.beginModelCall({
        requestId: `old-member-request-${state}`,
        ownerId: 'owner-history',
        bookId: `book-${state}`,
        workflowId: `workflow-${state}`,
        runKind: 'option',
        nodeKey: 'volume:volume-1:option_1',
        memberKey: 'planner-old',
        provider: 'volcengine-ark-coding-plan',
        modelId: 'deepseek-v4-pro',
        plan: 'coding',
        purpose: 'structured_planning',
        promptHash: 'b'.repeat(64),
        reservedTokens: 8_000,
        governanceRevision: 1,
        temperature: 0.4,
        now: NOW
      });
      if (state === 'unknown') {
        repository.failModelCall(
          `old-member-request-${state}`,
          'unknown',
          '连接中断，结果无法确认',
          NOW
        );
      }
      const resolver = new RejectIfCalledResolver();
      const gateway = new V7CreationModelGateway(context.database, resolver, new FixedClock());

      await expect(gateway.generate({
        requestId: `new-member-request-${state}`,
        ownerId: 'owner-history',
        bookId: `book-${state}`,
        workflowId: `workflow-${state}`,
        runKind: 'option',
        nodeKey: 'volume:volume-1:option_1',
        workstationKey: 'volume',
        member: creationMember('planner-new'),
        purpose: 'structured_planning',
        operationMode: 'fresh',
        basedOnTaskId: null,
        authorInstructionVersion: null,
        sourceTraces: [],
        prompt: '生成第一套卷方案。',
        maxOutputTokens: 2_000,
        temperature: 0.5
      })).rejects.toMatchObject({ outcomeUnknown: true });
      expect(resolver.calls).toBe(0);
      expect(repository.modelCallsForWorkflow('owner-history', `book-${state}`, `workflow-${state}`))
        .toHaveLength(1);
    }
  );
});

class RejectIfCalledResolver implements V7CreationModelAdapterResolver {
  public calls = 0;
  public resolve(): ModelAdapter {
    this.calls += 1;
    throw new Error('不应创建第二次模型调用');
  }
}

function seedBook(value: TestContext, bookId: string): void {
  value.database.prepare(`INSERT OR IGNORE INTO owners(owner_id,display_name,version,created_at,updated_at)
    VALUES('owner-history','历史任务作者',1,?,?)`).run(NOW, NOW);
  value.database.prepare(`INSERT INTO books(book_id,owner_id,title,status,version,positioning_version,canon_revision,
    active_editor_agent_id,editor_epoch,created_at,updated_at)
    VALUES(?,'owner-history','历史任务恢复测试','draft',1,0,0,NULL,0,?,?)`).run(bookId, NOW, NOW);
}

function settingMember(
  memberKey: string,
  displayName: string,
  roleKey: V7SettingMemberDefinition['roleKey'],
  modelId: string
): V7SettingMemberDefinition {
  return {
    memberKey,
    displayName,
    roleKey,
    publicResponsibility: '历史任务快照',
    enabledByDefault: true,
    fallbackPriority: 1,
    model: { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' }
  };
}

function creationMember(memberKey: string): V7CreationMemberDefinition {
  return {
    memberKey,
    displayName: '新名册编剧',
    roleKey: 'planning_writer',
    enabledByDefault: true,
    defaultForRole: true,
    fallbackPriority: 1,
    model: { provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.3', plan: 'coding' },
    promptInstruction: ''
  };
}
