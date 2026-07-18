import { describe, expect, it } from 'vitest';
import { DeterministicLocalUtilityModel } from '../../../apps/worker/src/adapters/deterministic-local-utility-model.js';
import { NullLocalUtilityModel } from '../../../apps/worker/src/adapters/null-local-utility-model.js';

describe('小文秘书本地工具候选', () => {
  it('只返回带来源哈希的严格候选，不执行业务写入', async () => {
    const model = new DeterministicLocalUtilityModel();
    await expect(model.infer({ task: 'intent_classification', text: '我想讨论一下后续剧情' })).resolves.toMatchObject({
      schemaVersion: 1, task: 'intent_classification', confidence: 1, values: { intent: 'plot_discussion' },
      sourceTextHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(model.infer({ task: 'entity_candidates', text: '张三没有向天安城宣战', allowedEntityNames: ['张三', '天安城', '李四'] }))
      .resolves.toMatchObject({ values: { entities: ['张三', '天安城'] } });
    await expect(new NullLocalUtilityModel().infer({ task: 'negation_detection', text: '并非如此' }))
      .rejects.toThrow('LOCAL_UTILITY_MODEL_UNAVAILABLE');
  });
});
