import { ArkPlanModelAdapter } from './ark-plan-model.js';
import { DeterministicModelAdapter } from './deterministic-model.js';
import {
  DeterministicNovelCandidateBAdapter,
  DeterministicNovelReviewerAdapter,
  DeterministicNovelWriterAdapter
} from './deterministic-novel-models.js';
import type { ModelAdapter } from './model-adapter.js';
import type { ModelPurpose, ModelRuntimeConfig } from './model-runtime-config.js';
import type { RoleKey } from '../../domain/roles.js';
import { buildRoleSystemPrompt } from '../../domain/role-prompts.js';
import { CodexSubscriptionModelAdapter, type CodexProcessRunner } from './codex-subscription-model.js';

export class ModelAdapterFactory {
  public constructor(
    private readonly config: ModelRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly codexRunner?: CodexProcessRunner
  ) {}

  public resolve(provider: string, modelId: string, purpose: ModelPurpose, roleKey?: RoleKey): ModelAdapter {
    if (provider === 'local-deterministic' && modelId === 'wenmi-fixture-v1') return new DeterministicModelAdapter();
    if (provider === 'local-deterministic-writer' && modelId === 'wenmi-novel-writer-v1') return new DeterministicNovelWriterAdapter();
    if (provider === 'local-deterministic-candidate-b' && modelId === 'wenmi-novel-candidate-b-v1') return new DeterministicNovelCandidateBAdapter();
    if (provider === 'local-deterministic-reviewer' && modelId === 'wenmi-novel-reviewer-v1') return new DeterministicNovelReviewerAdapter();

    if (provider === this.config.codex.provider) {
      if (this.config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活，禁止发起Codex真实调用');
      if (modelId !== this.config.codex.modelId) throw new Error(`未批准的Codex订阅模型：${modelId}`);
      if (roleKey === undefined) throw new Error('Codex订阅模型调用缺少岗位身份');
      return new CodexSubscriptionModelAdapter({
        executable: this.config.codex.executable,
        provider: this.config.codex.provider,
        modelId,
        workingDirectory: this.config.codex.workingDirectory,
        timeoutMs: this.config.codex.timeoutMs,
        purpose,
        roleKey
      }, this.codexRunner);
    }
    const endpoint = provider === this.config.endpoints.coding.provider
      ? this.config.endpoints.coding
      : provider === this.config.endpoints.agent.provider
        ? this.config.endpoints.agent
        : undefined;
    if (endpoint === undefined) throw new Error(`未注册的模型来源：${provider}/${modelId}`);
    if (this.config.activeMode !== 'subscription-plan') throw new Error('火山方舟套餐模式未激活，禁止发起真实模型调用');
    if (endpoint.apiKey === undefined) throw new Error(`${endpoint.plan} plan凭证未配置`);
    const allowed = new Set(Object.values(this.config.roleProfiles)
      .filter((profile) => profile.provider === provider)
      .map((profile) => profile.modelId));
    if (!allowed.has(modelId)) throw new Error(`模型不在已批准的套餐角色配置中：${provider}/${modelId}`);
    return new ArkPlanModelAdapter({
      plan: endpoint.plan,
      provider,
      modelId,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      purpose,
      ...(roleKey === undefined ? {} : { systemPrompt: buildRoleSystemPrompt(roleKey, purpose) })
    }, this.fetchImpl);
  }
}
