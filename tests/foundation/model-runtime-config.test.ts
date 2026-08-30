import { describe, expect, it } from 'vitest';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { V7_TEXT_MODEL_PROFILE_KEYS, modelBindingForProfile } from '@wenmi/v7-backend';

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

  it('Coding Plan承担普通岗位，高级编剧单独绑定Agent Plan Kimi K3', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.missingCredentials).toEqual([]);
    expect(config.roleProfiles.chief_editor).toMatchObject({
      provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding'
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding'
    });
    expect(config.roleProfiles.continuity).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'doubao-seed-2.1-turbo', plan: 'coding' });
    expect(config.roleProfiles.reviewer).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'kimi-k2.7-code', plan: 'coding' });
    expect(config.roleProfiles.reader_experience).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'doubao-seed-2.1-turbo', plan: 'coding' });
    expect(config.roleProfiles.researcher).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash', plan: 'coding' });
    expect(config.roleProfiles.style_editor).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash', plan: 'coding' });
    expect(JSON.stringify(config.publicProfiles)).not.toContain('test-key');
  });

  it('只有Coding Plan凭证时普通成员可工作，高级编剧单独标记缺少Agent Plan', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.missingCredentials).toEqual(['agent-plan']);
    expect(config.roleProfiles.writer.plan).toBe('coding');
    expect(config.endpoints.agent.apiKey).toBeUndefined();
  });

  it('V7 治理登记的全部文本模型都在运行白名单内', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    const factory = new ModelAdapterFactory(config);
    for (const profileKey of V7_TEXT_MODEL_PROFILE_KEYS) {
      const binding = modelBindingForProfile(profileKey);
      expect(() => factory.resolve(binding.provider, binding.modelId, 'discussion'), profileKey).not.toThrow();
    }
  });

  it('Coding Plan旧模型别名只迁移仍在使用的Kimi和豆包岗位，不会占用高级编剧K3', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_CODING_PLAN_KIMI_MODEL: 'kimi-k2-6-modelhub',

      WENMI_ARK_CODING_PLAN_DOUBAO_MODEL: 'doubao-seed-2-0-pro-260215'
    });

    expect(config.roleProfiles.reviewer.modelId).toBe('kimi-k2.7-code');
    expect(config.roleProfiles.continuity.modelId).toBe('doubao-seed-2.1-turbo');
    expect(config.roleProfiles.reader_experience.modelId).toBe('doubao-seed-2.1-turbo');
  });
  it('GLM-5.2/5.3保持可配置和可执行，但当前岗位方案不绑定', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    expect(config.publicProfiles.filter((profile) => /glm-5\.[23]/iu.test(profile.modelId))).toEqual([
      {
        provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.2', plan: 'coding',
        roles: [], credentialConfigured: true
      },
      {
        provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.3', plan: 'coding',
        roles: [], credentialConfigured: true
      }
    ]);
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-coding-plan', 'glm-5.3', 'discussion', 'second_screenwriter'
    )).not.toThrow();
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-coding-plan', 'glm-5.2', 'novel_reviewer', 'fact_reviewer'
    )).not.toThrow();
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-agent-plan', 'kimi-k3', 'novel_writer'
    )).not.toThrow();
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

  it('旧兼容变量只有Agent Plan时不让普通岗位误用其密钥', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan',
      ANTHROPIC_AUTH_TOKEN: 'agent-compatible-token'
    });

    expect(config.requestedMode).toBe('subscription-plan');
    expect(config.activeMode).toBe('deterministic');
    expect(config.missingCredentials).toContain('coding-plan');
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

  it('兼容令牌只有精确Coding Plan路径时才归入Coding套餐并启用普通岗位', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
      ANTHROPIC_AUTH_TOKEN: 'coding-compatible-token'
    });

    expect(config.requestedMode).toBe('subscription-plan');
    expect(config.activeMode).toBe('subscription-plan');
    expect(config.missingCredentials).toEqual(['agent-plan']);
    expect(config.endpoints.coding.apiKey).toBe('coding-compatible-token');
    expect(config.endpoints.agent.apiKey).toBeUndefined();
    expect(config.roleProfiles.writer.provider).toBe('volcengine-ark-coding-plan');
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
