import { ArkPlanModelAdapter } from '../../apps/api/dist/infrastructure/models/ark-plan-model.js';
import { loadModelRuntimeConfig } from '../../apps/api/dist/infrastructure/models/model-runtime-config.js';
import { optionReviewPrompt, parseOptionReview } from '../../coauthoring-v7/backend/dist/index.js';

const contextPack = {
  schema: 'v7-creation-context-v1',
  taskKind: 'volume',
  taskId: 'v7-creation-chief-review-live-probe',
  taskBrief: '比较三套写实北宋穿越第一卷方向。主角必须是张三，岳飞只是重要历史人物；无系统、无超凡力量。',
  firstVolume: true,
  selectedSources: [
    { label: '正式开书资料', content: { protagonist: '张三', era: '北宋末年', constraints: ['写实历史', '无系统', '无超凡力量'] } },
    { label: '确认全书方向', content: { direction: '张三从边军小卒逐步获得同伴信任与军中声望' } }
  ],
  excludedSources: [], openQuestions: [], sourceRefs: [], estimatedTokens: 500
};
const options = [
  {
    optionId: 'option-structure',
    option: {
      publicName: '孤营求生', publicSummary: '张三在粮断援绝的边寨中证明判断力。',
      readerExperience: '紧张求生后获得第一次认可', coreConflict: '军粮断绝与内部不信任',
      protagonistChoice: '冒险带队寻找退路', priceAndChange: '受伤并承担同伴生死责任',
      payoff: '守住边寨，成为临时伍长候选', strengths: ['因果紧'], risks: ['历史背景需核对']
    }
  },
  {
    optionId: 'option-commercial',
    option: {
      publicName: '死囚营翻身', publicSummary: '张三被错认逃兵，必须在一次伏击中自证。',
      readerExperience: '开局压力强，首个回报明确', coreConflict: '军法处置与敌军突袭',
      protagonistChoice: '放弃逃跑机会，返回救人', priceAndChange: '暴露不合时代的判断方式',
      payoff: '洗清嫌疑并得到岳飞注意', strengths: ['抓力强'], risks: ['避免岳飞抢走主角高光']
    }
  },
  {
    optionId: 'option-character',
    option: {
      publicName: '一诺成伍', publicSummary: '张三为兑现对阵亡老兵的承诺，保护其子并凝聚小队。',
      readerExperience: '人物关系扎实，回报偏情感', coreConflict: '求生本能与守诺责任',
      protagonistChoice: '承担本可避开的危险', priceAndChange: '失去独自逃生机会',
      payoff: '小队从排斥转为信任', strengths: ['人物主动'], risks: ['开篇外部冲突可能偏弱']
    }
  }
];

const prompt = optionReviewPrompt({ options, contextPack });
const config = loadModelRuntimeConfig(process.env);
const endpoint = config.endpoints.coding;
if (endpoint.apiKey === undefined) throw new Error('Coding Plan凭证未配置');
const adapter = new ArkPlanModelAdapter({
  plan: 'coding', provider: endpoint.provider, modelId: 'deepseek-v4-pro',
  baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, purpose: 'structured_planning'
});
const result = await adapter.generate({
  requestId: 'v7-creation-chief-review-live-probe', taskId: 'v7-creation-chief-review-live-probe',
  ownerId: 'probe-owner', bookId: 'probe-book', agentId: 'creation-chief-deepseek-v4-pro',
  prompt, maxOutputTokens: 1_800, temperature: 0.38
});
const parsed = parseOptionReview(result.output, options.map((item) => item.optionId));
process.stdout.write(JSON.stringify({
  succeeded: true,
  provider: result.provider,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  cashCostCny: result.cashCostCny,
  shape: {
    recommendedOptionId: parsed.recommendedOptionId,
    differenceCount: parsed.differences.length,
    riskCount: parsed.risks.length,
    authorDecisionCount: parsed.authorDecisions.length,
    authorFacingTextIsChinese: /[\u4e00-\u9fff]/.test(parsed.publicSummary),
    internalFieldLeak: /prompt|hash|schema|modelId|requestId/.test(JSON.stringify(parsed))
  }
}, null, 2));
