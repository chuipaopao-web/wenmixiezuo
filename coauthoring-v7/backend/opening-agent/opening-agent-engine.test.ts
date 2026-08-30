import assert from 'node:assert/strict';
import type { V7AgentFailureClass } from '../agents/agent-failure-policy.js';
import type {
  OpeningAgentModelGateway,
  OpeningAgentTaskState,
  OpeningAgentToolGateway,
  OpeningCandidateCommit,
  OpeningCandidateContent,
  OpeningIdeaSnapshot,
  OpeningModelRequest,
  OpeningModelResult,
  OpeningReconciliation,
  OpeningReconciliationRequest,
  OpeningSavedCandidate,
  OpeningPackage,
  OpeningReview,
  OpeningWorkOrder
} from './opening-agent-contracts.js';
import { OpeningAgentEngine } from './opening-agent-engine.js';
import { OpeningAgentModelError, OpeningAgentStoppedError } from './opening-agent-contracts.js';
import { buildOpeningAgentPrompt } from './opening-prompt-compiler.js';
import { buildOpeningReferencePack, inferGenreFamilies, V7_OPENING_REFERENCE_LIMIT } from './opening-reference-tools.js';
import {
  assertOpeningPackageAuthorFidelity,
  extractExplicitProtagonistName,
  parseOpeningPackage,
  parseOpeningReview,
  parseOpeningWorkOrder
} from './opening-output-validation.js';

const IDEA = '张三穿越到三国乱世，从流民开始求生，想靠现代知识改变自己和百姓的命运。';
const WORK_ORDER: OpeningWorkOrder = {
  corePremise: '现代青年张三穿越三国乱世，从流民起步改变自己与百姓命运。',
  mustKeep: ['张三是穿越者', '背景是三国乱世'],
  preferences: ['从底层起步', '兼顾求生与成长'],
  openDecisions: ['效力阵营', '核心伙伴'],
  intendedExperience: '让读者看到小人物依靠判断与行动逐步获得立足之地。',
  designResponsibilities: ['明确时代处境', '建立持续矛盾', '给出可修改终点'],
  prohibitions: ['不提前拆分具体分卷', '不把结局写成已发生事实']
};
const PACKAGE: OpeningPackage = {
  title: '三国：从流民开始',
  positioning: {
    publishingPlatform: 'fanqie',
    channel: 'male', category: '历史穿越', genres: ['历史', '争霸'],
    tags: ['穿越', '三国', '成长', '智谋'],
    coreAppeal: '现代普通人从流民起步，在真实乱世规则中靠判断和试错建立班底。',
    expectedTotalWords: 3_000_000
  },
  backgrounds: {
    eraAndWorld: '东汉末年，黄巾余波未平，地方秩序松动，历史框架真实但允许人物改变局部命运。',
    openingSituation: ''
  },
  protagonists: [{
    name: '张三', age: '23岁', identity: '男主',
    background: '熟悉基础历史脉络，但没有万能技术手册，也不懂真实战场。',
    familyBackground: '现代普通家庭出身，穿越后暂时没有可依靠的古代亲族。',
    careerBackground: '现代普通职员，具备基础信息整理和沟通能力。',
    goldenFinger: '无额外金手指，主要依靠有限历史常识、观察和反复试错。',
    visualIdentity: { appearance: '面容清瘦、剑眉', build: '中等身高、精瘦', signatureFeature: '左眉浅疤' },
    goal: '',
    dilemma: '',
    personality: ['谨慎', '有同理心', '善于复盘'],
    boundary: ''
  }],
  opening: {
    startingSituation: '',
    incitingIncident: '',
    immediateConflict: '',
    readerPromise: ''
  },
  longTermDirection: {
    centralConflict: '个人求生与乱世权力扩张之间持续冲突，主角越有能力越无法置身事外。',
    progression: '从流民和小卒逐步学会带队、用人、治理与承担公共责任。',
    relationshipDirection: '从互相防备的求生同伴，发展为经得住利益与生死考验的班底。',
    storyPotential: '军营求生、战役升级、势力博弈和地方治理可以持续逐卷扩展。'
  },
  possibleEnding: {
    direction: '张三最终建立能够保护普通人的稳定秩序，但未必称帝。',
    price: '他要牺牲部分个人自由，并承担战争和治理决策带来的长期责任。',
    openness: '称帝、辅佐或退居幕后仍可由后续蓝图和分卷实际结果调整。'
  },
  authorNotes: [],
  mustFollow: ['不会无代价掌握古代工艺', '不能准确记住所有历史细节']
};
const PASS_REVIEW: OpeningReview = {
  verdict: 'pass', summary: '资料包保留作者核心想法，字段一致，可以交给作者检查。',
  issues: [], requiredChanges: [], authorDecisions: []
};

