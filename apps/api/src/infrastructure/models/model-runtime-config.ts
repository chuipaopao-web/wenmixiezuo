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
export type ModelPlan = 'deterministic' | 'codex' | 'coding' | 'agent';
export type ModelPurpose = 'discussion' | 'novel_writer' | 'novel_reviewer' | 'review_synthesis';

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

const retiredAgentPlanModelAliases = new Map<string, string>([
  ['kimi-k2-6-modelhub', 'kimi-k3'],
  ['glm-5-2-260617', 'glm-5.2'],
  ['doubao-seed-2-0-pro-260215', 'doubao-seed-2.1-turbo']
]);

function currentAgentPlanModelId(value: string | undefined, fallback: string): string {
  const configured = firstNonEmpty(value);
  if (configured === undefined) return fallback;
  return retiredAgentPlanModelAliases.get(configured.toLowerCase()) ?? configured;
}

export function assertPlanBaseUrl(plan: 'coding' | 'agent', raw: string): string {
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
  const agentKimiK3: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_KIMI_MODEL, 'kimi-k3'),
    plan: 'agent'
  };
  const agentKimiK27: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_KIMI_K27_MODEL, 'kimi-k2.7-code'),
    plan: 'agent'
  };
  const agentMinimax: RoleModelProfile = {
    provider: 'volcengine-ark-agent-plan',
    modelId: currentAgentPlanModelId(env.WENMI_ARK_AGENT_PLAN_MINIMAX_MODEL, 'minimax-m3'),
    plan: 'agent'
  };
  return {
    chief_editor: { ...agentKimiK3 },
    plot_architect: { ...agentDeepSeekPro },
    continuity: { ...agentGlm },
    writer: { ...agentDeepSeekPro },
    reviewer: { ...agentMinimax },
    reader_experience: { ...agentDoubao },
    style_editor: { ...agentKimiK27 },
    researcher: { ...agentDeepSeekFlash },
    copyright: { ...agentKimiK27 }
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
  const rawMode = firstNonEmpty(env.WENMI_MODEL_MODE) ?? 'deterministic';
  if (rawMode !== 'deterministic' && rawMode !== 'subscription-plan') {
    throw new Error('WENMI_MODEL_MODE只允许deterministic或subscription-plan');
  }
  const requestedMode = rawMode;
  const codingKey = firstNonEmpty(env.WENMI_ARK_CODING_PLAN_API_KEY, env.ANTHROPIC_AUTH_TOKEN);
  const agentKey = firstNonEmpty(env.WENMI_ARK_AGENT_PLAN_API_KEY, env.ARK_AGENTPLAN_KEY);
  const endpoints: ModelRuntimeConfig['endpoints'] = {
    coding: {
      plan: 'coding',
      provider: 'volcengine-ark-coding-plan',
      baseUrl: assertPlanBaseUrl('coding', firstNonEmpty(env.WENMI_ARK_CODING_PLAN_BASE_URL) ?? 'https://ark.cn-beijing.volces.com/api/coding'),
      apiKey: codingKey
    },
    agent: {
      plan: 'agent',
      provider: 'volcengine-ark-agent-plan',
      baseUrl: assertPlanBaseUrl('agent', firstNonEmpty(env.WENMI_ARK_AGENT_PLAN_BASE_URL, env.ARK_AGENTPLAN_BASE_URL) ?? 'https://ark.cn-beijing.volces.com/api/plan'),
      apiKey: agentKey
    }
  };
  const missingCredentials: ModelRuntimeConfig['missingCredentials'] = [];
  if (agentKey === undefined) missingCredentials.push('agent-plan');
  const activeMode: ModelRuntimeMode = requestedMode === 'subscription-plan' && missingCredentials.length === 0 ? 'subscription-plan' : 'deterministic';
  const roleProfiles = activeMode === 'subscription-plan' ? subscriptionProfiles(env) : deterministicProfiles();
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
