import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { V7_TEXT_MODEL_PROFILE_KEYS, modelBindingForProfile } from '@wenmi/v7-backend';

const releaseId = process.env.WENMI_RELEASE_ID
  ?? readFileSync(resolve(process.cwd(), 'RELEASE_ID'), 'utf8').trim();
const config = loadModelRuntimeConfig(process.env);
const transport = 'bound-plan';

if (config.requestedMode !== 'subscription-plan' || config.activeMode !== 'subscription-plan') {
  throw new Error(`真实连通验证要求subscription-plan；当前requested=${config.requestedMode}, active=${config.activeMode}, missing=${config.missingCredentials.join(',') || 'none'}`);
}
if (config.strictPlanOnly !== true || config.cashFallbackAllowed !== false) {
  throw new Error('真实连通验证拒绝非严格套餐模式或任何现金回退');
}

const requestedProfiles = new Set((process.env.WENMI_CONNECTIVITY_PROFILES ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const probes = requestedProfiles.size === 0
  ? [...V7_TEXT_MODEL_PROFILE_KEYS]
  : V7_TEXT_MODEL_PROFILE_KEYS.filter((profileKey) => requestedProfiles.has(profileKey));
if (probes.length === 0) throw new Error('WENMI_CONNECTIVITY_PROFILES没有匹配任何 V7 模型档案');

const factory = new ModelAdapterFactory(config);
const maxOutputTokens = Number(process.env.WENMI_CONNECTIVITY_MAX_OUTPUT_TOKENS ?? '256');
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 1024) {
  throw new Error('WENMI_CONNECTIVITY_MAX_OUTPUT_TOKENS必须是64至1024之间的整数');
}
const evidence: Array<Record<string, unknown>> = [];
for (const [index, profileKey] of probes.entries()) {
  const profile = modelBindingForProfile(profileKey);
  const label = `${profileKey} · ${profile.modelId}`;
  const adapter = factory.resolve(profile.provider, profile.modelId, 'discussion');
  const startedAt = new Date();
  const result = await adapter.generate({
    requestId: `connectivity-${index + 1}`,
    taskId: `connectivity-${releaseId}`,
    ownerId: 'runtime-verification',
    bookId: 'runtime-verification',
    agentId: profileKey,
    prompt: '这是文秘写作的零现金套餐连通性检查。只回复：连通。不要解释，不要执行任何工具。',
    maxOutputTokens
  });
  if (result.state !== 'succeeded' || result.output.trim().length === 0) throw new Error(`${label}没有返回有效文字`);
  if (result.cashCostCny !== 0) throw new Error(`${label}报告了非零现金成本，验证立即停止`);
  const finishedAt = new Date();
  const record = {
    label,
    profileKey,
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
