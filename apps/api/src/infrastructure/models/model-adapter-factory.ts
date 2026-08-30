import { ArkPlanModelAdapter } from './ark-plan-model.js';
import { DeterministicModelAdapter } from './deterministic-model.js';
import {
  DeterministicNovelCandidateBAdapter,
  DeterministicProductionReviewerAdapter,
  DeterministicNovelReviewerAdapter,
  DeterministicNovelWriterAdapter
} from './deterministic-novel-models.js';
import type { ModelAdapter } from './model-adapter.js';
import type { ModelPurpose, ModelRuntimeConfig } from './model-runtime-config.js';

export class ModelAdapterFactory {
  public constructor(
    private readonly config: ModelRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public resolve(provider: string, modelId: string, purpose: ModelPurpose, _ignoredLegacyRoleKey?: unknown): ModelAdapter {
    if (provider === 'local-deterministic' && (modelId === 'wenmi-fixture-v1' || modelId.startsWith('wenmi-fixture-v2'))) {
      if (purpose === 'novel_reviewer') return new DeterministicProductionReviewerAdapter(modelId, 'literary');
      return new DeterministicModelAdapter(modelId);
    }
    if (provider === 'local-deterministic-writer' && modelId === 'wenmi-novel-writer-v1') return new DeterministicNovelWriterAdapter();
    if (provider === 'local-deterministic-candidate-b' && modelId === 'wenmi-novel-candidate-b-v1') return new DeterministicNovelCandidateBAdapter();
    if (provider === 'local-deterministic-reviewer' && modelId === 'wenmi-novel-reviewer-v1') return new DeterministicNovelReviewerAdapter();
    const endpoint = provider === this.config.endpoints.coding.provider
      ? this.config.endpoints.coding
      : provider === this.config.endpoints.agent.provider
        ? this.config.endpoints.agent
        : undefined;
    if (endpoint === undefined) throw new Error(`未注册的模型来源：${provider}/${modelId}`);
    if (this.config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活，禁止发起真实模型调用');
    if (endpoint.apiKey === undefined) throw new Error(`${endpoint.plan} plan凭证未配置`);
    const allowed = new Set([
      ...Object.values(this.config.roleProfiles),
      ...this.config.publicProfiles
    ].filter((profile) => profile.provider === provider).map((profile) => profile.modelId));
    if (!allowed.has(modelId)) throw new Error(`模型不在已批准的套餐角色配置中：${provider}/${modelId}`);
    return new ArkPlanModelAdapter({
      plan: endpoint.plan,
      provider,
      modelId,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      purpose
    }, this.fetchImpl);
  }
}