assert.deepEqual(parseOpeningWorkOrder(JSON.stringify(WORK_ORDER)), WORK_ORDER);
assert.deepEqual(parseOpeningPackage(`说明文字\n${JSON.stringify(PACKAGE)}`), PACKAGE);
assert.doesNotThrow(() => assertOpeningPackageAuthorFidelity('张三穿越到北宋，遇到了岳飞，统一全国。', PACKAGE));
assert.equal(extractExplicitProtagonistName('一名现代应急救援队员穿越到架空王朝北境。'), null);
assert.equal(extractExplicitProtagonistName('一个现代历史研究生穿越到东汉末年。'), null);
assert.equal(extractExplicitProtagonistName('张三穿越到北宋，遇到了岳飞。'), '张三');
assert.throws(
  () => assertOpeningPackageAuthorFidelity('张三穿越到北宋，遇到了岳飞，统一全国。', {
    ...PACKAGE,
    protagonists: [{ ...PACKAGE.protagonists[0]!, name: '岳飞' }]
  }),
  /作者明确指定主角为“张三”/u
);
assert.deepEqual(parseOpeningReview(JSON.stringify(PASS_REVIEW)), PASS_REVIEW);
assert.deepEqual(parseOpeningReview(JSON.stringify({
  ...PASS_REVIEW,
  verdict: 'author_decision',
  decisions: [{
    field: 'possibleEnding.direction',
    question: '张三最终是否称帝？',
    currentValue: '建立新朝',
    recommendation: '先统一天下，是否称帝留到后续决定',
    reason: '保留长篇调整空间',
    impact: '只改变结局方向',
    required: true
  }]
})), {
  ...PASS_REVIEW,
  verdict: 'author_decision',
  decisions: [{
    decisionId: 'decision-1',
    field: 'possibleEnding.direction',
    question: '张三最终是否称帝？',
    currentValue: '建立新朝',
    recommendation: '先统一天下，是否称帝留到后续决定',
    reason: '保留长篇调整空间',
    impact: '只改变结局方向',
    required: true
  }]
});
assert.throws(() => parseOpeningReview(JSON.stringify({
  ...PASS_REVIEW,
  verdict: 'author_decision',
  decisions: [{
    field: 'canon.secret', question: '是否修改正文？', currentValue: '不修改',
    recommendation: '修改', reason: '测试', impact: '污染正文', required: true
  }]
})), /白名单/u);
assert.throws(() => parseOpeningPackage(JSON.stringify({ ...PACKAGE, protagonists: [] })), /主角必须为1至2位/u);
assert.throws(() => parseOpeningReview(JSON.stringify({
  ...PASS_REVIEW, verdict: 'revise', requiredChanges: []
})), /必须提供可执行的作者决定卡/u);
assert.throws(() => parseOpeningReview(JSON.stringify({
  ...PASS_REVIEW, verdict: 'pass', authorDecisions: ['是否争霸']
})), /不能同时要求/u);

