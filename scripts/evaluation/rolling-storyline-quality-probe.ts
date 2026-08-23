import { createHash } from 'node:crypto';
import type { EditorialRoleKey } from '@wenmi/contracts';
import { creativeTemplate } from '../../apps/api/src/application/agents/creative-templates-v6.js';
import { nodeProtocolSkill, roleAgentSkill } from '../../apps/api/src/application/agents/agent-skills-v6.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

const config = loadModelRuntimeConfig(process.env, { codexWorkingDirectory: process.cwd() });
if (config.requestedMode !== 'subscription-plan' || config.activeMode !== 'subscription-plan') {
  throw new Error(`滚动故事线真实探针只允许subscription-plan；当前requested=${config.requestedMode}, active=${config.activeMode}`);
}
if (!config.strictPlanOnly || config.cashFallbackAllowed) throw new Error('真实探针拒绝非严格套餐模式或现金回退');

const factory = new ModelAdapterFactory(config);
const probes: Array<{ key: string; roleKey: EditorialRoleKey; nodeKind: string; templateVersion: string; prompt: string; validate: (value: Record<string, unknown>) => void }> = [
  {
    key: 'zero-storyline-opening', roleKey: 'screenwriter', nodeKind: 'volume_causal_direction', templateVersion: 'volume-causal-direction-v2',
    prompt: `只输出一个JSON对象。作者只有开局灵感，没有故事线和全书结局：主角沈砚在旧城档案馆收到一封迟到十年的信，信中说父亲的冤案证据藏在即将拆除的七号库房。请只设计第一卷方向。字段必须为previousActual,newState,unresolvedPressure,protagonistChoice,volumeGoal,affectedStorylines,requiresFullBookEnding；affectedStorylines必须为空数组，requiresFullBookEnding必须为false，不得补全全书结局。`,
    validate: (value) => {
      requireString(value, 'protagonistChoice'); requireString(value, 'volumeGoal');
      if (!Array.isArray(value.affectedStorylines) || value.affectedStorylines.length !== 0) throw new Error('零故事线开局被强制挂线');
      if (value.requiresFullBookEnding !== false) throw new Error('零故事线开局仍要求全书结局');
    }
  },
  {
    key: 'emerging-line-candidate', roleKey: 'screenwriter', nodeKind: 'storyline_emerging_line', templateVersion: 'storyline-emerging-line-v2',
    prompt: `只输出一个JSON对象。卷结算证据只有：vol1:event1“沈砚发现三份档案都被同一枚无名印章改写”；vol1:event2“守库人看见印章后拒绝开门”；vol1:event3“拆迁名单背面再次出现无名印章”。请识别一条潜在线路候选，不得写成正文事实。字段必须为title,summary,continuationReason,coreQuestion,evidenceRefs,unknowns,misreadRisk,candidateOnly；evidenceRefs只能使用上述三个ID且至少两个，candidateOnly必须为true。`,
    validate: (value) => {
      requireString(value, 'title'); requireString(value, 'continuationReason'); requireString(value, 'misreadRisk');
      requireEvidence(value, ['vol1:event1', 'vol1:event2', 'vol1:event3'], 2);
      if (value.candidateOnly !== true) throw new Error('潜在线路被冒充正式事实');
      if (!Array.isArray(value.unknowns) || value.unknowns.length === 0) throw new Error('潜在线路没有保留未知点');
    }
  },
  {
    key: 'chief-editor-next-directions', roleKey: 'chief_editor', nodeKind: 'storyline_next_direction', templateVersion: 'storyline-next-direction-v2',
    prompt: `只输出一个JSON对象。已确认事实：vol1:settlement“沈砚保住七号库房，但父亲冤案仍无直接证据”；开放问题：无名印章是谁在使用；作者目前只想到第十卷完成父亲翻案，不知道全书结局。请给2个真正不同的下一段方向，只覆盖下一卷至未来两卷。顶层字段directions；每个方向字段title,summary,continuationReason,protagonistInvolvement,coreQuestion,evidenceRefs,inferences,unknowns,misreadRisk,recommendedHorizonVolumes。evidenceRefs只能是vol1:settlement，recommendedHorizonVolumes只能为1或2，不得生成全书大结局。`,
    validate: (value) => {
      const directions = value.directions;
      if (!Array.isArray(directions) || directions.length < 2 || directions.length > 3) throw new Error('主编没有给出2—3个方向');
      const titles = new Set<string>();
      for (const item of directions) {
        if (!isRecord(item)) throw new Error('方向不是对象');
        titles.add(requireString(item, 'title')); requireString(item, 'continuationReason'); requireString(item, 'protagonistInvolvement');
        requireEvidence(item, ['vol1:settlement'], 1);
        if (item.recommendedHorizonVolumes !== 1 && item.recommendedHorizonVolumes !== 2) throw new Error('推荐超过下一至两卷');
        for (const banned of ['fullBookEnding', 'storyEnding', 'finalEnding']) if (banned in item) throw new Error(`推荐擅自输出${banned}`);
      }
      if (titles.size !== directions.length) throw new Error('主编方向同名同义');
    }
  },
  {
    key: 'insufficient-evidence-observe', roleKey: 'chief_editor', nodeKind: 'storyline_next_direction', templateVersion: 'storyline-next-direction-v2',
    prompt: `只输出一个JSON对象。当前唯一证据是vol2:ch1“陌生人在章末看了主角一眼”，没有跨事件重复、没有动机、没有后续行为。证据不足，不应建立新故事线或强推下一卷方向。字段必须为decision,reason,evidenceRefs,unknowns；decision必须为observe，evidenceRefs只能是vol2:ch1，unknowns至少一项。`,
    validate: (value) => {
      if (value.decision !== 'observe') throw new Error('证据不足时主编没有建议继续观察');
      requireString(value, 'reason'); requireEvidence(value, ['vol2:ch1'], 1);
      if (!Array.isArray(value.unknowns) || value.unknowns.length === 0) throw new Error('继续观察没有说明未知点');
    }
  },
  {
    key: 'settlement-truth-separation', roleKey: 'deputy_editor', nodeKind: 'volume_settlement', templateVersion: 'volume-settlement-v2',
    prompt: `只输出一个JSON对象。已定稿正文事实：vol1:ch20“沈砚把七号库房钥匙交给记者，库房暂时免拆”；原计划但正文没有发生：“沈砚立即前往皇城追查幕后人”。请做卷结算。字段必须为actualProgress,evidenceRefs,openQuestions,plannedButNotOccurred；actualProgress只能记录正文事实，evidenceRefs只能是vol1:ch20，plannedButNotOccurred必须收录未发生计划。`,
    validate: (value) => {
      const actual = requireString(value, 'actualProgress');
      if (/皇城|前往/u.test(actual)) throw new Error('未发生计划混入实际结算');
      requireEvidence(value, ['vol1:ch20'], 1);
      if (!Array.isArray(value.plannedButNotOccurred) || !value.plannedButNotOccurred.some((item) => typeof item === 'string' && /皇城|前往/u.test(item))) {
        throw new Error('未发生计划未被单独保留');
      }
    }
  }
];

