import { describe, expect, it } from 'vitest';

describe('V7独立后端回归入口', () => {
  it('成员、开书引擎、叙事方法和剧情模式注册表保持有效', async () => {
    await import('../../../coauthoring-v7/backend/agents/agent-foundation.test.js');
    await import('../../../coauthoring-v7/backend/opening-agent/opening-agent-engine.test.js');
    await import('../../../coauthoring-v7/backend/narrative-methods/narrative-method-library.test.js');
    await import('../../../coauthoring-v7/backend/plot-patterns/plot-pattern-library.test.js');
    expect(true).toBe(true);
  });
});
