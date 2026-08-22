import { createHash } from 'node:crypto';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { editorialRoleKeys, type EditorialRoleKey } from '@wenmi/contracts';

const releaseId = process.env.WENMI_RELEASE_ID ?? 'wm-longform-r1-20260719-003435-e4d7b8b7';
const config = loadModelRuntimeConfig(process.env, { codexWorkingDirectory: process.cwd() });
const transport = process.env.WENMI_CONNECTIVITY_TRANSPORT ?? 'bound-plan';
if (transport !== 'bound-plan' && transport !== 'codex') throw new Error('WENMI_CONNECTIVITY_TRANSPORT只允许bound-plan或codex');
const useCodex = transport === 'codex';
const runtimeConfig = useCodex
  ? { ...config, requestedMode: 'subscription-plan' as const, activeMode: 'subscription-plan' as const }
  : config;

if (!useCodex && (config.requestedMode !== 'subscription-plan' || config.activeMode !== 'subscription-plan')) {
  throw new Error(`真实连通验证要求subscription-plan；当前requested=${config.requestedMode}, active=${config.activeMode}, missing=${config.missingCredentials.join(',') || 'none'}`);
}
if (config.strictPlanOnly !== true || config.cashFallbackAllowed !== false) {
  throw new Error('真实连通验证拒绝非严格套餐模式或任何现金回退');
}

const allProbes: Array<{ roleKey: EditorialRoleKey }> = editorialRoleKeys.map((roleKey) => ({ roleKey }));
const requestedRoles = new Set((process.env.WENMI_CONNECTIVITY_ROLES ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const probes = requestedRoles.size === 0 ? allProbes : allProbes.filter((probe) => requestedRoles.has(probe.roleKey));
if (probes.length === 0) throw new Error('WENMI_CONNECTIVITY_ROLES没有匹配任何允许的探针岗位');

const factory = new ModelAdapterFactory(runtimeConfig);
const maxOutputTokens = Number(process.env.WENMI_CONNECTIVITY_MAX_OUTPUT_TOKENS ?? '256');
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 1024) {
  throw new Error('WENMI_CONNECTIVITY_MAX_OUTPUT_TOKENS必须是64至1024之间的整数');
}
const evidence: Array<Record<string, unknown>> = [];
for (const [index, probe] of probes.entries()) {
  const legacyRole = legacyRoleFor(probe.roleKey);
  const profile = config.roleProfiles[legacyRole];
  const provider = useCodex ? runtimeConfig.codex.provider : profile.provider;
  const modelId = useCodex ? runtimeConfig.codex.modelId : profile.modelId;
  const label = `${probe.roleKey} · ${modelId}`;
  const adapter = factory.resolve(provider, modelId, 'discussion', legacyRole);
  const startedAt = new Date();
  const result = await adapter.generate({
    requestId: `connectivity-${index + 1}`,
    taskId: `connectivity-${releaseId}`,
    ownerId: 'runtime-verification',
    bookId: 'runtime-verification',
    agentId: probe.roleKey,
    prompt: '这是文秘写作的零现金套餐连通性检查。只回复：连通。不要解释，不要执行任何工具。',
    maxOutputTokens
  });
  if (result.state !== 'succeeded' || result.output.trim().length === 0) throw new Error(`${label}没有返回有效文字`);
  if (result.cashCostCny !== 0) throw new Error(`${label}报告了非零现金成本，验证立即停止`);
  const finishedAt = new Date();
  const record = {
    label,
    roleKey: probe.roleKey,
    provider: result.provider,
    modelId: result.modelId,
    state: result.state,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cashCostCny: result.cashCostCny,
    outputCharacters: [...result.output].length,
    outputSha256: createHash('sha256').update(result.output).digest('hex'),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime()
  };
  evidence.push(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

process.stdout.write(`${JSON.stringify({
  releaseId,
  transport,
  boundPlanMissingCredentials: config.missingCredentials,
  strictPlanOnly: config.strictPlanOnly,
  cashFallbackAllowed: config.cashFallbackAllowed,
  passed: evidence.length === probes.length,
  probeCount: evidence.length
})}\n`);

function legacyRoleFor(roleKey: EditorialRoleKey): keyof typeof config.roleProfiles {
  const roles: Record<EditorialRoleKey, keyof typeof config.roleProfiles> = {
    chief_editor: 'chief_editor',
    deputy_editor: 'chief_editor',
    screenwriter: 'plot_architect',
    writer: 'writer',
    fact_reviewer: 'continuity',
    literary_reviewer: 'reviewer',
    experience_reviewer: 'reader_experience'
  };
  return roles[roleKey];
}
