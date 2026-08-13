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

  it('Agent Plan凭证齐全时绑定十一岗位所需的六种模型且不含K3', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.roleProfiles.chief_editor).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2.7-code', plan: 'agent'
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', plan: 'agent'
    });
    expect(config.roleProfiles.plot_architect).toMatchObject({ modelId: 'deepseek-v4-pro' });
    expect(config.roleProfiles.continuity).toMatchObject({ modelId: 'glm-5.2' });
    expect(config.roleProfiles.reviewer).toMatchObject({ modelId: 'minimax-m3' });
    expect(config.roleProfiles.reader_experience).toMatchObject({ modelId: 'doubao-seed-2.1-turbo' });
    expect(config.roleProfiles.style_editor).toMatchObject({ modelId: 'glm-5.2' });
    expect(config.roleProfiles.researcher).toMatchObject({ modelId: 'deepseek-v4-flash' });
    expect(config.codex.timeoutMs).toBe(900_000);
    expect(config.publicProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'kimi-k2.7-code', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'deepseek-v4-pro', credentialConfigured: true }),
      expect.objectContaining({ modelId: 'glm-5.2', credentialConfigured: true })
    ]));
    expect(JSON.stringify(config.publicProfiles)).not.toContain('test-key');
    expect(JSON.stringify(config.publicProfiles)).not.toContain('kimi-k3');
  });

  it('桌面进程残留K3或旧K2.6别名时只迁移到K2.7', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_AGENT_PLAN_KIMI_MODEL: 'kimi-k2-6-modelhub',
      WENMI_ARK_AGENT_PLAN_GLM_MODEL: 'glm-5-2-260617',
      WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL: 'doubao-seed-2-0-pro-260215'
    });

    expect(config.roleProfiles.chief_editor.modelId).toBe('kimi-k2.7-code');
    expect(config.roleProfiles.continuity.modelId).toBe('glm-5.2');
    expect(config.roleProfiles.reader_experience.modelId).toBe('doubao-seed-2.1-turbo');

    const k3 = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_AGENT_PLAN_KIMI_MODEL: 'kimi-k3'
    });
    expect(k3.roleProfiles.chief_editor.modelId).toBe('kimi-k2.7-code');
    expect(config.roleProfiles.continuity.modelId).toBe('glm-5.2');
    expect(config.roleProfiles.reader_experience.modelId).toBe('doubao-seed-2.1-turbo');
  });

  it('忽略桌面环境中与当前项目无关的旧Anthropic地址', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_AUTH_TOKEN: 'unrelated-token'
    });

    expect(config.activeMode).toBe('deterministic');
    expect(config.endpoints.coding.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
    expect(config.endpoints.coding.apiKey).toBeUndefined();
    expect(config.endpoints.agent.apiKey).toBeUndefined();
  });

  it('严格识别旧兼容变量中的Agent Plan且无显式模式时自动启用真实套餐', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan',
      ANTHROPIC_AUTH_TOKEN: 'agent-compatible-token'
    });

    expect(config.requestedMode).toBe('subscription-plan');
    expect(config.activeMode).toBe('subscription-plan');
    expect(config.endpoints.agent).toMatchObject({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      apiKey: 'agent-compatible-token'
    });
    expect(config.endpoints.coding.apiKey).toBeUndefined();
  });

  it('显式确定性模式不被兼容套餐凭证覆盖', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'deterministic',
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan',
      ANTHROPIC_AUTH_TOKEN: 'agent-compatible-token'
    });

    expect(config.requestedMode).toBe('deterministic');
    expect(config.activeMode).toBe('deterministic');
    expect(config.endpoints.agent.apiKey).toBe('agent-compatible-token');
    expect(config.roleProfiles.writer.modelId).toBe('wenmi-fixture-v1');
  });

  it('兼容令牌只有精确Coding Plan路径时才归入Coding套餐', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
      ANTHROPIC_AUTH_TOKEN: 'coding-compatible-token'
    });

    expect(config.requestedMode).toBe('deterministic');
    expect(config.endpoints.coding.apiKey).toBe('coding-compatible-token');
    expect(config.endpoints.agent.apiKey).toBeUndefined();
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
