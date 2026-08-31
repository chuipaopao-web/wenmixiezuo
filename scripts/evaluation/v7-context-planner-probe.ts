import { createHash } from 'node:crypto';
import {
  modelBindingForProfile,
  parsePlanningMethodSearchRequest,
  planningMethodSearchPrompt,
  retrievePlanningMethodCandidates
} from '@wenmi/v7-backend';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

const config = loadModelRuntimeConfig(process.env);
if (config.requestedMode !== 'subscription-plan' || config.activeMode !== 'subscription-plan') {
  throw new Error(`资料策划真实探针要求subscription-plan；当前requested=${config.requestedMode}, active=${config.activeMode}`);
}
if (!config.strictPlanOnly || config.cashFallbackAllowed) throw new Error('资料策划真实探针禁止现金回退');

// Production's structured-output roster places direct-output models before
// GLM 5.3 because GLM can spend a bounded allowance entirely on hidden
// thinking. The environment override remains available for diagnostic probes.
const profileKey = process.env.WENMI_CONTEXT_PROBE_PROFILE?.trim() || 'deepseek-v4-pro';
const profile = modelBindingForProfile(profileKey);
const adapter = new ModelAdapterFactory(config).resolve(profile.provider, profile.modelId, 'structured_planning');
const prompt = planningMethodSearchPrompt({
  seatName: '单元链资料策划',
  seatResponsibility: '为当前历史军营求生链选择最小充分资料、准确方法范围、任务期融合题材身份和创意边界。',
  independentFocus: [
    '主角必须依据当前身份和资源主动解决问题',
    '只选择会改变当前链设计的正式设定',
    '候选方法可以组合、忽略或由执行成员完全原创'
  ],
  allowedPlanningLayers: ['chain'],
  sourceSnapshot: {
    treeKind: 'chain',
    scopeId: 'probe-chain-1',
    sources: [
      { sourceKind: 'opening', sourceId: 'probe-opening-v1', label: '开书资料', content: { genres: ['历史', '生存'], protagonist: '张三', direction: '从流民到小队核心' } },
      { sourceKind: 'setting', sourceId: 'probe-setting-army-v3', label: '军营规则', content: { schema: 'v7-setting-fact-source-v1', contextSummary: '先锋营缺粮，军功与连坐并存。', facts: ['张三是无军职流民', '老兵掌握生存规矩'] } },
      { sourceKind: 'setting', sourceId: 'probe-setting-romance-v2', label: '远期感情线', content: { schema: 'v7-setting-fact-source-v1', contextSummary: '第三卷以后才进入。', facts: ['当前链人物尚未登场'] } },
      { sourceKind: 'confirmed_tree', sourceId: 'probe-volume-tree-v1', label: '已确认本卷方向', content: { responsibility: '让张三在先锋营站住脚，被老兵接纳。' } }
    ]
  }
});

const startedAt = new Date();
const result = await adapter.generate({
  requestId: `v7-context-probe-${startedAt.toISOString()}`,
  taskId: 'v7-context-orchestration-69',
  ownerId: 'runtime-verification',
  bookId: 'runtime-verification',
  agentId: 'context-editor-probe',
  prompt,
  maxOutputTokens: 2_500,
  temperature: 0.18
});
if (result.state !== 'succeeded' || result.output.trim().length === 0) throw new Error('资料策划真实探针没有返回有效内容');
if (result.cashCostCny !== 0) throw new Error('资料策划真实探针报告非零现金成本，验证停止');

const request = parsePlanningMethodSearchRequest(result.output, { requireTaskProfile: true });
if (request.planningLayers.some((layer) => layer !== 'chain')) throw new Error('资料策划真实探针发生层级越界');
if (request.relevantSettingSourceIds.some((sourceId) => !['probe-setting-army-v3', 'probe-setting-romance-v2'].includes(sourceId))) {
  throw new Error('资料策划真实探针把非逐项设定来源写入了相关设定列表');
}
if (!request.relevantSettingSourceIds.includes('probe-setting-army-v3')) throw new Error('资料策划真实探针没有选择当前链必要军营设定');
if (request.relevantSettingSourceIds.includes('probe-setting-romance-v2')) throw new Error('资料策划真实探针把远期无关感情资料注入当前链');
const retrieval = retrievePlanningMethodCandidates(request);
const finishedAt = new Date();
process.stdout.write(`${JSON.stringify({
  profileKey,
  provider: result.provider,
  modelId: result.modelId,
  state: result.state,
  cashCostCny: result.cashCostCny,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  outputCharacters: Array.from(result.output).length,
  outputSha256: createHash('sha256').update(result.output).digest('hex'),
  selectedSettingCount: request.relevantSettingSourceIds.length,
  methodCandidateCount: retrieval.candidates.length,
  taskPersonaLabel: request.taskPersona?.publicLabel ?? null,
  responsibilityCount: request.taskResponsibilities?.length ?? 0,
  creativeSpaceCount: request.creativeSpace?.length ?? 0,
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  passed: true
})}\n`);
