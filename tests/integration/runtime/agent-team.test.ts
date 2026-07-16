import { afterEach, describe, expect, it } from 'vitest';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('9岗位团队与运行时能力', () => {
  it('创建5个核心和4个待命专家并如实显示共同模型', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner(scope);
    lifecycle.createDraft(scope, '甲书');
    const service = new AgentTeamService(context.database, ids, clock);
    const agents = service.createTeam(scope);
    expect(agents).toHaveLength(9);
    expect(agents.filter((agent) => agent.category === 'core' && agent.activationState === 'idle')).toHaveLength(5);
    expect(agents.filter((agent) => agent.category === 'specialist' && agent.activationState === 'standby')).toHaveLength(4);
    expect(new Set(agents.map((agent) => `${agent.provider}/${agent.modelId}`))).toEqual(new Set(['local-deterministic/wenmai-fixture-v1']));
    expect(() => service.assertIndependentReview(agents[0]!, agents[1]!)).toThrow('真实不同模型');
    const researcher = agents.find((agent) => agent.roleKey === 'researcher')!;
    expect(() => service.activate(scope, researcher.agentId, 'research')).toThrow('运行时能力不可用');
  });

  it('中途失败时9个Agent和配置快照整批回滚', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner(scope);
    lifecycle.createDraft(scope, '甲书');
    const service = new AgentTeamService(context.database, ids, clock);
    expect(() => service.createTeam(scope, 4)).toThrow('simulated-team-creation-failure');
    expect(service.list(scope)).toEqual([]);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM model_config_snapshots WHERE owner_id = ? AND book_id = ?').get(scope.ownerId, scope.bookId))
      .toEqual({ count: 0 });
  });
});

