import { describe, expect, it } from 'vitest';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

describe('模型运行配置', () => {
  it('没有套餐凭证时诚实回到确定性开发模式', () => {
    const config = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' });

    expect(config).toMatchObject({
      requestedMode: 'subscription-plan',
      activeMode: 'deterministic',
      missingCredentials: ['coding-plan', 'agent-plan'],
      strictPlanOnly: true,
      cashFallbackAllowed: false
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'local-deterministic',
      modelId: 'wenmi-fixture-v1'
    });
  });

  it('两种套餐凭证齐全时绑定老板指定的四种模型', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.roleProfiles.chief_editor).toMatchObject({
      provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex'
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex'
    });
    expect(config.roleProfiles.plot_architect).toMatchObject({ modelId: 'deepseek-v4-pro' });
    expect(config.roleProfiles.continuity).toMatchObject({ modelId: 'glm-5-2-260617' });
    expect(config.roleProfiles.reviewer).toMatchObject({ modelId: 'kimi-k2-6-modelhub' });
    expect(config.roleProfiles.reader_experience).toMatchObject({ modelId: 'doubao-seed-2-0-pro-260215' });
    expect(config.codex.timeoutMs).toBe(900_000);
    expect(config.publicProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gpt-5.6-sol', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'deepseek-v4-pro', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'glm-5-2-260617', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'kimi-k2-6-modelhub', credentialConfigured: true })
    ]));
    expect(JSON.stringify(config.publicProfiles)).not.toContain('test-key');
  });

  it('拒绝普通按量计费地址和未知运行模式', () => {
    expect(() => loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'unknown' })).toThrow('WENMI_MODEL_MODE');
    expect(() => loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_AGENT_PLAN_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3'
    })).toThrow('只允许火山方舟套餐端点');
  });
});
