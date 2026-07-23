import { describe, expect, it } from 'vitest';
import { modelReservationTokenCeiling } from '../../apps/api/src/application/creation/chapter-pipeline-service.js';

describe('长正文模型预算冻结估算', () => {
  it('为Codex不可见协议包装预留有界余量且不改变Ark冻结量', () => {
    const common = { estimatedPromptTokens: 12_000, packBudget: 12_000, maxOutputTokens: 8_000 };
    expect(modelReservationTokenCeiling({ provider: 'openai-codex-subscription', ...common })).toBe(48_201);
    expect(modelReservationTokenCeiling({ provider: 'volcengine-ark-agent-plan', ...common })).toBe(24_201);
  });

  it('本地确定性模型只按可见输入加有界误差冻结', () => {
    expect(modelReservationTokenCeiling({
      provider: 'local-deterministic-writer', estimatedPromptTokens: 1_000, packBudget: 24_000, maxOutputTokens: 2_000
    })).toBe(3_150);
  });
});
