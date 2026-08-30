import { ArkPlanModelAdapter } from '../../apps/api/dist/infrastructure/models/ark-plan-model.js';
import { loadModelRuntimeConfig } from '../../apps/api/dist/infrastructure/models/model-runtime-config.js';
import { parseOpeningPackage } from '../../coauthoring-v7/backend/dist/opening-agent/opening-output-validation.js';
import { buildOpeningAgentPrompt } from '../../coauthoring-v7/backend/dist/opening-agent/opening-prompt-compiler.js';
import { buildOpeningReferencePack } from '../../coauthoring-v7/backend/dist/opening-agent/opening-reference-tools.js';

const idea = '张三穿越到三国乱世，成为被强征入伍的流民，想靠自己的判断活下来并保护同伴。';
const workOrder = {
  corePremise: '普通人在三国乱世从流民起步，靠判断与行动赢得生存和主动权。',
  mustKeep: ['主角名为张三', '三国乱世', '流民起步'],
  preferences: ['成长需要付出代价', '不依赖无敌金手指'],
  openDecisions: ['所属阵营', '长期身份终点'],
  intendedExperience: '让读者看到小人物一步步在乱世站稳脚跟。',
  designResponsibilities: ['完成定位、背景、主角、开局、长期方向与可修改终点'],
  prohibitions: ['不将未来规划写成已发生事实']
};
const referencePack = buildOpeningReferencePack(idea);
const prompt = buildOpeningAgentPrompt({
  taskId: 'v7-schema-live-probe',
  nodeKey: 'opening_package_design',
  roleKey: 'screenwriter',
  taskKind: 'opening_design',
  workstationKey: 'opening',
  operationMode: 'fresh',
  operation: 'v7_opening_package_design_v1',
  basedOnTaskId: null,
  authorIdea: idea,
  ideaVersion: 1,
  referencePack,
  workOrder,
  openingPackage: null,
  review: null,
  taxonomy: null,
  publishingPlatform: 'fanqie',
  validationRepair: null,
  memberInstruction: ''
});
const config = loadModelRuntimeConfig(process.env);
const endpoint = config.endpoints.coding;
if (endpoint.apiKey === undefined) throw new Error('Coding Plan凭证未配置');
const adapter = new ArkPlanModelAdapter({
  plan: 'coding',
  provider: endpoint.provider,
  modelId: 'deepseek-v4-pro',
  baseUrl: endpoint.baseUrl,
  apiKey: endpoint.apiKey,
  purpose: 'structured_planning'
});
const result = await adapter.generate({
  requestId: 'v7-schema-live-probe',
  taskId: 'v7-schema-live-probe',
  ownerId: 'probe-owner',
  bookId: 'pre-book',
  agentId: 'screenwriter-deepseek-v4-pro',
  prompt,
  maxOutputTokens: 6_000
});
const parsed = parseOpeningPackage(result.output);
process.stdout.write(JSON.stringify({
  succeeded: true,
  provider: result.provider,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  cashCostCny: result.cashCostCny,
  shape: {
    title: typeof parsed.title,
    positioning: typeof parsed.positioning,
    backgrounds: typeof parsed.backgrounds,
    protagonists: Array.isArray(parsed.protagonists) ? parsed.protagonists.length : 0,
    opening: typeof parsed.opening,
    longTermDirection: typeof parsed.longTermDirection,
    possibleEnding: typeof parsed.possibleEnding,
    authorNotes: Array.isArray(parsed.authorNotes)
  }
}, null, 2));
