import { createHash } from 'node:crypto';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { CreativeRoleKey } from '../../apps/api/src/contracts/agent-team-v2.js';

const releaseId = process.env.WENMI_RELEASE_ID ?? 'wm-longform-r1-20260719-003435-e4d7b8b7';
const config = loadModelRuntimeConfig(process.env, { codexWorkingDirectory: process.cwd() });

if (config.requestedMode !== 'subscription-plan' || config.activeMode !== 'subscription-plan') {
  throw new Error(`真实连通验证要求subscription-plan；当前requested=${config.requestedMode}, active=${config.activeMode}, missing=${config.missingCredentials.join(',') || 'none'}`);
}
if (config.strictPlanOnly !== true || config.cashFallbackAllowed !== false) {
  throw new Error('真实连通验证拒绝非严格套餐模式或任何现金回退');
}

const allProbes: Array<{ roleKey: CreativeRoleKey; label: string }> = [
  { roleKey: 'chief_editor', label: 'Codex GPT-5.6 主编' },
  { roleKey: 'lead_screenwriter', label: 'DeepSeek 编剧' },
  { roleKey: 'setting', label: 'GLM 设定' },
  { roleKey: 'literary_reviewer', label: 'Kimi 审校' },
  { roleKey: 'experience_reviewer', label: '豆包体验' }
];
const requestedRoles = new Set((process.env.WENMI_CONNECTIVITY_ROLES ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const probes = requestedRoles.size === 0 ? allProbes : allProbes.filter((probe) => requestedRoles.has(probe.roleKey));
if (probes.length === 0) throw new Error('WENMI_CONNECTIVITY_ROLES没有匹配任何允许的探针岗位');

const factory = new ModelAdapterFactory(config);
const evidence: Array<Record<string, unknown>> = [];
for (const [index, probe] of probes.entries()) {
  const legacyRole = legacyRoleFor(probe.roleKey);
  const profile = config.roleProfiles[legacyRole];
  const adapter = factory.resolve(profile.provider, profile.modelId, 'discussion', probe.roleKey);
  const startedAt = new Date();
  const result = await adapter.generate({
    requestId: `connectivity-${index + 1}`,
    taskId: `connectivity-${releaseId}`,
    ownerId: 'runtime-verification',
    bookId: 'runtime-verification',
    agentId: probe.roleKey,
    prompt: '这是文秘写作的零现金套餐连通性检查。只回复：连通。不要解释，不要执行任何工具。',
    maxOutputTokens: 24
  });
  if (result.state !== 'succeeded' || result.output.trim().length === 0) throw new Error(`${probe.label}没有返回有效文字`);
  if (result.cashCostCny !== 0) throw new Error(`${probe.label}报告了非零现金成本，验证立即停止`);
  const finishedAt = new Date();
  const record = {
    label: probe.label,
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
  strictPlanOnly: config.strictPlanOnly,
  cashFallbackAllowed: config.cashFallbackAllowed,
  passed: evidence.length === probes.length,
  probeCount: evidence.length
})}\n`);

function legacyRoleFor(roleKey: CreativeRoleKey): keyof typeof config.roleProfiles {
  const roles: Record<CreativeRoleKey, keyof typeof config.roleProfiles> = {
    chief_editor: 'chief_editor',
    deputy_editor: 'chief_editor',
    lead_screenwriter: 'plot_architect',
    second_screenwriter: 'plot_architect',
    setting: 'continuity',
    lead_writer: 'writer',
    backup_writer: 'writer',
    literary_reviewer: 'reviewer',
    experience_reviewer: 'reader_experience',
    researcher: 'researcher',
    copyright: 'copyright'
  };
  return roles[roleKey];
}