const references = buildOpeningReferencePack(IDEA);
assert.ok(references.references.length > 0 && references.references.length <= V7_OPENING_REFERENCE_LIMIT);
assert.ok(references.references.filter((item) => item.source === 'narrative_method').length <= 3);
assert.ok(references.references.filter((item) => item.source === 'plot_recipe').length <= 3);
assert.ok(inferGenreFamilies(IDEA).includes('historical'));
assert.ok(inferGenreFamilies(IDEA).includes('alternate_history'));
const vagueReferences = buildOpeningReferencePack('一个男人意外认识了八位性格不同的女子。');
assert.ok(vagueReferences.references.length > 0, '题材未定时仍应提供通用认知参考');
assert.equal(vagueReferences.references.some((item) => item.source === 'plot_recipe'), false);
const prompt = buildOpeningAgentPrompt({
  taskId: 'prompt-test', nodeKey: 'opening_work_order', authorIdea: IDEA, ideaVersion: 1,
  roleKey: 'chief_editor', taskKind: 'opening_review', workstationKey: 'opening',
  operationMode: 'fresh', operation: 'v7_opening_work_order_v1', basedOnTaskId: null,
  referencePack: references, workOrder: null, openingPackage: null, review: null, taxonomy: null,
  publishingPlatform: 'fanqie', validationRepair: null, memberInstruction: ''
});
assert.match(prompt, /张三穿越到三国乱世/u);
assert.match(prompt, /opening-core-boundary@1/u);
assert.match(prompt, /save_opening_candidate/u);
assert.doesNotMatch(prompt, /chief-kimi-k3|screenwriter-kimi-k3|思维链步骤/u);
assert.ok(JSON.parse(prompt).internalReferences.items.length <= 6);
assert.deepEqual(JSON.parse(prompt).taskContract, {
  taskKind: 'opening_review',
  workstationKey: 'opening',
  operationMode: 'fresh',
  objective: '完成当前开书节点的任务。',
  authorInstructionVersion: null,
  basedOnTaskId: null
});
const packagePrompt = JSON.parse(buildOpeningAgentPrompt({
  taskId: 'package-prompt-test', nodeKey: 'opening_package_design', authorIdea: IDEA, ideaVersion: 1,
  roleKey: 'screenwriter', taskKind: 'opening_design', workstationKey: 'opening',
  operationMode: 'fresh', operation: 'v7_opening_package_design_v1', basedOnTaskId: null,
  referencePack: references, workOrder: WORK_ORDER, openingPackage: null, review: null, taxonomy: null,
  publishingPlatform: 'fanqie', validationRepair: '频道必须是male、female或general',
  memberInstruction: '书名优先突出主角身份差和强冲突。'
})) as {
  outputJsonSchema: { required: string[]; properties: Record<string, { type?: string; properties?: Record<string, unknown>; items?: unknown }> };
  finalInstructions: string[];
};
assert.deepEqual(packagePrompt.outputJsonSchema.required, [
  'title', 'positioning', 'backgrounds', 'protagonists',
  'longTermDirection', 'possibleEnding', 'mustFollow', 'authorInstructions'
]);
assert.equal(packagePrompt.outputJsonSchema.properties.positioning?.type, 'object');
assert.equal(packagePrompt.outputJsonSchema.properties.protagonists?.type, 'array');
assert.equal(packagePrompt.outputJsonSchema.properties.possibleEnding?.type, 'object');
assert.equal(packagePrompt.outputJsonSchema.properties.opening, undefined);
assert.match(packagePrompt.finalInstructions.join('\n'), /outputJsonSchema/u);
assert.match(packagePrompt.finalInstructions.join('\n'), /当前困境和开局剧情不属于开书资料/u);
assert.match(packagePrompt.finalInstructions.join('\n'), /protagonists\.goal.*旧接口兼容空位/u);
assert.match(packagePrompt.finalInstructions.join('\n'), /简短中文标签，用顿号连接/u);
assert.match(packagePrompt.finalInstructions.join('\n'), /没有提出限制时返回\["无额外限制"\]/u);
assert.match(JSON.stringify(packagePrompt), /番茄小说/u);
assert.match(JSON.stringify(packagePrompt), /成员补充要求/u);
assert.match(JSON.stringify(packagePrompt), /A穿越或重生到某处，遇到B/u);
const authorRevisionPrompt = JSON.parse(buildOpeningAgentPrompt({
  taskId: 'opening-workflow-1', nodeKey: 'opening_package_design', authorIdea: IDEA, ideaVersion: 1,
  roleKey: 'screenwriter', taskKind: 'opening_design', workstationKey: 'opening',
  operationMode: 'revise', operation: 'v7_opening_package_revision_v1',
  basedOnTaskId: 'opening-package-request-1',
  referencePack: references, workOrder: WORK_ORDER, openingPackage: PACKAGE, review: PASS_REVIEW,
  taxonomy: null, publishingPlatform: 'fanqie', validationRepair: null, memberInstruction: '',
  authorInstructionVersion: 2
})) as { taskContract: {
  taskKind: string;
  workstationKey: string;
  operationMode: string;
  objective: string;
  authorInstructionVersion: number;
  basedOnTaskId: string;
} };
assert.deepEqual(authorRevisionPrompt.taskContract, {
  taskKind: 'opening_design',
  workstationKey: 'opening',
  operationMode: 'revise',
  objective: '只按当前作者修改和主编审查重新整理开书资料。',
  authorInstructionVersion: 2,
  basedOnTaskId: 'opening-package-request-1'
});
const catalogPrompt = JSON.parse(buildOpeningAgentPrompt({
  taskId: 'catalog-prompt-test', nodeKey: 'opening_package_design', authorIdea: IDEA, ideaVersion: 1,
  roleKey: 'screenwriter', taskKind: 'opening_design', workstationKey: 'opening',
  operationMode: 'fresh', operation: 'v7_opening_package_design_v1', basedOnTaskId: null,
  referencePack: references, workOrder: WORK_ORDER, openingPackage: null, review: null,
  taxonomy: {
    version: 'test-v1',
    categories: [{ key: 'history', name: '历史脑洞', channel: 'male', description: '历史架空', recommendedTags: ['成长'] }],
    subjects: ['秦汉三国', '穿越'],
    tagSuggestions: ['成长', '权谋', '智商在线'],
    allowedTags: ['成长', '权谋', '智商在线']
  },
  publishingPlatform: 'fanqie', validationRepair: null, memberInstruction: ''
})) as {
  outputJsonSchema: { properties: { positioning: { properties: {
    category: { enum?: string[] };
    genres: { items?: { enum?: string[] } };
    tags: { items?: { enum?: string[] } };
  } } } };
};
assert.deepEqual(catalogPrompt.outputJsonSchema.properties.positioning.properties.category.enum, ['历史脑洞']);
assert.deepEqual(catalogPrompt.outputJsonSchema.properties.positioning.properties.genres.items?.enum, ['秦汉三国', '穿越']);
assert.deepEqual(catalogPrompt.outputJsonSchema.properties.positioning.properties.tags.items?.enum, ['成长', '权谋', '智商在线']);

