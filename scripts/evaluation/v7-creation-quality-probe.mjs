import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ArkPlanModelAdapter } from '../../apps/api/dist/infrastructure/models/ark-plan-model.js';
import { loadModelRuntimeConfig } from '../../apps/api/dist/infrastructure/models/model-runtime-config.js';
import { manuscriptPrompt } from '../../coauthoring-v7/backend/dist/index.js';

const runtime = loadModelRuntimeConfig(process.env, { codexWorkingDirectory: process.cwd() });
const endpoint = runtime.endpoints.coding;
if (endpoint.apiKey === undefined) throw new Error('Coding Plan凭证未配置，真实创作验收未执行');

const outline = {
  chapterNumber: 1,
  title: '缺掉的三袋粮',
  objective: '张三从军粮账目和车辙中发现缺口，在敌袭前说服同袍转移真正的存粮。',
  openingHook: '开篇即有人因私藏军粮将被军棍处置，张三看见粮袋封口和车辙对不上。',
  sceneSetup: '北宋末年边寨，天寒粮紧，巡检急于找人顶罪。',
  protagonistChoice: '张三冒着被当成同谋的风险，当众指出账目破绽，并亲自沿车辙追查。',
  opposition: '巡检不信一个新卒，真正偷粮者趁夜引敌制造混乱。',
  turn: '张三发现丢粮是假，敌人真正目标是藏粮地；他放弃独自逃生，回营救下同袍并示警。',
  emotionalMovement: '从被轻视和孤立，到用选择换来两名同袍的第一次信任。',
  payoff: '藏粮未失，被冤枉者获救；张三取得临时带队资格，但偷粮内应仍未抓到。',
  continuity: '张三只能依靠历史常识、观察力和组织能力，不能使用系统、超凡力量或现代装备。岳飞只能作为尚未正式相遇的历史坐标，不能抢走张三的本章选择。',
  openQuestions: ['内应是谁', '巡检为何急于结案'],
  nextChapterInterface: '张三带两名同袍沿假车辙反查，发现线索指向营内。'
};
const contextPack = {
  taskBrief: '完成写实北宋穿越长篇第一章。',
  confirmedOpening: {
    protagonist: '张三',
    era: '北宋末年',
    premise: '现代历史爱好者张三穿越后成为边军小卒。',
    forbidden: ['系统', '金手指', '超凡力量', '现代武器凭空出现', '后宫']
  },
  confirmedVolumeDirection: '张三从不受信任的小卒成长为能让同伴服从其判断的伍长候选。',
  writingContract: '写成一章约2700至3200字的完整中文网文正文。前500字出现具体危机与主角判断；本章完成一个小回报，并留下自然的下一章问题。'
};

const adapter = new ArkPlanModelAdapter({
  plan: 'coding',
  provider: endpoint.provider,
  modelId: 'deepseek-v4-pro',
  baseUrl: endpoint.baseUrl,
  apiKey: endpoint.apiKey,
  purpose: 'novel_writer',
  timeoutMs: 900_000
});
const result = await adapter.generate({
  requestId: 'v7-creation-quality-single-call',
  taskId: 'v7-creation-quality-single-call',
  ownerId: 'v7-quality-probe-owner',
  bookId: 'v7-quality-probe-book',
  agentId: 'creation-writer-deepseek-v4-pro',
  prompt: manuscriptPrompt({ outline, contextPack }),
  maxOutputTokens: 4_800,
  temperature: 0.72
});
const manuscript = result.output.trim();
const forbiddenTerms = ['系统', '灵气', '法术', '资料包', '章纲', '模型', '生成'];
const leakedTerms = forbiddenTerms.filter((term) => manuscript.includes(term));
const report = {
  schema: 'v7-creation-quality-probe-v1',
  completedAtUtc: new Date().toISOString(),
  calls: 1,
  sample: {
    premise: '张三穿越北宋边军；岳飞不得抢走主角选择；无系统、无超凡。',
    chapterTitle: outline.title,
    manuscriptCharacters: [...manuscript].length
  },
  checks: {
    protagonistPresent: manuscript.includes('张三'),
    eraGroundingPresent: /北宋|边寨|军营|军粮|宋军|巡检|粟米/u.test(manuscript),
    forbiddenTermsAbsent: leakedTerms.length === 0,
    noMarkdownFence: !manuscript.includes('```'),
    noSchemaLeak: !/schema|sourceRefs|chainScopeId|evidenceRef/u.test(manuscript),
    manuscriptLengthReached: [...manuscript].length >= 2_350
  },
  leakedTerms,
  usage: {
    provider: result.provider,
    modelId: result.modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cashCostCny: result.cashCostCny
  }
};

const artifactDir = resolve(process.cwd(), 'artifacts', 'v7-commercial-closure');
mkdirSync(artifactDir, { recursive: true });
writeFileSync(resolve(artifactDir, 'real-agent-manuscript.txt'), `${manuscript}\n`, 'utf8');
writeFileSync(resolve(artifactDir, 'real-agent-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  succeeded: Object.values(report.checks).every(Boolean),
  calls: 1,
  manuscriptCharacters: report.sample.manuscriptCharacters,
  checks: report.checks,
  artifactDir
}, null, 2)}\n`);
