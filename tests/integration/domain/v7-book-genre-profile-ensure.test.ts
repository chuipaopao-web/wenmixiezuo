import { afterEach, describe, expect, it } from 'vitest';
import { V7BookGenreProfileEnsureService } from '../../../apps/api/src/application/agents/v7-book-genre-profile-ensure-service.js';
import {
  ModelAdapterError,
  type ModelAdapter,
  type ModelRequest,
  type ModelResult
} from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => {
  context?.close();
  context = undefined;
});

describe('V7书级题材档案共享Ensurer', () => {
  it('同书并发和重复调用只执行一次副编模型，并用隐藏内部批次保存完成证据', async () => {
    context = createTestContext('wenmi-v7-genre-profile-ensure-');
    const resolver = new GenreProfileResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'genre-profile@example.com', '题材档案作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '汉末求生录', 'genre-profile-book-0001');
      const ownerId = bookOwner(context.database, bookId);
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const firstService = new V7BookGenreProfileEnsureService(context.database, resolver, ids, clock);
      const secondService = new V7BookGenreProfileEnsureService(context.database, resolver, ids, clock);

      const [first, second] = await Promise.all([
        firstService.ensure(ownerId, bookId),
        secondService.ensure(ownerId, bookId)
      ]);
      const repeated = await firstService.ensure(ownerId, bookId);

      expect(first.profileId).toBe(second.profileId);
      expect(repeated.profileId).toBe(first.profileId);
      expect(first).toMatchObject({
        ownerId,
        bookId,
        sourceBookVersion: 1,
        primaryGenreKey: 'history',
        status: 'active'
      });
      expect(resolver.attempts).toBe(1);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
        .get(ownerId, bookId)).toEqual({ count: 1 });
      expect(context.database.prepare(`SELECT status,json_extract(custom_items_json,'$.phase') AS phase
        FROM v7_setting_batches WHERE owner_id=? AND book_id=?
          AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
        .get(ownerId, bookId)).toEqual({ status: 'completed', phase: 'completed' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs job
        JOIN v7_setting_batches batch ON batch.batch_id=job.batch_id
        WHERE batch.owner_id=? AND batch.book_id=?
          AND json_extract(batch.custom_items_json,'$.taskKind')='genre_profile'`)
        .get(ownerId, bookId)).toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND node_key='genre_profile' AND state='succeeded'`)
        .get(ownerId, bookId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('模型结果未知时保存未知证据并阻止后续调用盲目重发', async () => {
    context = createTestContext('wenmi-v7-genre-profile-unknown-');
    const resolver = new GenreProfileResolver('unknown');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'genre-profile-unknown@example.com', '未知档案作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '汉末未知录', 'genre-profile-book-unknown');
      const ownerId = bookOwner(context.database, bookId);
      const service = new V7BookGenreProfileEnsureService(
        context.database,
        resolver,
        new SequenceIds(),
        new FixedClock()
      );

      await expect(service.ensure(ownerId, bookId)).rejects.toMatchObject({ outcomeUnknown: true });
      await expect(service.ensure(ownerId, bookId)).rejects.toMatchObject({ outcomeUnknown: true });

      expect(resolver.attempts).toBe(1);
      expect(context.database.prepare(`SELECT state FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND node_key='genre_profile'`)
        .get(ownerId, bookId)).toEqual({ state: 'unknown' });
      expect(context.database.prepare(`SELECT status,json_extract(custom_items_json,'$.phase') AS phase
        FROM v7_setting_batches WHERE owner_id=? AND book_id=?
          AND json_extract(custom_items_json,'$.taskKind')='genre_profile'`)
        .get(ownerId, bookId)).toEqual({ status: 'partially_failed', phase: 'unknown' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_book_genre_profiles
        WHERE owner_id=? AND book_id=?`).get(ownerId, bookId)).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('模型明确失败后只按原冻结资料技术重试，并保留两次独立调用证据', async () => {
    context = createTestContext('wenmi-v7-genre-profile-retry-');
    const resolver = new GenreProfileResolver('known');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'genre-profile-retry@example.com', '档案重试作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '汉末重试录', 'genre-profile-book-retry');
      const ownerId = bookOwner(context.database, bookId);
      const service = new V7BookGenreProfileEnsureService(
        context.database,
        resolver,
        new SequenceIds(),
        new FixedClock()
      );

      await expect(service.ensure(ownerId, bookId)).rejects.toMatchObject({ outcomeUnknown: false });
      resolver.failure = 'none';
      const profile = await service.ensure(ownerId, bookId);

      expect(profile).toMatchObject({ ownerId, bookId, primaryGenreKey: 'history', status: 'active' });
      expect(resolver.attempts).toBe(2);
      const calls = context.database.prepare(`SELECT request_id,prompt_hash,state FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND node_key='genre_profile' ORDER BY started_at,request_id`)
        .all(ownerId, bookId) as Array<{ request_id: string; prompt_hash: string; state: string }>;
      expect(calls.map((call) => call.state)).toEqual(['failed', 'succeeded']);
      expect(new Set(calls.map((call) => call.request_id)).size).toBe(2);
      expect(new Set(calls.map((call) => call.prompt_hash)).size).toBe(1);
    } finally {
      await app.close();
    }
  });
});

