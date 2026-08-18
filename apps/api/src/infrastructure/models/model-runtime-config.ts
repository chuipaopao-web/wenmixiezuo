import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { RoleKey } from '../../domain/roles.js';

export const novelRoleKeys = [
  'chief_editor',
  'plot_architect',
  'continuity',
  'writer',
  'reviewer',
  'reader_experience',
  'style_editor',
  'researcher',
  'copyright'
] as const satisfies readonly RoleKey[];

export type NovelRoleKey = RoleKey;
export type ModelRuntimeMode = 'deterministic' | 'subscription-plan';
export type ModelPlan = 'deterministic' | 'codex' | 'coding' | 'agent' | 'opencodego';
export type ModelPurpose = 'discussion' | 'structured_planning' | 'novel_writer' | 'novel_reviewer' | 'review_synthesis';

export interface RoleModelProfile {
  provider: string;
  modelId: string;
  plan: ModelPlan;
}

export interface ArkPlanEndpointConfig {
  plan: Extract<ModelPlan, 'coding' | 'agent'>;
  provider: string;
  baseUrl: string;
  apiKey: string | undefined;
}

export interface OpencodegoEndpointConfig {
  plan: Extract<ModelPlan, 'opencodego'>;
  provider: 'opencodego';
  baseUrl: string;
  apiKey: string | undefined;
  modelId: string;
}

export interface PublicModelProfile extends RoleModelProfile {
  roles: NovelRoleKey[];
  credentialConfigured: boolean;
}

export interface ModelRuntimeConfig {
  requestedMode: ModelRuntimeMode;
  activeMode: ModelRuntimeMode;
  strictPlanOnly: true;
  cashFallbackAllowed: false;
  missingCredentials: Array<'coding-plan' | 'agent-plan'>;
  endpoints: {
    coding: ArkPlanEndpointConfig;
    agent: ArkPlanEndpointConfig;
    opencodego: OpencodegoEndpointConfig;
  };
  codex: {
    provider: 'openai-codex-subscription';
    modelId: string;
    executable: string;
    workingDirectory: string;
    timeoutMs: number;
  };
  roleProfiles: Record<NovelRoleKey, RoleModelProfile>;
  publicProfiles: PublicModelProfile[];
}

const DETERMINISTIC_PROFILE: RoleModelProfile = {
  provider: 'local-deterministic',
  modelId: 'wenmi-fixture-v1',
  plan: 'deterministic'
};

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function compatibleAnthropicPlanEndpoint(raw: string | undefined): {
  plan: 'coding' | 'agent';
  baseUrl: string;
} | undefined {
  const configured = firstNonEmpty(raw);
  if (configured === undefined) return undefined;
  for (const plan of ['coding', 'agent'] as const) {
    try {
      return { plan, baseUrl: assertPlanBaseUrl(plan, configured) };
    } catch {
      // Compatibility variables are shared with unrelated applications. They
      // are ignored unless the address is one of Wenmi's exact plan endpoints.
    }
  }
  return undefined;
}

const retiredAgentPlanModelAliases = new Map<string, string>([
  ['kimi-k3', 'kimi-k2.7-code'],
  ['kimi-k2-6-modelhub', 'kimi-k2.7-code'],
  ['glm-5-2-260617', 'glm-5.2'],
  ['doubao-seed-2-0-pro-260215', 'doubao-seed-2.1-turbo']
]);

function currentAgentPlanModelId(value: string | undefined, fallback: string): string {
  const configured = firstNonEmpty(value);
  if (configured === undefined) return fallback;
  return retiredAgentPlanModelAliases.get(configured.toLowerCase()) ?? configured;
}

export const OPENCODEGO_DEFAULT_BASE_URL = 'https://opencode.ai/zen/go';

export function assertOpencodegoBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('只允许 opencodego 端点：地址格式无效');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !(host === 'opencode.ai' || host.endsWith('.opencode.ai') || host.includes('opencodego'))
  ) {
    throw new Error('只允许 opencodego 端点：必须是 https 且主机为 opencode.ai / *.opencode.ai');
  }
  const path = url.pathname.replace(/\/$/u, '');
  if (path.length === 0) throw new Error('只允许 opencodego 端点：缺少路径');
  return `${url.origin}${path}`;
}