async function normalFlow(): Promise<void> {
  const tools = new MemoryTools(IDEA);
  const models = new ScriptedModels([output(PACKAGE), output(PASS_REVIEW)]);
  const engine = new OpeningAgentEngine(models, tools);
  const state = await engine.run({ ownerId: 'owner-a', taskId: 'task-normal' });
  assert.equal(state.status, 'awaiting_author_confirmation');
  assert.equal(state.phase, 'complete');
  assert.equal(tools.candidates.length, 2);
  assert.deepEqual(tools.candidates.map((item) => item.kind), ['opening_package', 'opening_review']);
  assert.deepEqual(models.generateCalls.map((item) => item.member.roleKey), ['screenwriter', 'chief_editor']);
  assert.deepEqual(models.generateCalls.map((item) => ({
    taskKind: item.taskKind,
    workstationKey: item.workstationKey,
    operationMode: item.operationMode,
    basedOnTaskId: item.basedOnTaskId
  })), [
    { taskKind: 'opening_design', workstationKey: 'opening', operationMode: 'fresh', basedOnTaskId: null },
    { taskKind: 'opening_review', workstationKey: 'opening', operationMode: 'fresh', basedOnTaskId: null }
  ]);
  assert.equal(models.generateCalls[0]?.member.memberKey, 'planner-deepseek-v4-pro',
    '新任务默认设计成员必须来自统一强模型成员表');
  assert.notEqual(
    `${models.generateCalls[0]?.member.model.provider}/${models.generateCalls[0]?.member.model.modelId}`,
    `${models.generateCalls[1]?.member.model.provider}/${models.generateCalls[1]?.member.model.modelId}`,
    '审查成员必须使用与设计成员不同的实际模型底座'
  );
  assert.ok(tools.candidates.every((item) => !('bookId' in item)), '候选提交不能创建正式书籍');
  const callsBeforeResume = models.generateCalls.length;
  const resumed = await engine.run({ ownerId: 'owner-a', taskId: 'task-normal' });
  assert.equal(resumed.status, 'awaiting_author_confirmation');
  assert.equal(models.generateCalls.length, callsBeforeResume, '已完成检查点不得重复调用模型');
}

