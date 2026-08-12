import { describe, expect, it } from 'vitest';
import { assertDeterministicNovelFixtureAllowed } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';

describe('本地验收写手边界', () => {
  it('只在测试或明确验收开关下允许生成，不在正常作者流程伪造正文', () => {
    expect(() => assertDeterministicNovelFixtureAllowed({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertDeterministicNovelFixtureAllowed({ WENMI_ALLOW_DETERMINISTIC_NOVEL_FIXTURE: '1' })).not.toThrow();
    expect(() => assertDeterministicNovelFixtureAllowed({})).toThrow(/当前没有可用的创作模型/u);
  });
});
