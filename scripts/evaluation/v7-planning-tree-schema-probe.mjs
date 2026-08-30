import { ArkPlanModelAdapter } from '../../apps/api/dist/infrastructure/models/ark-plan-model.js';
import { loadModelRuntimeConfig } from '../../apps/api/dist/infrastructure/models/model-runtime-config.js';
import {
  compilePlanningTreeGenerationTask,
  parsePlanningTreeOutput,
  planningTreeGenerationPrompt
} from '../../coauthoring-v7/backend/dist/index.js';

const scopeId = 'probe-chain-1';
const sourceRefs = [
  { sourceKind: 'opening', sourceId: 'probe-opening-v1', version: '1' },
  { sourceKind: 'setting', sourceId: 'probe-setting-v1', version: '1' },
  { sourceKind: 'confirmed_tree', sourceId: 'probe-volume-v1', version: '1' }
];
const layeredTask = {
  schema: 'v7-layered-planning-task-v1',
  mode: 'runtime',
  recipeId: 'probe-recipe',
  recipeVersion: 1,
  nodeId: scopeId,
  layer: 'chain',
  layerName: '单元链',
  sourceRefs: sourceRefs.map((item) => ({ sourceId: item.sourceId, version: item.version, kind: 'formal' })),
  mustHold: ['主角必须是张三', '北宋写实历史，不使用系统和超凡力量'],
  currentObjectives: ['用4至8章完成一次明确回报：张三带小队在伏击中活下来并获得初步信任'],
  methodHints: [{ title: '期待—阻力—升级—兑现', explanation: '让单元链有明确回报。', adaptationNote: '允许改变具体战术和配角行动。' }],
  experienceTargets: [{
    layer: 'chain', layerName: '单元链', title: '首次带队求生',
    publicSummary: '紧张求生后得到可信任的小队。', pressureRhythm: '压力逐步抬高。',
    payoffCadence: '链末兑现第一次带队成功。', informationRhythm: '只揭示当前伏击所需信息。'
  }],
  creativeSpace: ['可以自由设计伏击地点、敌手和同伴选择'],
  expectedOutput: ['事件前后因果闭合', '情绪与回报位置清楚'],
  deviationPolicy: ['不得把未来规划写成已经发生', '若改变父层方向只提建议']
};
const generationTask = compilePlanningTreeGenerationTask({
  treeKind: 'chain', scopeId, sourceRefs,
  parentDirection: '本卷要求张三从无名小卒变成被同伴信任的伍长候选。'
});
const prompt = planningTreeGenerationPrompt({
  treeKind: 'chain', scopeId, layeredTask, generationTask,
  sourceSnapshot: {
    sources: [
      { authority: 'formal', label: '开书资料', content: { protagonist: '张三', era: '北宋末年' } },
      { authority: 'formal', label: '已确认设定', content: { rule: '写实历史，无超凡体系' } },
      { authority: 'formal', label: '已确认本卷方向', content: { direction: '小卒求生并建立第一批可信关系' } }
    ]
  }
});

const config = loadModelRuntimeConfig(process.env);
const endpoint = config.endpoints.coding;
if (endpoint.apiKey === undefined) throw new Error('Coding Plan凭证未配置');
const adapter = new ArkPlanModelAdapter({
  plan: 'coding', provider: endpoint.provider, modelId: 'deepseek-v4-pro',
  baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, purpose: 'structured_planning'
});
const result = await adapter.generate({
  requestId: 'v7-planning-tree-schema-live-probe', taskId: 'v7-planning-tree-schema-live-probe',
  ownerId: 'probe-owner', bookId: 'probe-book', agentId: 'planning-writer-deepseek-v4-pro',
  prompt, maxOutputTokens: 5_000, temperature: 0.66
});
const parsed = parsePlanningTreeOutput(result.output, 'chain', scopeId);
process.stdout.write(JSON.stringify({
  succeeded: true,
  provider: result.provider,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  cashCostCny: result.cashCostCny,
  shape: {
    treeKind: parsed.treeKind,
    rootKind: parsed.root.kind,
    eventCount: parsed.root.children.length,
    completeFacets: parsed.root.children.every((node) =>
      node.story !== undefined && node.emotion !== undefined && node.experience !== undefined
      && node.causality !== undefined && node.threads !== undefined && node.budget !== undefined)
  }
}, null, 2));
