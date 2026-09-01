import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  V7_PLANNING_TREE_SCHEMA,
  type PlanningTreeDocument,
  type PlanningTreeKind,
  type PlanningTreeNode
} from '@wenmi/v7-backend';
import { V7PlanningTreeService } from '../../../apps/api/src/application/planning/v7-planning-tree-service.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7三棵竖向综合规划树后端', () => {
  it('保存全书、卷、链三棵树，并支持修改、确认、隔离和实际结算投影', async () => {
    context = createTestContext('wenmi-v7-planning-trees-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'planning-owner@example.com', '规划作者', 'strong-pass-123');
      const other = await register(app, 'planning-other@example.com', '另一作者', 'strong-pass-456');
      const bookId = await createBook(app, cookie, '三国长篇规划', 'planning-book-create-0001');
      const sourceRefs = [
        { sourceKind: 'opening', sourceId: bookId, version: '1' },
        { sourceKind: 'setting', sourceId: `${bookId}:confirmed`, version: '1' }
      ];

      const bookTree = tree('book', bookId, [
        node('volume-1', 'volume', 1, '第一卷：乱世立足', { treeKind: 'volume', scopeId: 'volume-1' }),
        node('ending', 'ending', 2, '结局：建立新秩序')
      ]);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidates`, {
        expectedRevision: 0, tree: bookTree, sourceRefs, idempotencyKey: 'book-tree-create-0001'
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().data).toMatchObject({ treeKind: 'book', scopeId: bookId, revision: 1, status: 'candidate' });
      expect(created.json().data.root.children[0]).toMatchObject({
        title: '第一卷：乱世立足', actual: null,
        emotion: { publicSummary: '先压住主角，再给出一次明确释放。' },
        experience: { publicSummary: '读者能看懂目标，并持续等到阶段回报。' }
      });
      expect(JSON.stringify(created.json().data)).not.toMatch(/sourceRefs|contentHash|createdBy|model|method/iu);

      const revisePayload = {
        expectedRevision: 1,
        operations: [{ kind: 'update_node', nodeKey: 'volume-1', changes: { title: '第一卷：从流民到伍长' } }],
        sourceRefs,
        idempotencyKey: 'book-tree-revise-0001'
      };
      const revised = await request(app, cookie, 'PATCH', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidate`, revisePayload);
      expect(revised.statusCode).toBe(200);
      expect(revised.json().data.revision).toBe(2);
      expect(revised.json().data.root.children[0].title).toBe('第一卷：从流民到伍长');
      const repeated = await request(app, cookie, 'PATCH', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidate`, revisePayload);
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.revision).toBe(2);

      const stale = await request(app, cookie, 'PATCH', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidate`, {
        ...revisePayload, idempotencyKey: 'book-tree-revise-stale-0001'
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('PLANNING_TREE_VERSION_CONFLICT');

      const confirmed = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/confirm`, {
        expectedRevision: 2, idempotencyKey: 'book-tree-confirm-0001'
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data).toMatchObject({ revision: 3, status: 'confirmed' });
      const history = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/history`);
      expect(history.statusCode).toBe(200);
      expect(history.json().data.map((item: { revision: number; status: string }) => [item.revision, item.status])).toEqual([
        [2, 'confirmed'], [1, 'superseded']
      ]);

      const volumeTree = tree('volume', 'volume-1', [
        node('chain-1', 'chain', 1, '单元链一：战场求生', { treeKind: 'chain', scopeId: 'chain-1' })
      ]);
      const chainTree = tree('chain', 'chain-1', [
        node('event-1', 'event', 1, '事件一：被迫进入先锋营')
      ]);
      for (const [kind, scopeId, document, key] of [
        ['volume', 'volume-1', volumeTree, 'volume-tree-create-0001'],
        ['chain', 'chain-1', chainTree, 'chain-tree-create-0001']
      ] as const) {
        const response = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/${kind}/${scopeId}/candidates`, {
          expectedRevision: 0, tree: document, sourceRefs, idempotencyKey: key
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data.treeKind).toBe(kind);
      }

      const confirmedChain = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1/confirm`, {
          expectedRevision: 1, idempotencyKey: 'chain-tree-confirm-0001'
        });
      expect(confirmedChain.statusCode).toBe(200);
      expect(confirmedChain.json().data).toMatchObject({ status: 'confirmed', revision: 2 });

      const candidateChainV2 = tree('chain', 'chain-1', [
        node('event-2', 'event', 1, '候选事件二：不应覆盖正文实际')
      ]);
      const createdChainV2 = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1/candidates`, {
          expectedRevision: 2, tree: candidateChainV2, sourceRefs, idempotencyKey: 'chain-tree-create-0002'
        });
      expect(createdChainV2.statusCode).toBe(200);
      expect(createdChainV2.json().data).toMatchObject({ status: 'candidate', revision: 3 });

      const defaultChainRead = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1`);
      expect(defaultChainRead.statusCode).toBe(200);
      expect(defaultChainRead.json().data).toMatchObject({
        status: 'candidate', root: { children: [expect.objectContaining({ title: '候选事件二：不应覆盖正文实际' })] }
      });
      const confirmedChainRead = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1?version=confirmed`);
      expect(confirmedChainRead.statusCode).toBe(200);
      expect(confirmedChainRead.json().data).toMatchObject({
        status: 'confirmed', root: { children: [expect.objectContaining({ title: '事件一：被迫进入先锋营' })] }
      });
      expect(JSON.stringify(confirmedChainRead.json().data)).not.toContain('候选事件二');
      const invalidVersion = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1?version=unknown`);
      expect(invalidVersion.statusCode).toBe(400);
      const crossOwnerConfirmed = await request(app, other, 'GET',
        `/api/v1/v7/books/${bookId}/planning-trees/chain/chain-1?version=confirmed`);
      expect(crossOwnerConfirmed.statusCode).toBe(404);
      expect(crossOwnerConfirmed.body).not.toMatch(/事件一|候选事件二/u);
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const actuals = new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock());
      const actual = actuals.recordActual(ownerId, bookId, 'book', bookId, {
        idempotencyKey: 'book-tree-actual-0001',
        actual: {
          nodeKey: 'volume-1', state: 'partial', summary: '第一阶段已经完成从流民到新兵。',
          emotionResult: '求生压力已经建立。', experienceResult: '第一次小胜形成明确回报。',
          outcome: '张三进入军营，尚未成为伍长。', sourceKind: 'volume_settlement',
          sourceVersionId: 'settlement-volume-0001', evidenceRefs: ['chapter-version-1', 'chapter-version-2'],
          recordedAt: '2026-07-16T00:00:00.000Z'
        }
      });
      expect(actual.state).toBe('partial');
      const projected = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}`);
      expect(projected.json().data.root.children[0].actual).toMatchObject({ state: 'partial', outcome: '张三进入军营，尚未成为伍长。' });
      expect(JSON.stringify(projected.json().data)).not.toMatch(/sourceVersionId|evidenceRefs/iu);
      expect(projected.json().data.root.children[0].story.outcome).toBe('本层结束时产生清楚、可继续衔接的结果。');

      const crossOwner = await request(app, other, 'GET', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}`);
      expect(crossOwner.statusCode).toBe(404);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_planning_tree_versions WHERE book_id=?').get(bookId)).toEqual({ count: 5 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_planning_node_actuals WHERE book_id=?').get(bookId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('拒绝层级错放、操作号复用和无正文证据的实际更新', async () => {
    context = createTestContext('wenmi-v7-planning-tree-guards-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'planning-guard@example.com', '边界作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '规划边界测试', 'planning-guard-book-0001');
      const refs = [{ sourceKind: 'opening', sourceId: bookId, version: '1' }];
      const wrong = tree('book', bookId, [node('event-1', 'event', 1, '错放事件')]);
      const rejected = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidates`, {
        expectedRevision: 0, tree: wrong, sourceRefs: refs, idempotencyKey: 'guard-tree-create-0001'
      });
      expect(rejected.statusCode).toBe(400);

      const valid = tree('book', bookId, [node('volume-1', 'volume', 1, '第一卷', { treeKind: 'volume', scopeId: 'volume-1' })]);
      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidates`, {
        expectedRevision: 0, tree: valid, sourceRefs: refs, idempotencyKey: 'guard-tree-create-0002'
      });
      expect(created.statusCode).toBe(200);
      const reused = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/planning-trees/book/${bookId}/candidates`, {
        expectedRevision: 1, tree: valid, sourceRefs: refs, idempotencyKey: 'guard-tree-create-0002'
      });
      expect(reused.statusCode).toBe(409);

      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const service = new V7PlanningTreeService(context.database, new SequenceIds(), new FixedClock());
      expect(() => service.recordActual(ownerId, bookId, 'book', bookId, {
        idempotencyKey: 'guard-actual-0001', actual: {
          nodeKey: 'volume-1', state: 'partial', summary: '尚未正式结算', emotionResult: '未知', experienceResult: '未知',
          outcome: '未知', sourceKind: 'volume_settlement', sourceVersionId: 'fake-settlement', evidenceRefs: [],
          recordedAt: '2026-07-16T00:00:00.000Z'
        }
      })).toThrow('正文结算必须带有可核查的正文证据');
    } finally {
      await app.close();
    }
  });
});

function tree(kind: PlanningTreeKind, scopeId: string, children: PlanningTreeNode[]): PlanningTreeDocument {
  return {
    schema: V7_PLANNING_TREE_SCHEMA, treeKind: kind, scopeId, title: `${kind}竖向综合树`,
    root: node(`${kind}-root`, kind, 1, `${kind}总方向`, null, children)
  };
}

function node(
  key: string,
  kind: PlanningTreeNode['kind'],
  sequence: number,
  title: string,
  linkedTree: PlanningTreeNode['linkedTree'] = null,
  children: PlanningTreeNode[] = []
): PlanningTreeNode {
  return {
    key, kind, sequence, title,
    story: {
      summary: '这一层有明确目标、冲突和结果。', majorEvents: ['发生一次改变局面的关键事件。'],
      protagonistChange: '主角的能力、处境或认知产生可见变化。',
      outcome: '本层结束时产生清楚、可继续衔接的结果。', nextStep: '结果自然推动下一层。'
    },
    emotion: {
      publicSummary: '先压住主角，再给出一次明确释放。', openingEmotion: '期待中带着压力。',
      pressureMovement: '压力逐步提高但保留喘息。', releaseEmotion: '以可感知的胜利兑现期待。', intensity: 'moderate'
    },
    experience: {
      publicSummary: '读者能看懂目标，并持续等到阶段回报。', pressureRhythm: '压力逐级增加。',
      payoffCadence: '在合理篇幅内持续兑现。', informationRhythm: '先给问题，再逐步揭晓。',
      contrastWithPrevious: '比上一层更紧、更有回报。', designReason: '避免拖沓并保持清楚的因果推进。'
    },
    causality: {
      trigger: '上一层结果触发本层任务。', causes: ['主角必须主动应对。'], coreConflict: '目标与阻力正面冲突。',
      turningPoint: '关键选择改变局面。', consequences: ['产生下一层必须处理的新结果。']
    },
    threads: { foreshadowing: [], openQuestions: [] },
    budget: { wordTarget: 100_000, chapterRange: [1, 40] }, linkedTree, children
  };
}

async function register(app: FastifyInstance, email: string, displayName: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email, password, displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(app: FastifyInstance, cookie: string, title: string, key: string): Promise<string> {
  const openingPackage = {
    title,
    positioning: {
      publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史', '权谋'],
      coreAppeal: '小人物改变乱世。', targetReaders: '喜欢历史穿越和长期成长的男频读者',
      expectedTotalWords: 3_000_000, volumePlan: { minimum: 6, recommended: 8, maximum: 10 },
      retentionPositioning: '开篇快速建立生存压力，逐卷兑现身份、关系和天下格局变化。'
    },
    backgrounds: { eraAndWorld: '东汉末年', openingSituation: '张三是流民。' },
    protagonists: [{ name: '张三', age: '23岁', identity: '男主', background: '普通人', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '在乱世立足', dilemma: '没有身份和资源', personality: ['谨慎'], boundary: '不能无代价解决问题' }],
    opening: { startingSituation: '被迫从军', incitingIncident: '卷入大战', immediateConflict: '先活下来', readerPromise: '靠选择改变命运' },
    longTermDirection: { centralConflict: '个人与乱世秩序冲突', progression: '从流民到能影响局势', relationshipDirection: '建立可信伙伴', storyPotential: '冲突逐卷升级' },
    possibleEnding: { direction: '建立新秩序', price: '承担真实损失', openness: '允许按实际结果调整' },
    authorNotes: [], mustFollow: ['不得引入系统或超凡力量']
  };
  const response = await request(app, cookie, 'POST', '/api/v1/v7/opening-books', { openingPackage, idempotencyKey: key });
  expect(response.statusCode).toBe(200);
  return response.json().data.bookId as string;
}

async function request(app: FastifyInstance, cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const headers = { ...HEADERS, cookie };
  if (payload === undefined) return await app.inject({ method, url, headers });
  return await app.inject({ method, url, headers, payload: payload as object });
}