export function assertPlanBaseUrl(plan: ModelPlan, raw: string): string {
  if (plan === 'opencodego') return assertOpencodegoBaseUrl(raw);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('只允许火山方舟套餐端点：地址格式无效');
  }
  const expectedPath = plan === 'coding' ? '/api/coding' : '/api/plan';
  const actualPath = url.pathname.replace(/\/$/u, '');
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'ark.cn-beijing.volces.com' ||
    url.port !== '' ||
    actualPath !== expectedPath ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`只允许火山方舟套餐端点：${expectedPath}`);
  }
  return `${url.origin}${expectedPath}`;
}

/**
 * 方舟套餐模型统一启用"有预算的思考"：请求携带
 * thinking={type:'enabled',budget_tokens:4000}，模型在预算内思考后必须产出
 * 可见文字。关闭思考（disabled）被 glm-5.3 与 kimi-k2.7-code 直接拒绝（400），
 * 而不设预算时 minimax/deepseek 等会把全部输出额度烧进思考块（2026-08-18
 * 生产实测六个模型均接受 enabled+budget 且预算生效）。
 * 思考 Token 同时计入 max_tokens 与 usage.output_tokens，因此适配器的
 * max_tokens 与各管线预算冻结都必须在可见输出限额之上追加同一份预算，
 * 否则结算端会以"实际用量超过冻结上限"拒绝。
 */
export const SUBSCRIPTION_THINKING_BUDGET_TOKENS = 4_000;

export function thinkingTokenAllowance(modelId: string): number {
  // 本地确定性夹具不经过真实模型，没有思考开销。
  return modelId === 'wenmi-fixture-v1' ? 0 : SUBSCRIPTION_THINKING_BUDGET_TOKENS;
}

function deterministicProfiles(): Record<NovelRoleKey, RoleModelProfile> {
  return Object.fromEntries(novelRoleKeys.map((role) => [role, { ...DETERMINISTIC_PROFILE }])) as Record<NovelRoleKey, RoleModelProfile>;
}

function defaultCodexExecutable(env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') return 'codex';
  const appData = firstNonEmpty(env.APPDATA);
  if (appData !== undefined) {
    const packageArch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const targetArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const candidate = resolve(
      appData,
      'npm', 'node_modules', '@openai', 'codex', 'node_modules', `@openai/codex-win32-${packageArch}`,
      'vendor', `${targetArch}-pc-windows-msvc`, 'bin', 'codex.exe'
    );
    if (existsSync(candidate)) return candidate;
  }
  return 'codex.cmd';
}

function subscriptionProfiles(env: NodeJS.ProcessEnv): Record<NovelRoleKey, RoleModelProfile> {
  const agentDeepSeekPro: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_DEEPSEEK_MODEL, 'deepseek-v4-pro'),
    plan: 'agent'
  };
  const agentDeepSeekFlash: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_DEEPSEEK_FLASH_MODEL, 'deepseek-v4-flash'),
    plan: 'agent'
  };
  const agentGlm: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_GLM_MODEL, 'glm-5.2'),
    plan: 'agent'
  };
  const agentDoubao: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL, 'doubao-seed-2.1-turbo'),
    plan: 'agent'
  };
  const agentKimiK27: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(
      firstNonEmpty(env.WENMI_ARK_AGENT_PLAN_KIMI_K27_MODEL, env.WENMI_ARK_AGENT_PLAN_KIMI_MODEL), 'kimi-k2.7-code'),
    plan: 'agent'
  };
  const agentMinimax: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_MINIMAX_MODEL, 'minimax-m3'),
    plan: 'agent'
  };
  return {
    chief_editor: { ...agentKimiK27 },
    plot_architect: { ...agentDeepSeekPro },
    continuity: { ...agentGlm },
    writer: { ...agentDeepSeekPro },
    reviewer: { ...agentMinimax },
    reader_experience: { ...agentDoubao },
    style_editor: { ...agentGlm },
    researcher: { ...agentDeepSeekFlash },
    copyright: { ...agentKimiK27 }
  };
}