class GenreProfileResolver implements V7OpeningModelAdapterResolver {
  public attempts = 0;

  public constructor(public failure: 'none' | 'known' | 'unknown' = 'none') {}

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider,
      modelId,
      generate: async (request: ModelRequest): Promise<ModelResult> => {
        if (!request.prompt.includes('v7_compile_book_genre_profile_v1')) {
          throw new Error('测试只允许调用题材档案任务');
        }
        this.attempts += 1;
        if (this.failure === 'unknown') {
          throw new ModelAdapterError('模拟题材档案结果未知', 'technical_failure', true, 504, true);
        }
        if (this.failure === 'known') throw new Error('模拟题材档案明确失败');
        return {
          provider,
          modelId,
          output: JSON.stringify({
            primaryGenreKey: 'history',
            supportingGenreKeys: [],
            publicLabel: '历史成长',
            workingIdentity: '以汉末真实社会条件为边界，让小人物靠连续选择和代价逐步改变处境。',
            primaryPromise: '在可信的历史限制内兑现持续成长。',
            supportingFunctions: ['历史：约束时代制度、交通、军政和资源条件。'],
            writingPriorities: ['人物行动服从时代条件', '每次成长都产生真实代价'],
            authenticityChecks: ['年代、交通、军政与物资互相一致'],
            avoidPatterns: ['现代知识无成本碾压', '历史人物集体降智'],
            conflictResolutions: []
          }),
          inputTokens: 80,
          outputTokens: 160,
          cashCostCny: 0,
          state: 'succeeded'
        };
      }
    };
  }
}

function bookOwner(database: TestContext['database'], bookId: string): string {
  const row = database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as
    { owner_id: string } | undefined;
  if (row === undefined) throw new Error('测试书籍不存在');
  return row.owner_id;
}

async function register(
  app: Awaited<ReturnType<typeof createServer>>,
  email: string,
  displayName: string,
  password: string
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: HEADERS,
    payload: { email, password, displayName }
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  title: string,
  key: string
): Promise<string> {
  const openingPackage = {
    title,
    positioning: {
      publishingPlatform: 'fanqie',
      channel: 'male',
      category: '历史脑洞',
      genres: ['历史脑洞'],
      tags: ['历史', '成长', '权谋'],
      coreAppeal: '小人物在汉末乱世中稳步成长。',
      targetReaders: '喜欢历史成长和持续回报的男频读者',
      expectedTotalWords: 2_000_000,
      volumePlan: { minimum: 5, recommended: 6, maximum: 8 },
      retentionPositioning: '开篇快速建立处境，逐卷兑现成长和局势变化。'
    },
    backgrounds: { eraAndWorld: '东汉末年', openingSituation: '主角处于社会底层。' },
    protagonists: [{
      name: '张三', age: '23岁', identity: '男主', background: '普通人', familyBackground: '普通家庭出身',
      careerBackground: '', goldenFinger: '', goal: '活下去并改变处境', dilemma: '资源和身份不足',
      personality: ['谨慎'], boundary: '不能无代价解决问题'
    }],
    opening: {
      startingSituation: '危机中醒来', incitingIncident: '被卷入冲突', immediateConflict: '必须立即选择',
      readerPromise: '靠行动逐步成长'
    },
    longTermDirection: {
      centralConflict: '个人与旧秩序冲突', progression: '从底层到能影响局势',
      relationshipDirection: '逐步建立可信伙伴', storyPotential: '冲突持续升级'
    },
    possibleEnding: {
      direction: '建立新的生活秩序', price: '承担真实损失', openness: '保留调整空间'
    },
    authorNotes: [],
    mustFollow: ['不得引入系统或超现实能力']
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/v7/opening-books',
    headers: { ...HEADERS, cookie },
    payload: { openingPackage, idempotencyKey: key }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.bookId as string;
}