async function invalidOutputRepairsThenSwitches(): Promise<void> {
  const tools = new MemoryTools(IDEA);
  const models = new ScriptedModels([
    outputText('{"corePremise":"缺字段"}'),
    outputText('仍然不是合法开书资料'),
    output(PACKAGE),
    output(PASS_REVIEW)
  ]);
  const state = await new OpeningAgentEngine(models, tools).run({ ownerId: 'owner-a', taskId: 'task-switch' });
  assert.equal(state.status, 'awaiting_author_confirmation');
  assert.deepEqual(models.generateCalls.slice(0, 3).map((item) => item.member.memberKey), [
    'planner-deepseek-v4-pro', 'planner-deepseek-v4-pro', 'planner-kimi-k3'
  ]);
  assert.equal(state.structureRepairs.package_design, 1);
  assert.equal(state.automaticMemberSwitches, 1);
  assert.equal(models.generateCalls[1]?.operationMode, 'repair');
  assert.equal(models.generateCalls[1]?.basedOnTaskId, models.generateCalls[0]?.requestId,
    '格式修复必须绑定上一份真实返回但结构无效的模型请求');
  assert.equal(models.generateCalls[2]?.operationMode, 'fresh',
    '切换成员后是新的首次尝试，不能伪装成格式修复');
  assert.equal(models.generateCalls[2]?.basedOnTaskId, null);
  assert.equal(tools.candidates.filter((item) => item.kind === 'opening_package').length, 1,
    '失败输出不能保存成候选');
}

async function unknownOutcomeReconcilesAndResumes(): Promise<void> {
  const tools = new MemoryTools(IDEA);
  const models = new ScriptedModels([
    unknown([{ status: 'unknown' }, reconcileOutput(PACKAGE)]),
    output(PASS_REVIEW)
  ]);
  const engine = new OpeningAgentEngine(models, tools);
  await assert.rejects(
    () => engine.run({ ownerId: 'owner-a', taskId: 'task-unknown' }),
    (error: unknown) => error instanceof OpeningAgentStoppedError && error.state.status === 'interrupted'
  );
  assert.equal(models.generateCalls.length, 1);
  tools.stripAttemptContractSnapshots();
  const resumed = await engine.run({ ownerId: 'owner-a', taskId: 'task-unknown' });
  assert.equal(resumed.status, 'awaiting_author_confirmation');
  assert.equal(models.generateCalls.filter((item) => item.nodeKey === 'opening_package_design').length, 1,
    '结果未知恢复必须调和原请求，不能重发开书设计');
  assert.equal(models.reconcileCalls.length, 2);
  assert.ok(models.reconcileCalls.every((item) => (
    item.ownerId === 'owner-a'
    && item.taskId === 'task-unknown'
    && item.nodeKey === 'opening_package_design'
    && item.memberKey === 'planner-deepseek-v4-pro'
  )), '结果未知调和必须携带真实账号、开书任务、节点和成员范围');
}