/**
 * opencodego 模式：角色模型分配与火山方舟 Agent Plan 保持一致（写手/编剧用
 * DeepSeek、审校用 MiniMax、体验用豆包、连续性用 GLM、主编用 Kimi 等），
 * 仅把 provider/baseUrl/apiKey 指向 opencodego，从而通过团队模型多样性校验，
 * 且模型名在 opencodego 与方舟 catalog 同名时可无缝替换。逐角色模型可用
 * `WENMI_OPENCODEGO_*_MODEL` 覆盖，未配置时沿用方舟同款回退值。
 *
 * 2026-08-16 实测 opencode.ai/zen/go 目录不含豆包模型；按"适配不了的不要
 * 变化"，体验席默认继续使用火山方舟 Agent Plan 的豆包配置（需保留
 * WENMI_ARK_AGENT_PLAN_API_KEY）。只有显式设置 WENMI_OPENCODEGO_DOUBAO_MODEL
 * 时才把体验席切到 opencodego。
 */
function opencodegoProfiles(env: NodeJS.ProcessEnv): Record<NovelRoleKey, RoleModelProfile> {
  const profile = (envKey: string, fallback: string): RoleModelProfile => ({
    provider: 'opencodego',
    modelId: currentAgentPlanModelId(env[`WENMI_OPENCODEGO_${envKey}_MODEL`], fallback),
    plan: 'opencodego'
  });
  return {
    chief_editor: profile('KIMI_K27', 'kimi-k2.7-code'),
    plot_architect: profile('DEEPSEEK', 'deepseek-v4-pro'),
    continuity: profile('GLM', 'glm-5.2'),
    writer: profile('DEEPSEEK', 'deepseek-v4-pro'),
    reviewer: profile('MINIMAX', 'minimax-m3'),
    reader_experience: firstNonEmpty(env.WENMI_OPENCODEGO_DOUBAO_MODEL) !== undefined
      ? profile('DOUBAO', 'doubao-seed-2.1-turbo')
      : subscriptionProfiles(env).reader_experience,
    style_editor: profile('GLM', 'glm-5.2'),
    researcher: profile('DEEPSEEK_FLASH', 'deepseek-v4-flash'),
    copyright: profile('KIMI_K27', 'kimi-k2.7-code')
  };
}

function toPublicProfiles(
  profiles: Record<NovelRoleKey, RoleModelProfile>,
  endpoints: ModelRuntimeConfig['endpoints']
): PublicModelProfile[] {
  const grouped = new Map<string, PublicModelProfile>();
  for (const role of novelRoleKeys) {
    const profile = profiles[role];
    const key = `${profile.plan}\n${profile.provider}\n${profile.modelId}`;
    const existing = grouped.get(key);
    if (existing !== undefined) {
      existing.roles.push(role);
      continue;
    }
    grouped.set(key, {
      ...profile,
      roles: [role],
      credentialConfigured: profile.plan === 'deterministic' || profile.plan === 'codex' || endpoints[profile.plan].apiKey !== undefined
    });
  }
  return [...grouped.values()];
}

