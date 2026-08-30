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
export type ModelPlan = 'deterministic' | 'coding' | 'agent';
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
  roleProfiles: Record<NovelRoleKey, RoleModelProfile>;
  publicProfiles: PublicModelProfile[];
}

const DETERMINISTIC_PROFILE: RoleModelProfile = {
  provider: 'local-deterministic',
  modelId: 'wenmi-fixture-v1',
  plan: 'deterministic'
};

/**
 * 可由后台分配、但不默认绑定任何岗位的套餐模型。
 * 目录必须独立于 roleProfiles，否则“暂时不使用”会被误实现成“无法配置”。
 */
export const additionalConfigurablePlanProfiles = [
  { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding' },
  { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-flash', plan: 'coding' },
  { provider: 'volcengine-ark-coding-plan', modelId: 'kimi-k2.7-code', plan: 'coding' },
  { provider: 'volcengine-ark-coding-plan', modelId: 'doubao-seed-2.1-turbo', plan: 'coding' },
  { provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.2', plan: 'coding' },
  { provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.3', plan: 'coding' },
  { provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent' },
  { provider: 'volcengine-ark-agent-plan', modelId: 'minimax-m3', plan: 'agent' }
] as const satisfies readonly RoleModelProfile[];

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

function currentPlanModelId(value: string | undefined, fallback: string): string {
  const configured = firstNonEmpty(value);
  if (configured === undefined) return fallback;
  return retiredAgentPlanModelAliases.get(configured.toLowerCase()) ?? configured;
}

export function assertPlanBaseUrl(plan: Extract<ModelPlan, 'coding' | 'agent'>, raw: string): string {
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
 * 方舟套餐模型按模型和用途配置思考：创作性正文保留显式思考；
 * MiniMax关闭思考；GLM-5.3短讨论、结构化规划和证据型审校省略thinking字段，并只追加1k默认推理余量。
 * GLM的disabled会被当前Coding Plan端点拒绝，不能用“关闭思考”实现提速。
 *
 * 思考或默认推理 Token 同时计入 max_tokens 与 usage.output_tokens，因此适配器的
 * max_tokens 与各管线预算冻结必须追加相同余量；可见输出仍由各管线合同封顶。
 * 复杂任务保持宽松上限，短任务只使用生产实测能快速形成可见文字的最小余量。
 */
export const SUBSCRIPTION_THINKING_BUDGET_TOKENS = 16_000;
export const GLM_VISIBLE_OUTPUT_REASONING_HEADROOM_TOKENS = 1_000;
// 2026-08-29 real V7 manuscript evidence: Kimi K3 spent 19,786 output tokens
// and 573 seconds on a 3k-character chapter when given the generic 16k thinking
// allowance. Earlier accepted chapters completed with roughly 12k total output.
// Keep substantial creative reasoning, but do not let hidden thought dominate a
// bounded single-chapter task. Review, planning and other models retain their
// independently verified budgets.
export const KIMI_NOVEL_WRITER_THINKING_BUDGET_TOKENS = 8_000;
// Chapter review is a bounded evidence comparison, not an open-ended creative
// task. Even a 4k hidden-reasoning allowance consumed the complete 6.4k output
// window and returned no report. Kimi K3 therefore reviews with thinking off;
// the bounded evidence contract provides the deliberation scope.
export const KIMI_NOVEL_REVIEWER_THINKING_BUDGET_TOKENS = 0;

export function usesGlmVisibleOutputRoute(
  modelId: string,
  purpose?: ModelPurpose,
  maxOutputTokens?: number
): boolean {
  if (!modelId.startsWith('glm-5.3')) return false;
  if (purpose === 'structured_planning') return true;
  if (purpose === 'novel_reviewer' || purpose === 'review_synthesis') return true;
  return purpose === 'discussion' && maxOutputTokens !== undefined && maxOutputTokens <= 3_000;
}

export function thinkingTokenAllowance(
  modelId: string,
  purpose?: ModelPurpose,
  maxOutputTokens?: number
): number {
  // 本地确定性夹具不经过真实模型，没有思考开销。
  if (modelId === 'wenmi-fixture-v1') return 0;
  // MiniMax M3 在任何用途下都关闭思考（预算对它不生效，会把全部额度烧进思考块），
  // max_tokens 与预算冻结都不追加思考余量。
  if (modelId.startsWith('minimax-')) return 0;
  // 2026-08-22 生产证据：GLM-5.3 的短设定方案显式开启8k思考后连续三次
  // 把总共11k输出额度全部烧进thinking并返回空text，单次约四分钟；同端点省略
  // thinking字段时17秒内以799 Token正常结束。2026-08-29 的真实卷方案又证明：
  // structured_planning 显式16k思考会把31k总额度全部耗尽，形成87414字符思考但
  // 零可见方案。短讨论和结构化规划因此统一走直出路由，只保留1k默认推理余量；
  // 证据型审校也是有停止条件的结构化任务：2026-08-29 第8章实测
  // 显式16k思考让GLM为1413字符报告消耐10945输出Token并耗时145秒。
  // 因此审校同样走直出路由；创作性正文仍保留独立思考预算。
  if (usesGlmVisibleOutputRoute(modelId, purpose, maxOutputTokens)) {
    return GLM_VISIBLE_OUTPUT_REASONING_HEADROOM_TOKENS;
  }
  // 5k以内的结构化规划用于单元链等有限范围节点。真实 DeepSeek 链方案
  // 即使声明4k思考仍上报20,939输出Token并耗时249秒，端点未可靠遵守预算。
  // 这类节点改为直出合同；全书、卷和较大章纲仍保留有限规划思考。
  if (purpose === 'structured_planning' && maxOutputTokens !== undefined && maxOutputTokens <= 5_000) {
    return 0;
  }
  // 结构修复和证据审校都是有明确停止条件的封闭任务。DeepSeek 在这里
  // 开启通用 16k 思考，会为补几个 JSON 字段再次推演整份方案；真实链方案
  // 已出现 9k 以上输出 Token 的无效结构修复。关闭隐藏思考，直接按合同返回。
  if (modelId.startsWith('deepseek-')
    && (purpose === 'novel_reviewer' || purpose === 'review_synthesis')) {
    return 0;
  }
  // 规划需要推理，但不是无限推演。4k 足够完成当前一层的因果取舍，避免
  // 通用 16k 思考吞掉时间和额度；可见方案仍由各节点自己的输出合同封顶。
  if (purpose === 'structured_planning') return 4_000;
  if (modelId === 'kimi-k3' && purpose === 'novel_writer') {
    return KIMI_NOVEL_WRITER_THINKING_BUDGET_TOKENS;
  }
  if (modelId === 'kimi-k3' && purpose === 'novel_reviewer') {
    return KIMI_NOVEL_REVIEWER_THINKING_BUDGET_TOKENS;
  }
  return SUBSCRIPTION_THINKING_BUDGET_TOKENS;
}

function deterministicProfiles(): Record<NovelRoleKey, RoleModelProfile> {
  return Object.fromEntries(novelRoleKeys.map((role) => [role, { ...DETERMINISTIC_PROFILE }])) as Record<NovelRoleKey, RoleModelProfile>;
}

function codingPlanProfiles(env: NodeJS.ProcessEnv): Record<NovelRoleKey, RoleModelProfile> {
  const codingProfile = (envKey: string, fallback: string): RoleModelProfile => {
    const modelId = currentPlanModelId(env['WENMI_ARK_CODING_PLAN_' + envKey + '_MODEL'], fallback);
    return {
      provider: 'volcengine-ark-coding-plan',
      modelId,
      plan: 'coding'
    };
  };
  const deepSeekPro = codingProfile('DEEPSEEK', 'deepseek-v4-pro');
  const deepSeekFlash = codingProfile('DEEPSEEK_FLASH', 'deepseek-v4-flash');
  const doubao = codingProfile('DOUBAO', 'doubao-seed-2.1-turbo');
  const kimiK27: RoleModelProfile = {
    provider: 'volcengine-ark-coding-plan',
    modelId: currentPlanModelId(
      firstNonEmpty(env.WENMI_ARK_CODING_PLAN_KIMI_K27_MODEL, env.WENMI_ARK_CODING_PLAN_KIMI_MODEL),
      'kimi-k2.7-code'
    ),
    plan: 'coding'
  };
  return {
    chief_editor: { ...deepSeekPro },
    plot_architect: { ...deepSeekPro },
    continuity: { ...doubao },
    writer: { ...deepSeekPro },
    reviewer: { ...kimiK27 },
    reader_experience: { ...doubao },
    style_editor: { ...deepSeekFlash },
    researcher: { ...deepSeekFlash },
    copyright: { ...kimiK27 }
  };
}
function toPublicProfiles(
  profiles: Record<NovelRoleKey, RoleModelProfile>,
  endpoints: ModelRuntimeConfig['endpoints']
): PublicModelProfile[] {
  const grouped = new Map<string, PublicModelProfile>();
  const register = (profile: RoleModelProfile, role?: NovelRoleKey): void => {
    const key = `${profile.plan}\n${profile.provider}\n${profile.modelId}`;
    const existing = grouped.get(key);
    if (existing !== undefined) {
      if (role !== undefined && !existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    grouped.set(key, {
      ...profile,
      roles: role === undefined ? [] : [role],
      credentialConfigured: profile.plan === 'deterministic'
        || endpoints[profile.plan].apiKey !== undefined
    });
  };
  for (const role of novelRoleKeys) register(profiles[role], role);
  for (const profile of additionalConfigurablePlanProfiles) register(profile);
  return [...grouped.values()];
}

export function loadModelRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
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
  const rawMode = firstNonEmpty(env.WENMI_MODEL_MODE)
    ?? (codingKey === undefined && agentKey === undefined ? 'deterministic' : 'subscription-plan');
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
    }
  };
  const missingCredentials: ModelRuntimeConfig['missingCredentials'] = [];
  if (codingKey === undefined) missingCredentials.push('coding-plan');
  if (agentKey === undefined) missingCredentials.push('agent-plan');
  // Coding Plan 承担全部常规岗位；只要它可用，常规创作即可运行。
  // Agent Plan 只服务作者主动选择的高级编剧 Kimi K3，缺失时由席位可用性单独禁用。
  const activeMode: ModelRuntimeMode = requestedMode === 'subscription-plan' && codingKey !== undefined
    ? 'subscription-plan'
    : 'deterministic';
  const roleProfiles = activeMode === 'subscription-plan'
    ? codingPlanProfiles(env)
    : deterministicProfiles();
  return {
    requestedMode,
    activeMode,
    strictPlanOnly: true,
    cashFallbackAllowed: false,
    missingCredentials,
    endpoints,
    roleProfiles,
    publicProfiles: toPublicProfiles(roleProfiles, endpoints)
  };
}
