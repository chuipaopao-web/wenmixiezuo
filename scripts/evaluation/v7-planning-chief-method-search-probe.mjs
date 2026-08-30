import { ArkPlanModelAdapter } from '../../apps/api/dist/infrastructure/models/ark-plan-model.js';
import { loadModelRuntimeConfig } from '../../apps/api/dist/infrastructure/models/model-runtime-config.js';
import {
  parsePlanningMethodSearchRequest,
  planningMethodSearchPrompt,
  retrievePlanningMethodCandidates
} from '../../coauthoring-v7/backend/dist/index.js';

const sourceSnapshot = {
  purpose: 'book_route_design',
  sources: [{
    authority: 'formal',
    label: '开书资料与已确认设定',
    content: {
      protagonist: '张三', era: '北宋末年',
      longTermDirection: '从边军小卒起步，最终推动统一并建立新的治理秩序。',
      mustFollow: ['主角始终是张三', '写实历史', '没有系统和超凡力量']
    }
  }],
  authorGoal: '约三百万字、八卷左右；首卷抓人，中后期不能重复升级。'
};

const prompt = planningMethodSearchPrompt({
  seatName: '主编',
  seatResponsibility: '为长篇全书选择少量能支撑跨卷递进、因果续航和阅读兑现的方法。',
  independentFocus: ['守住作者原意', '三百万字容量', '八卷责任差异', '中段不重复'],
  sourceSnapshot
});
const config = loadModelRuntimeConfig(process.env);
const endpoint = config.endpoints.coding;
if (endpoint.apiKey === undefined) throw new Error('Coding Plan凭证未配置');
const adapter = new ArkPlanModelAdapter({
  plan: 'coding', provider: endpoint.provider, modelId: 'deepseek-v4-pro',
  baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, purpose: 'structured_planning'
});
const result = await adapter.generate({
  requestId: 'v7-planning-chief-method-search-live-probe',
  taskId: 'v7-planning-chief-method-search-live-probe',
  ownerId: 'probe-owner', bookId: 'probe-book', agentId: 'planning-chief-deepseek-v4-pro',
  prompt, maxOutputTokens: 2_000, temperature: 0.35
});
const request = parsePlanningMethodSearchRequest(result.output);
const retrieval = retrievePlanningMethodCandidates(request);
process.stdout.write(JSON.stringify({
  succeeded: true,
  provider: result.provider,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  cashCostCny: result.cashCostCny,
  request: {
    planningLayers: request.planningLayers,
    dimensions: request.dimensions,
    desiredCount: request.desiredCount,
    queryCount: request.searchQueries.length
  },
  retrieval: {
    version: retrieval.retrievalVersion,
    candidateCount: retrieval.candidates.length,
    bounded: retrieval.candidates.length >= 8 && retrieval.candidates.length <= 18,
    fullCatalogLeaked: retrieval.candidates.length >= 146
  }
}, null, 2));