const evidence: Array<Record<string, unknown>> = [];
for (const [index, probe] of probes.entries()) {
  const legacyRole = legacyRoleFor(probe.roleKey);
  const profile = config.roleProfiles[legacyRole];
  const adapter = factory.resolve(profile.provider, profile.modelId, 'structured_planning', legacyRole);
  const skill = { role: roleAgentSkill(probe.roleKey), node: nodeProtocolSkill(probe.nodeKind, probe.roleKey) };
  const template = creativeTemplate(probe.nodeKind, probe.templateVersion);
  const prompt = `${probe.prompt}\n\n岗位Skill与节点协议：${JSON.stringify(skill)}\n\n模板合同：${JSON.stringify(template.promptContract)}\n\n不要输出Markdown代码围栏。`;
  const startedAt = new Date();
  const result = await adapter.generate({ requestId: `rolling-probe-${index + 1}`, taskId: 'rolling-storyline-quality-probe', ownerId: 'runtime-verification', bookId: 'runtime-verification', agentId: probe.roleKey, prompt, maxOutputTokens: 900 });
  if (result.state !== 'succeeded' || result.cashCostCny !== 0) throw new Error(`${probe.key}未通过严格零现金调用门禁`);
  const parsed = parseObject(result.output);
  probe.validate(parsed);
  const finishedAt = new Date();
  evidence.push({ key: probe.key, roleKey: probe.roleKey, provider: result.provider, modelId: result.modelId, passed: true,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens, cashCostCny: result.cashCostCny,
    outputCharacters: [...result.output].length, outputSha256: createHash('sha256').update(result.output).digest('hex'),
    skillHash: createHash('sha256').update(JSON.stringify(skill)).digest('hex'), templateHash: template.contentHash,
    durationMs: finishedAt.getTime() - startedAt.getTime(), startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() });
}
for (const row of evidence) process.stdout.write(`${JSON.stringify(row)}\n`);
process.stdout.write(`${JSON.stringify({ passed: evidence.length === probes.length, probeCount: evidence.length, strictPlanOnly: config.strictPlanOnly, cashFallbackAllowed: config.cashFallbackAllowed })}\n`);

function parseObject(output: string): Record<string, unknown> {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('模型没有返回JSON对象');
  const value: unknown = JSON.parse(cleaned.slice(first, last + 1));
  if (!isRecord(value)) throw new Error('模型返回不是JSON对象');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function requireString(value: Record<string, unknown>, key: string): string {
  const item = value[key]; if (typeof item !== 'string' || item.trim().length === 0) throw new Error(`${key}不能为空`); return item.trim();
}
function requireEvidence(value: Record<string, unknown>, allowed: string[], minimum: number): void {
  const refs = value.evidenceRefs;
  if (!Array.isArray(refs) || refs.length < minimum || refs.some((item) => typeof item !== 'string' || !allowed.includes(item))) throw new Error('证据引用不合法');
}
function legacyRoleFor(roleKey: EditorialRoleKey): keyof typeof config.roleProfiles {
  return ({ chief_editor: 'chief_editor', deputy_editor: 'chief_editor', screenwriter: 'plot_architect', writer: 'writer', fact_reviewer: 'continuity', literary_reviewer: 'reviewer', experience_reviewer: 'reader_experience' } as const)[roleKey];
}
