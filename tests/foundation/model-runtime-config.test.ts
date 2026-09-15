import { describe, expect, it } from 'vitest';
import { glmPlanningHeadroomTokens, loadModelRuntimeConfig, thinkingTokenAllowance } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { V7_TEXT_MODEL_PROFILE_KEYS, modelBindingForProfile } from '../../coauthoring-v7/backend/agent-governance/agent-governance-registry.js';

describe('模型运行配置', () => {
  it('显式订阅模式缺凭据不退回夹具，诚实标记缺少Agent Plan', () => {
    const config = loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' });

    expect(config).toMatchObject({
      requestedMode: 'subscription-plan',
      activeMode: 'subscription-plan',
      missingCredentials: ['agent-plan'],
      strictPlanOnly: true,
      cashFallbackAllowed: false
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'volcengine-ark-agent-plan',
      modelId: 'deepseek-v4-pro',
      plan: 'agent'
    });
  });

  it('无凭据且未显式启用时仍可离线确定性开发', () => {
    const config = loadModelRuntimeConfig({});

    expect(config.requestedMode).toBe('deterministic');
    expect(config.activeMode).toBe('deterministic');
    expect(config.missingCredentials).toEqual(['agent-plan']);
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'local-deterministic',
      modelId: 'wenmi-fixture-v1'
    });
  });

  it('全部岗位统一绑定Agent Plan，旧Coding Plan凭据不参与新请求', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.missingCredentials).toEqual([]);
    expect(config.roleProfiles.chief_editor).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', plan: 'agent'
    });
    expect(config.roleProfiles.writer).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', plan: 'agent'
    });
    expect(Object.values(config.roleProfiles).every(profile => profile.modelId === 'deepseek-v4-pro' && profile.plan === 'agent')).toBe(true);
    expect(config.endpoints.coding.apiKey).toBeUndefined();
    expect(JSON.stringify(config.publicProfiles)).not.toContain('test-key');
  });

  it('只有旧Coding Plan凭证时不可发起新请求，单独标记缺少Agent Plan', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key'
    });

    expect(config.activeMode).toBe('subscription-plan');
    expect(config.missingCredentials).toEqual(['agent-plan']);
    expect(config.roleProfiles.writer.plan).toBe('agent');
    expect(config.endpoints.agent.apiKey).toBeUndefined();
    expect(config.endpoints.coding.apiKey).toBeUndefined();
    expect(() => new ModelAdapterFactory(config).resolve('volcengine-ark-agent-plan', 'deepseek-v4-pro', 'discussion')).toThrow('凭证未配置');
    expect(() => new ModelAdapterFactory(config).resolve('volcengine-ark-coding-plan', 'deepseek-v4-pro', 'discussion')).toThrow('Coding Plan已停用');
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

  it.each([
    ['WENMI_ARK_AGENT_PLAN_KIMI_MODEL', 'kimi-k3'],
    ['WENMI_ARK_AGENT_PLAN_KIMI_MODEL', 'kimi-k2-6-modelhub'],
    ['WENMI_ARK_AGENT_PLAN_DEEPSEEK_MODEL', 'glm-5-2-260617'],
    ['WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'doubao-seed-2-0-pro-260215']
  ] as const)('明确拒绝退役模型配置 %s=%s，不静默重绑为当前模型', (envKey, modelId) => {
    expect(() => loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      [envKey]: modelId
    })).toThrow(`旧Agent Plan模型配置已退役，禁止自动重绑：${modelId}`);
  });
  it('旧Coding Plan覆盖变量不再承担新模型配置，其中的退役值也不参与', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_CODING_PLAN_KIMI_MODEL: 'kimi-k3',
      WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL: 'glm-5-2-260617'
    });

    expect(config.roleProfiles.reviewer.modelId).toBe('deepseek-v4-pro');
    expect(config.roleProfiles.writer.provider).toBe('volcengine-ark-agent-plan');
  });
  it('Agent Plan覆盖变量直接生效，旧Coding Plan变量不再覆盖新模型', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key',
      WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL: 'doubao-seed-2.1-turbo',
      WENMI_ARK_AGENT_PLAN_DEEPSEEK_MODEL: 'deepseek-v4-flash'
    });

    expect(config.roleProfiles.chief_editor.modelId).toBe('deepseek-v4-flash');
    expect(config.roleProfiles.style_editor.modelId).toBe('deepseek-v4-flash');
    expect(config.roleProfiles.reviewer.modelId).toBe('deepseek-v4-flash');
    expect(config.roleProfiles.continuity.modelId).toBe('deepseek-v4-flash');
  });
  it('GLM-5.3与Flash公开配置，停用5.2不再执行', () => {
    const config = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    });
    expect(config.publicProfiles.filter((profile) => /glm-5\.[23]/iu.test(profile.modelId))).toEqual([
      {
        provider: 'volcengine-ark-agent-plan', modelId: 'glm-5.3-flash', plan: 'agent',
        roles: [], credentialConfigured: true
      },
      {
        provider: 'volcengine-ark-agent-plan', modelId: 'glm-5.3', plan: 'agent',
        roles: [], credentialConfigured: true
      }
    ]);
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-agent-plan', 'glm-5.3', 'discussion'
    )).not.toThrow();
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-agent-plan', 'glm-5.2', 'novel_reviewer'
    )).toThrow('模型不在已批准的套餐角色配置中');
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-coding-plan', 'glm-5.3', 'discussion'
    )).toThrow('Coding Plan已停用');
    expect(() => new ModelAdapterFactory(config).resolve(
      'volcengine-ark-agent-plan', 'kimi-k3', 'novel_writer'
    )).not.toThrow();
  });
  it('旧Anthropic和AgentPlan别名不再配置文秘写作模型通道', () => {
    const config = loadModelRuntimeConfig({
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
      ANTHROPIC_AUTH_TOKEN: 'retired-compatible-token',
      ARK_AGENTPLAN_BASE_URL: 'https://ark.cn-beijing.volces.com/api/plan',
      ARK_AGENTPLAN_KEY: 'retired-agent-token'
    });

    expect(config.requestedMode).toBe('deterministic');
    expect(config.activeMode).toBe('deterministic');
    expect(config.endpoints.coding.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
    expect(config.endpoints.coding.apiKey).toBeUndefined();
    expect(config.endpoints.agent.apiKey).toBeUndefined();
    expect(config.missingCredentials).toEqual(['agent-plan']);
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

describe('GLM-5.3 直出路由的动态思考余量', () => {
  // 2026-09-02 生产实证：固定1k余量被GLM失控隐式思考全部烧穿（规划成功率跌至9%），
  // 余量改为随提示词规模折算（1/3），保底8k、封顶32k。
  it('按提示词字符数的三分之一折算', () => {
    expect(glmPlanningHeadroomTokens(15_000)).toBe(8_000);
    expect(glmPlanningHeadroomTokens(60_000)).toBe(20_000);
    expect(glmPlanningHeadroomTokens(90_000)).toBe(30_000);
  });

  it('保底8k、封顶32k，非法输入回到保底', () => {
    expect(glmPlanningHeadroomTokens(0)).toBe(8_000);
    expect(glmPlanningHeadroomTokens(-5)).toBe(8_000);
    expect(glmPlanningHeadroomTokens(Number.NaN)).toBe(8_000);
    expect(glmPlanningHeadroomTokens(300_000)).toBe(32_000);
  });

  it('GLM结构化规划命中动态余量，DeepSeek不受影响', () => {
    expect(thinkingTokenAllowance('glm-5.3', 'structured_planning', 19_000, 90_000)).toBe(30_000);
    expect(thinkingTokenAllowance('glm-5.3', 'structured_planning', 19_000, 3_000)).toBe(8_000);
    // 未传提示词长度的调用点按保底8k，不再使用旧的1k。
    expect(thinkingTokenAllowance('glm-5.3', 'structured_planning', 19_000)).toBe(8_000);
    expect(thinkingTokenAllowance('deepseek-v4-pro', 'structured_planning', 8_000, 90_000)).toBe(4_000);
  });
});