async function reviewRevisionStopsForAuthor(): Promise<void> {
  const tools = new MemoryTools(IDEA);
  const revise: OpeningReview = {
    verdict: 'revise', summary: '主角限制没有在持续方向里落实。',
    issues: [{
      field: 'longTermDirection.centralConflict', evidence: '没有说明有限知识的边界',
      impact: '后续容易写成全知开挂', requiredAction: '补充知识试错和代价'
    }],
    requiredChanges: ['在成长方向中明确有限知识必须经过验证并付出试错代价'],
    authorDecisions: [],
    decisions: [{
      decisionId: 'decision-1', field: 'longTermDirection.progression',
      question: '成长方向是否加入知识试错的边界？', currentValue: PACKAGE.longTermDirection.progression,
      recommendation: '主角用现代常识提出假设，但每次都要经过验证并承担试错代价。',
      reason: '避免写成全知开挂。', impact: '只调整成长方向。', required: true
    }]
  };
  const models = new ScriptedModels([output(PACKAGE), output(revise)]);
  const state = await new OpeningAgentEngine(models, tools).run({ ownerId: 'owner-a', taskId: 'task-revise' });
  assert.equal(state.status, 'awaiting_author_decision');
  assert.equal(state.editorialRevisionCount, 0);
  assert.deepEqual(tools.candidates.map((item) => item.kind), [
    'opening_package', 'opening_review'
  ]);
  assert.equal(models.generateCalls.length, 2,
    '轻量开书审查发现问题后必须交给作者决定，不得自动增加第三次模型调用');
}

async function authorDecisionStopsCleanly(): Promise<void> {
  const tools = new MemoryTools(IDEA);
  const review: OpeningReview = {
    verdict: 'author_decision', summary: '终点方向需要作者决定。', issues: [], requiredChanges: [],
    authorDecisions: ['主角最终是成为一方诸侯，还是保持臣属身份？']
  };
  const models = new ScriptedModels([output(PACKAGE), output(review)]);
  const state = await new OpeningAgentEngine(models, tools).run({ ownerId: 'owner-a', taskId: 'task-decision' });
  assert.equal(state.status, 'awaiting_author_decision');
  assert.equal(state.phase, 'complete');
  assert.equal(models.generateCalls.length, 2);
}

class MemoryTools implements OpeningAgentToolGateway {
  public readonly candidates: OpeningSavedCandidate[] = [];
  private state: OpeningAgentTaskState | null = null;
  private readonly idea: OpeningIdeaSnapshot;

  public constructor(text: string) {
    this.idea = { text, version: 1, hash: `hash-${text.length}`, publishingPlatform: 'fanqie' };
  }

  public async readOpeningIdea(): Promise<OpeningIdeaSnapshot> { return structuredClone(this.idea); }
  public async loadTask(): Promise<OpeningAgentTaskState | null> { return this.state === null ? null : structuredClone(this.state); }
  public async createTask(state: OpeningAgentTaskState): Promise<OpeningAgentTaskState> {
    if (this.state !== null) throw new Error('任务已经存在');
    this.state = structuredClone(state);
    return structuredClone(state);
  }
  public async saveTask(state: OpeningAgentTaskState): Promise<void> { this.state = structuredClone(state); }
  public stripAttemptContractSnapshots(): void {
    if (this.state === null) throw new Error('测试任务尚未创建');
    for (const attempt of this.state.attempts) {
      delete attempt.taskKind;
      delete attempt.workstationKey;
      delete attempt.operationMode;
      delete attempt.basedOnTaskId;
      delete attempt.authorInstructionVersion;
    }
  }
  public async readCandidate<T extends OpeningCandidateContent>(
    _ownerId: string,
    _taskId: string,
    candidateId: string
  ): Promise<OpeningSavedCandidate<T>> {
    const found = this.candidates.find((item) => item.candidateId === candidateId);
    if (found === undefined) throw new Error(`候选不存在：${candidateId}`);
    return structuredClone(found) as OpeningSavedCandidate<T>;
  }
  public async commitCandidate<T extends OpeningCandidateContent>(
    _ownerId: string,
    _taskId: string,
    commit: OpeningCandidateCommit<T>
  ): Promise<OpeningSavedCandidate<T>> {
    if (this.candidates.some((item) => item.candidateId === commit.candidateId)) throw new Error('候选重复提交');
    const version = this.candidates.filter((item) => item.kind === commit.kind).length + 1;
    const saved: OpeningSavedCandidate<T> = {
      candidateId: commit.candidateId,
      kind: commit.kind,
      version,
      content: structuredClone(commit.content),
      createdByMemberKey: commit.createdByMemberKey,
      modelRequestId: commit.modelRequestId,
      sourceCandidateIds: [...commit.sourceCandidateIds]
    };
    this.candidates.push(saved);
    this.state = structuredClone(commit.nextState);
    return structuredClone(saved);
  }
}

