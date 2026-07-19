import { afterEach, describe, expect, it } from 'vitest';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { creativeRoleKeys } from '../../../apps/api/src/contracts/agent-team-v2.js';
import { PromptCompiler } from '../../../apps/api/src/application/agents/prompt-compiler.js';
import { PromptTemplateRepository } from '../../../apps/api/src/infrastructure/db/repositories/prompt-template-repository.js';
import { AgentContinuityService } from '../../../apps/api/src/application/agents/agent-continuity-service.js';
import { AgentContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/agent-continuity-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { WriterLeaseService } from '../../../apps/api/src/application/agents/writer-lease-service.js';
import { WriterLeaseRepository } from '../../../apps/api/src/infrastructure/db/repositories/writer-lease-repository.js';

describe('岗位提示、连续日志和写手租约', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('十一岗位编译不同的最小提示快照且不注入整篇文档', () => {
    context = createTestContext(); const ids = new SequenceIds(); const compiler = new PromptCompiler(new PromptTemplateRepository(context.database), ids, new FixedClock());
    const compiled = creativeRoleKeys.map((roleKey) => compiler.compile(roleKey, { objective: '处理本岗位任务', mode: 'formal_production', contextManifest: ['工单', '相关正史'], outputSchema: { type: 'object' } }));
    expect(new Set(compiled.map((item) => item.hash)).size).toBe(11);
    expect(compiled.every((item) => item.system.includes('不展示或保存内部思维链'))).toBe(true);
    expect(compiled.every((item) => !item.system.includes('CONSENSUS_LEDGER'))).toBe(true);
  });

  it('连续日志保存步骤依据结论但拒绝内部思维链字段', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const agent = context.database.prepare(`SELECT agent_id FROM agent_instances WHERE owner_id = ? AND book_id = ? LIMIT 1`).get('owner-one', book.bookId) as { agent_id: string };
    const repository = new AgentContinuityRepository(context.database); const service = new AgentContinuityService(repository, new UnitOfWork(context.database), ids, clock);
    service.append(scope, { agentId: agent.agent_id, entryType: 'evidence', content: { conclusion: '城门已关闭' }, sourceIds: ['chapter-9'], canonRevision: 9 });
    expect(repository.listJournal(scope, agent.agent_id)[0]).toMatchObject({ type: 'evidence', sourceIds: ['chapter-9'] });
    expect(() => service.append(scope, { agentId: agent.agent_id, entryType: 'step', content: { chainOfThought: '不可保存' }, sourceIds: [], canonRevision: 9 })).toThrow('思维链');
  });

  it('副笔接管后旧写手和旧epoch不能迟到提交', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const agents = context.database.prepare(`SELECT a.agent_id, r.role_key FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('lead_writer', 'backup_writer')`).all('owner-one', book.bookId) as unknown as Array<{ agent_id: string; role_key: string }>;
    const lead = agents.find((agent) => agent.role_key === 'lead_writer')!; const backup = agents.find((agent) => agent.role_key === 'backup_writer')!;
    const service = new WriterLeaseService(new WriterLeaseRepository(context.database), clock);
    expect(service.initialize(scope, lead.agent_id, 'order-1').epoch).toBe(1);
    expect(service.takeover(scope, 1, backup.agent_id, 'order-1', { lastSubmittedVersion: 'draft-1' }).epoch).toBe(2);
    expect(() => service.assertCanCommit(scope, lead.agent_id, 1)).toThrow('不能提交');
    expect(() => service.takeover(scope, 1, lead.agent_id, 'order-1', {})).toThrow('版本冲突');
  });
});