export function loadModelRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { codexWorkingDirectory?: string } = {}
): ModelRuntimeConfig {
  const compatibleEndpoint = compatibleAnthropicPlanEndpoint(env.ANTHROPIC_BASE_URL);
  const compatibleToken = firstNonEmpty(env.ANTHROPIC_AUTH_TOKEN);
  const codingKey = firstNonEmpty(
    env.WENMI_ARK_CODING_PLAN_API_KEY,
    compatibleEndpoint?.plan === 'coding' ? compatibleToken : undefined
  );
  const agentKey = firstNonEmpty(
    env.WENMI_ARK_AGENT_PLAN_API_KEY,
    env.ARK_AGENTPLAN_KEY,
    compatibleEndpoint?.plan === 'agent' ? compatibleToken : undefined
  );
  const opencodegoKey = firstNonEmpty(env.WENMI_OPENCODEGO_API_KEY);
  const opencodegoActive = opencodegoKey !== undefined;
  const rawMode = firstNonEmpty(env.WENMI_MODEL_MODE)
    ?? (agentKey === undefined && !opencodegoActive ? 'deterministic' : 'subscription-plan');
  if (rawMode !== 'deterministic' && rawMode !== 'subscription-plan') {
    throw new Error('WENMI_MODEL_MODE只允许deterministic或subscription-plan');
  }
  const requestedMode = rawMode;
  const endpoints: ModelRuntimeConfig['endpoints'] = {
    coding: {
      plan: 'coding',
      provider: 'volcengine-ark-coding-plan',
      baseUrl: assertPlanBaseUrl(
        'coding',
        firstNonEmpty(
          env.WENMI_ARK_CODING_PLAN_BASE_URL,
          compatibleEndpoint?.plan === 'coding' ? compatibleEndpoint.baseUrl : undefined
        ) ?? 'https://ark.cn-beijing.volces.com/api/coding'
      ),
      apiKey: codingKey
    },
    agent: {
      plan: 'agent',
      provider: 'volcengine-ark-agent-plan',
      baseUrl: assertPlanBaseUrl(
        'agent',
        firstNonEmpty(
          env.WENMI_ARK_AGENT_PLAN_BASE_URL,
          env.ARK_AGENTPLAN_BASE_URL,
          compatibleEndpoint?.plan === 'agent' ? compatibleEndpoint.baseUrl : undefined
        ) ?? 'https://ark.cn-beijing.volces.com/api/plan'
      ),
      apiKey: agentKey
    },
    opencodego: {
      plan: 'opencodego',
      provider: 'opencodego',
      baseUrl: assertOpencodegoBaseUrl(
        firstNonEmpty(env.WENMI_OPENCODEGO_BASE_URL) ?? OPENCODEGO_DEFAULT_BASE_URL
      ),
      apiKey: opencodegoKey,
      modelId: currentAgentPlanModelId(env.WENMI_OPENCODEGO_MODEL, 'deepseek-v4-flash')
    }
  };
  const missingCredentials: ModelRuntimeConfig['missingCredentials'] = [];
  // opencodego 激活时不再要求方舟 Agent Plan 凭证；两者皆缺才报 agent-plan 缺失。
  if (!opencodegoActive && agentKey === undefined) missingCredentials.push('agent-plan');
  const activeMode: ModelRuntimeMode = requestedMode === 'subscription-plan' && missingCredentials.length === 0 ? 'subscription-plan' : 'deterministic';
  const roleProfiles = activeMode === 'subscription-plan'
    ? opencodegoActive ? opencodegoProfiles(env) : subscriptionProfiles(env)
    : deterministicProfiles();
  const codexTimeout = Number(firstNonEmpty(env.WENMI_CODEX_TIMEOUT_MS) ?? '900000');
  if (!Number.isInteger(codexTimeout) || codexTimeout < 30_000 || codexTimeout > 900_000) {
    throw new Error('WENMI_CODEX_TIMEOUT_MS必须在30000至900000之间');
  }
  const codex = {
    provider: 'openai-codex-subscription' as const,
    modelId: firstNonEmpty(env.WENMI_CODEX_MODEL) ?? 'gpt-5.6-sol',
    executable: firstNonEmpty(env.WENMI_CODEX_EXECUTABLE) ?? defaultCodexExecutable(env),
    workingDirectory: resolve(options.codexWorkingDirectory ?? process.cwd()),
    timeoutMs: codexTimeout
  };
  return {
    requestedMode,
    activeMode,
    strictPlanOnly: true,
    cashFallbackAllowed: false,
    missingCredentials,
    endpoints,
    codex,
    roleProfiles,
    publicProfiles: toPublicProfiles(roleProfiles, endpoints)
  };
}