type ScriptAction =
  | { type: 'output'; output: string }
  | { type: 'error'; failureClass: V7AgentFailureClass; message: string }
  | { type: 'unknown'; reconciliations: ScriptReconciliation[] };
type ScriptReconciliation =
  | { status: 'unknown' }
  | { status: 'failed'; failureClass: V7AgentFailureClass; message: string }
  | { status: 'succeeded'; output: string };

class ScriptedModels implements OpeningAgentModelGateway {
  public readonly generateCalls: OpeningModelRequest[] = [];
  public readonly reconcileCalls: OpeningReconciliationRequest[] = [];
  private readonly requests = new Map<string, OpeningModelRequest>();
  private readonly reconciliations = new Map<string, ScriptReconciliation[]>();

  public constructor(private readonly actions: ScriptAction[]) {}

  public async generate(request: OpeningModelRequest): Promise<OpeningModelResult> {
    this.generateCalls.push(structuredClone(request));
    this.requests.set(request.requestId, request);
    const action = this.actions.shift();
    if (action === undefined) throw new Error('测试脚本缺少模型动作');
    if (action.type === 'error') throw new OpeningAgentModelError(action.message, action.failureClass);
    if (action.type === 'unknown') {
      this.reconciliations.set(request.requestId, [...action.reconciliations]);
      throw new OpeningAgentModelError('连接中断，结果未知', 'outcome_unknown', true);
    }
    return modelResult(request, action.output);
  }

  public async reconcile(reconciliationRequest: OpeningReconciliationRequest): Promise<OpeningReconciliation> {
    this.reconcileCalls.push(structuredClone(reconciliationRequest));
    const request = this.requests.get(reconciliationRequest.requestId);
    if (request === undefined) throw new Error('无法调和未知请求');
    assert.equal(reconciliationRequest.ownerId, request.ownerId);
    assert.equal(reconciliationRequest.taskId, request.taskId);
    assert.equal(reconciliationRequest.nodeKey, request.nodeKey);
    assert.equal(reconciliationRequest.memberKey, request.member.memberKey);
    const queue = this.reconciliations.get(reconciliationRequest.requestId) ?? [];
    const action = queue.shift() ?? { status: 'unknown' as const };
    if (action.status === 'unknown') return { status: 'unknown' };
    if (action.status === 'failed') return action;
    return { status: 'succeeded', result: modelResult(request, action.output) };
  }
}

function output(value: OpeningCandidateContent): ScriptAction { return { type: 'output', output: JSON.stringify(value) }; }
function outputText(value: string): ScriptAction { return { type: 'output', output: value }; }
function unknown(reconciliations: ScriptReconciliation[]): ScriptAction { return { type: 'unknown', reconciliations }; }
function reconcileOutput(value: OpeningCandidateContent): ScriptReconciliation {
  return { status: 'succeeded', output: JSON.stringify(value) };
}
function modelResult(request: OpeningModelRequest, outputValue: string): OpeningModelResult {
  return {
    requestId: request.requestId,
    provider: request.member.model.provider,
    modelId: request.member.model.modelId,
    output: outputValue,
    inputTokens: 100,
    outputTokens: 200
  };
}

await normalFlow();
await invalidOutputRepairsThenSwitches();
await unknownOutcomeReconcilesAndResumes();
await reviewRevisionStopsForAuthor();
await authorDecisionStopsCleanly();

process.stdout.write('V7 opening agent engine validated: contracts, references, prompts, execution, recovery and revision all passed.\n');
