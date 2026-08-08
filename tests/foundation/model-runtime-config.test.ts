import { describe, expect, it } from 'vitest';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

describe('模型运行配置', () => {
  it('没有套餐凭证时诚实回到确定性开发模式', () => {
    const config = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' });

    expect(config).toMatchObject({
      requestedMode: 'subscription-plan',
      activeMode: 'deterministic',
      missingCredentials: ['agent-plan'],
      strictPlanOnly: true,
      cashFallbackAllowed: false
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'local-deterministic',
      modelId: 'wenmi-fixture-v1'
    });
  });

  it('Agent Plan凭证齐全时绑定十一岗位所需的七种模型', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.roleProfiles.chief_editor).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent'
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', plan: 'agent'
    });
    expect(config.roleProfiles.plot_architect).toMatchObject({ modelId: 'deepseek-v4-pro' });
    expect(config.roleProfiles.continuity).toMatchObject({ modelId: 'glm-5.2' });
    expect(config.roleProfiles.reviewer).toMatchObject({ modelId: 'minimax-m3' });
    expect(config.roleProfiles.reader_experience).toMatchObject({ modelId: 'doubao-seed-2.1-turbo' });
    expect(config.roleProfiles.style_editor).toMatchObject({ modelId: 'kimi-k2.7-code' });
    expect(config.roleProfiles.researcher).toMatchObject({ modelId: 'deepseek-v4-flash' });
    expect(config.codex.timeoutMs).toBe(900_000);
    expect(config.publicProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'kimi-k3', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'deepseek-v4-pro', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'glm-5.2', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'kimi-k2.7-code', credentialConfigured: true })
    ]));
    expect(JSON.stringify(config.publicProfiles)).not.toContain('test-key');
  });

  it('桌面进程残留旧模型别名时迁移为当前Agent Plan模型', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_AGENT_PLAN_KIMI_MODEL: 'kimi-k2-6-modelhub',
      WENMI_ARK_AGENT_PLAN_GLM_MODEL: 'glm-5-2-260617',
      WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL: 'doubao-seed-2-0-pro-260215'
    });

    expect(config.roleProfiles.chief_editor.modelId).toBe('kimi-k3');
    expect(config.roleProfiles.continuity.modelId).toBe('glm-5.2');
    expect(config.roleProfiles.reader_experience.modelId).toBe('doubao-seed-2.1-turbo');
  });

  it('忽略桌面环境中与当前项目无关的旧Anthropic地址', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan'
    });

    expect(config.endpoints.coding.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
  });

  it('仍然拒绝文秘写作专用Coding Plan变量中的错误套餐路径', () => {
    expect(() => loadModelRuntimeConfig({
      WENMI_ARK_CODING_PLAN_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan'
    })).toThrow('只允许火山方舟套餐端点');
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
