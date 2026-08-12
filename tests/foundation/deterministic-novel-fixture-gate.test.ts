import { describe, expect, it } from 'vitest';
import { assertDeterministicNovelFixtureAllowed } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import {
  assertDeterministicCreativeFixtureAllowed, deterministicCreativeFixtureAllowed
} from '../../apps/api/src/infrastructure/models/deterministic-model.js';

describe('本地验收写手边界', () => {
  it('设定到三审的全创作链都只在测试或明确开关下使用夹具', () => {
    expect(deterministicCreativeFixtureAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(deterministicCreativeFixtureAllowed({ WENMI_ALLOW_DETERMINISTIC_CREATIVE_FIXTURE: '1' })).toBe(true);
    expect(deterministicCreativeFixtureAllowed({ WENMI_ALLOW_DETERMINISTIC_NOVEL_FIXTURE: '1' })).toBe(true);
    expect(deterministicCreativeFixtureAllowed({})).toBe(false);
    expect(() => assertDeterministicCreativeFixtureAllowed({})).toThrow(/设定、分卷、规划、章纲、正文和点评会暂停/u);
  });
  it('只在测试或明确验收开关下允许生成，不在正常作者流程伪造正文', () => {
    expect(() => assertDeterministicNovelFixtureAllowed({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertDeterministicNovelFixtureAllowed({ WENMI_ALLOW_DETERMINISTIC_NOVEL_FIXTURE: '1' })).not.toThrow();
    expect(() => assertDeterministicNovelFixtureAllowed({})).toThrow(/尚未连接可用于创作的AI模型/u);
  });
});
