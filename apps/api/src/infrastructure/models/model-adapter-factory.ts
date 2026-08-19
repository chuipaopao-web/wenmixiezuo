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
import { literaryReviewerCodingProfile } from './model-runtime-config.js';
import type { RoleKey } from '../../domain/roles.js';
import { buildRoleSystemPrompt } from '../../domain/role-prompts.js';
import { CodexSubscriptionModelAdapter, type CodexProcessRunner } from './codex-subscription-model.js';
import { creativeMemberContracts, type CreativeRoleKey } from '../../contracts/agent-team-v2.js';

export class ModelAdapterFactory {
  public constructor(
    private readonly config: ModelRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly codexRunner?: CodexProcessRunner
  ) {}

  public resolve(provider: string, modelId: string, purpose: ModelPurpose, roleKey?: RoleKey | CreativeRoleKey): ModelAdapter {
    if (provider === 'local-deterministic' && (modelId === 'wenmi-fixture-v1' || modelId.startsWith('wenmi-fixture-v2'))) {
      if (purpose === 'novel_reviewer') return new DeterministicProductionReviewerAdapter(modelId, reviewerRoleFor(roleKey));
      return new DeterministicModelAdapter(modelId);
    }
    if (provider === 'local-deterministic-writer' && modelId === 'wenmi-novel-writer-v1') return new DeterministicNovelWriterAdapter();
    if (provider === 'local-deterministic-candidate-b' && modelId === 'wenmi-novel-candidate-b-v1') return new DeterministicNovelCandidateBAdapter();
    if (provider === 'local-deterministic-reviewer' && modelId === 'wenmi-novel-reviewer-v1') return new DeterministicNovelReviewerAdapter();

    if (provider === this.config.codex.provider) {
      if (this.config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活，禁止发起Codex真实调用');
      if (modelId !== this.config.codex.modelId) throw new Error(`未批准的Codex订阅模型：${modelId}`);
      if (roleKey === undefined) throw new Error('Codex订阅模型调用缺少岗位身份');
      const systemPrompt = buildRuntimeRoleSystemPrompt(roleKey, purpose);
      return new CodexSubscriptionModelAdapter({
        executable: this.config.codex.executable,
        provider: this.config.codex.provider,
        modelId,
        workingDirectory: this.config.codex.workingDirectory,
        timeoutMs: this.config.codex.timeoutMs,
        purpose,
        systemPrompt
      }, this.codexRunner);
    }
    const endpoint = provider === this.config.endpoints.coding.provider
      ? this.config.endpoints.coding
      : provider === this.config.endpoints.agent.provider
        ? this.config.endpoints.agent
        : provider === 'opencodego'
          ? this.config.endpoints.opencodego
          : undefined;
    if (endpoint === undefined) throw new Error(`未注册的模型来源：${provider}/${modelId}`);
    if (this.config.activeMode !== 'subscription-plan') throw new Error('订阅模型模式未激活，禁止发起真实模型调用');
    if (endpoint.apiKey === undefined) throw new Error(`${endpoint.plan} plan凭证未配置`);
    const allowed = new Set(Object.values(this.config.roleProfiles)
      .filter((profile) => profile.provider === provider)
      .map((profile) => profile.modelId));
    // 文学审查席的第六模型挂在 Coding Plan（doubao-seed-code），不在九岗位配置里，单独放行。
    const literaryCoding = literaryReviewerCodingProfile();
    if (literaryCoding.provider === provider) allowed.add(literaryCoding.modelId);
    if (!allowed.has(modelId)) throw new Error(`模型不在已批准的套餐角色配置中：${provider}/${modelId}`);
    return new ArkPlanModelAdapter({
      plan: endpoint.plan,
      provider,
      modelId,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      purpose,
      ...(roleKey === undefined ? {} : { systemPrompt: buildRuntimeRoleSystemPrompt(roleKey, purpose) })
    }, this.fetchImpl);
  }
}

export function buildRuntimeRoleSystemPrompt(
  roleKey: RoleKey | CreativeRoleKey,
  purpose: ModelPurpose
): string {
  const legacyRole = legacyPromptRole(roleKey);
  const member = creativeMemberContracts.find((item) => item.roleKey === roleKey);
  return buildRoleSystemPrompt(
    legacyRole,
    purpose,
    member === undefined
      ? undefined
      : {
          identity: `${member.memberName}（${member.shortTitle}）`,
          positioning: member.publicSummary,
          professionalIdentity: member.professionalIdentity,
          craftStrengths: member.craftStrengths,
          workingMethod: member.workingMethod,
          responsibilities: member.responsibilities,
          boundaries: member.boundaries
        }
  );
}

function reviewerRoleFor(roleKey?: RoleKey | CreativeRoleKey): 'fact' | 'literary' | 'experience' | 'challenger' {
  if (roleKey === 'experience_challenger') return 'challenger';
  if (roleKey === 'fact_reviewer' || roleKey === 'setting' || roleKey === 'continuity' || roleKey === 'lead_screenwriter' || roleKey === 'plot_architect') return 'fact';
  if (roleKey === 'experience_reviewer' || roleKey === 'reader_experience') return 'experience';
  return 'literary';
}

function legacyPromptRole(roleKey: RoleKey | CreativeRoleKey): RoleKey {
  const map: Partial<Record<CreativeRoleKey, RoleKey>> = {
    chief_editor: 'chief_editor', deputy_editor: 'chief_editor', lead_screenwriter: 'plot_architect',
    second_screenwriter: 'plot_architect', third_screenwriter: 'chief_editor', setting: 'continuity',
    lead_writer: 'writer', backup_writer: 'writer', fact_reviewer: 'style_editor',
    literary_reviewer: 'reviewer', experience_reviewer: 'reader_experience', experience_challenger: 'researcher',
    researcher: 'researcher', copyright: 'copyright'
  };
  return map[roleKey as CreativeRoleKey] ?? roleKey as RoleKey;
}
