/**
 * MODEL-NODE-EVAL节点清单登记（2026-09-16合同）：从真实调用点登记的稳定nodeKey。
 * 每个节点记录：用途、成员岗位、提示/合同版本、预算策略（可见输出上限+思考余量）、
 * 协议（Messages结构化直出）、解析/语义检查、评测批次。
 * 节点key与设计服务运行期step id前缀一致，保证评测记录可与生产调用对照。
 * 未实现的节点不登记；已登记但未进入首批评测的标batch>1，不谎称全覆盖完成。
 */

export type EvalNodeBudgetClass = 1200 | 3000 | 5000 | 8000;

export interface EvalNodeDefinition {
  /** 稳定nodeKey：模式化节点用前缀族（如 'volume-card' 覆盖 volume-card:0..n）。 */
  readonly nodeKey: string;
  /** 运行期step id匹配前缀（含变体，如 :repair、:author-N、-more:N）。 */
  readonly stepPrefixes: readonly string[];
  readonly purpose: string;
  /** 承担岗位（快照members键）。 */
  readonly memberRole: 'researcher' | 'writer' | 'chief' | 'reviewer';
  /** 可见输出token上限（time-machine-design-service.ts:285 分档）。 */
  readonly budgetClass: EvalNodeBudgetClass;
  /** 是否适用综合思考余量（timeMachineSynthesisHeadroom：GLM 24k/DeepSeek 12k，仅budgetClass>=8000）。 */
  readonly synthesisHeadroom: boolean;
  /** 输出合同与解析/语义检查摘要（来源：调用点parse函数）。 */
  readonly contractSummary: string;
  /** 提示版本：提示正文随代码变更；以代码git修订+节点key标识，配置版本含参数档。 */
  readonly promptVersion: string;
  /** 评测批次：1=首批四类堵点（资料整理/骨架/卷卡/独立审查）；2=推荐/检索/自检/修订；3=其余已实现节点。 */
  readonly batch: 1 | 2 | 3;
  /** 调用点证据。 */
  readonly source: string;
}

const D = 'apps/api/src/application/books/time-machine-design-service.ts';

/** 首批：资料整理（提取/合并/纠正）、骨架、卷卡（单卷+批量）、独立审查（资料+锚点）。 */
export const EVAL_NODE_REGISTRY: readonly EvalNodeDefinition[] = [
  {
    nodeKey: 'card-extract',
    stepPrefixes: ['card:'],
    purpose: '资料分页提取：从开书资料分页生成结构化短卡（premise/protagonists/world等）',
    memberRole: 'researcher',
    budgetClass: 5000,
    synthesisHeadroom: false,
    contractSummary: 'JSON{fields:{premise[],protagonists[],world[],openingEnding[],preferences[],prohibitions[]}}；parseCard逐字段校验，来源key不可创造，未知保持空',
    promptVersion: 'card-contract-v6', // cardContractFor(templateRevision)；模板版本门控见makeCard
    batch: 1,
    source: `${D}:318-321(makeCard card:i)`
  },
  {
    nodeKey: 'card-merge',
    stepPrefixes: ['merge:v3:page:', 'merge:v3:'],
    purpose: '资料合并：多页短卡去重合并为全书短卡（含超大单页压缩）',
    memberRole: 'researcher',
    budgetClass: 5000,
    synthesisHeadroom: false,
    contractSummary: 'summarize_book_material操作，输出同短卡合同；prepareCardMerge传输压缩+restore还原',
    promptVersion: 'card-merge-v3',
    batch: 1,
    source: `${D}:318-325(merge:v3:page:i / merge:v3:level:i)`
  },
  {
    nodeKey: 'card-finalize',
    stepPrefixes: ['card-finalize'],
    purpose: '最终短卡分类纠正（storyDirection误放风格偏好等）',
    memberRole: 'researcher',
    budgetClass: 5000,
    synthesisHeadroom: false,
    contractSummary: '同短卡合同；premise必须归纳故事核心方向、protagonists必须保留主角',
    promptVersion: 'card-contract-v6',
    batch: 1,
    source: `${D}:327-330(card-finalize)`
  },
  {
    nodeKey: 'skeleton',
    stepPrefixes: ['skeleton'],
    purpose: '全书骨架：宏观节奏框架、故事线、期待、关系、分卷概要',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'JSON{structure,baseline,ending,openingHooks,words,lines,expectations,relations,volumeBriefs}；各卷words.target合计=全书target；作者已确认故事线必须全部承接(covers)',
    promptVersion: 'skeleton-v2-compact',
    batch: 1,
    source: `${D}:429`
  },
  {
    nodeKey: 'volume-card',
    stepPrefixes: ['volume-card:'],
    purpose: '单卷卷卡（per-volume-v1策略）：逐卷生成，有界输出',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'JSON{volumes:[本卷卷卡]}恰好一卷；anchors恰好2个(entry/exit,ownerEntityId=本卷ID)；自然语言字段≤60字、锚点summary≤50字、条件≤40字、整JSON≤3000字；required close职责须出现在关联锚点条件subjectIds',
    promptVersion: 'volume-card-v2',
    batch: 1,
    source: `${D}:503`
  },
  {
    nodeKey: 'volumes-batch',
    stepPrefixes: ['volumes:'],
    purpose: '批量卷卡（旧策略每批两卷）：旧快照恢复路径仍在用',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'JSON{volumes:[卷卡×批次]}；数量/编号/顺序必须与概要以批一致；锚点合同同单卷',
    promptVersion: 'volumes-v2',
    batch: 1,
    source: `${D}:507`
  },
  {
    nodeKey: 'review-source',
    stepPrefixes: ['review-source:', 'review-source-more:'],
    purpose: '独立审查·资料一致性：候选与正式资料短卡+回查原件核对',
    memberRole: 'chief',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'JSON{pass,issues[],suggestions[],hasMoreIssues}；issues面向作者用显示编号；超单次上限由-more:N续报，不重复已报项',
    promptVersion: 'review-source-v2',
    batch: 1,
    source: `${D}:566,577`
  },
  {
    nodeKey: 'review-anchors',
    stepPrefixes: ['review-anchors:', 'review-anchors-more:'],
    purpose: '独立审查·锚点与过程：条件可核对性、开场收束一致性、爽点可信、fallback可行',
    memberRole: 'chief',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: '同review-source verdict合同；按设计批次分节核对',
    promptVersion: 'review-anchors-v2',
    batch: 1,
    source: `${D}:566,592`
  },
  // 第二批：推荐/方法检索/自检/修订。
  {
    nodeKey: 'recommend-with-intent',
    stepPrefixes: ['recommend-with-intent'],
    purpose: '故事线推荐：主编推荐主线/支线供作者选择',
    memberRole: 'chief',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'JSON{greeting,lines[{id,role,title,description,recommended}],structure,reason}；lines≤40、id唯一、role∈main/through/stage',
    promptVersion: 'recommend-v2',
    batch: 2,
    source: `${D}:228-230(process recommend)`
  },
  {
    nodeKey: 'methods-select',
    stepPrefixes: ['methods:'],
    purpose: '方法库检索选择：search_methods/read_methods/read_source/ready动作循环（≤6次补查）',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: '单动作JSON；ready时selected[{id,application≤300字}]且id必须已读；格式问题协议反馈重试',
    promptVersion: 'methods-v1',
    batch: 2,
    source: `${D}:604(methods:round)`
  },
  {
    nodeKey: 'methods-creative',
    stepPrefixes: ['methods:creative:'],
    purpose: '参考创意选择（有creativeReleaseId时替代方法库检索）',
    memberRole: 'writer', // recommend流程用chief，design流程用writer；评测按调用场景分别记录
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'CreativeReferenceRuntime.select分步合同',
    promptVersion: 'creative-select-v1',
    batch: 2,
    source: `${D}:599`
  },
  {
    nodeKey: 'self-check',
    stepPrefixes: ['self-check'],
    purpose: '自检·结构：字数合计/落点建议卷/职责strength/payoff兑现/终卷收束',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: 'JSON{pass,issues[]}；issues每项≤2000字；pass要求issues为空',
    promptVersion: 'self-check-v2',
    batch: 2,
    source: `${D}:525`
  },
  {
    nodeKey: 'self-check-anchors',
    stepPrefixes: ['self-check-anchors'],
    purpose: '自检·锚点：条件可按正文核对、不把将来承诺当已达成',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: '同self-check verdict合同',
    promptVersion: 'self-check-anchors-v2',
    batch: 2,
    source: `${D}:526`
  },
  {
    nodeKey: 'revise',
    stepPrefixes: [':revision-1'],
    purpose: '统一自动修订（d7fc67f5后C流程）：自检+审查阻塞汇总后同一初稿一次修订',
    memberRole: 'writer',
    budgetClass: 8000,
    synthesisHeadroom: true,
    contractSummary: '复用skeleton/volume-card/volumes合同（step后缀:revision-1）；只修正有问题部分',
    promptVersion: 'revise-v1',
    batch: 2,
    source: `${D}:407-420(design revisionRound=1)`
  },
  // 第三批：其余已实现模型调用节点（登记事实，评测排期在后）。
  {
    nodeKey: 'book-synopsis',
    stepPrefixes: ['synopsis'],
    purpose: '书籍简介生成',
    memberRole: 'writer',
    budgetClass: 1200,
    synthesisHeadroom: false,
    contractSummary: 'book-synopsis-service.ts:59，maxOutputTokens=1200，temperature=0.7',
    promptVersion: 'synopsis-v1',
    batch: 3,
    source: 'apps/api/src/application/books/book-synopsis-service.ts:59'
  },
  {
    nodeKey: 'genre-profile-ensure',
    stepPrefixes: ['genre-profile'],
    purpose: '题材档案补全',
    memberRole: 'researcher',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'v7-book-genre-profile-ensure-service.ts:403 adapter.generate',
    promptVersion: 'genre-profile-v1',
    batch: 3,
    source: 'apps/api/src/application/agents/v7-book-genre-profile-ensure-service.ts:403'
  },
  {
    nodeKey: 'title-design',
    stepPrefixes: ['title-design'],
    purpose: '书名设计',
    memberRole: 'writer',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'v7-book-title-design-service.ts:125 adapter.generate',
    promptVersion: 'title-v1',
    batch: 3,
    source: 'apps/api/src/application/books/v7-book-title-design-service.ts:125'
  },
  {
    nodeKey: 'setting-editorial',
    stepPrefixes: ['setting-editorial'],
    purpose: '设定编辑部条目设计/审查（开书设定节点）',
    memberRole: 'chief',
    budgetClass: 8000,
    synthesisHeadroom: false,
    contractSummary: 'v7-setting-editorial-service.ts:2993 adapter.generate',
    promptVersion: 'setting-editorial-v1',
    batch: 3,
    source: 'apps/api/src/application/books/v7-setting-editorial-service.ts:2993'
  },
  {
    nodeKey: 'character-memory',
    stepPrefixes: ['character-memory'],
    purpose: '人物记忆整理（两处调用）',
    memberRole: 'researcher',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'v7-character-memory-service.ts:592,690 models.generate',
    promptVersion: 'character-memory-v1',
    batch: 3,
    source: 'apps/api/src/application/characters/v7-character-memory-service.ts:592,690'
  },
  {
    nodeKey: 'context-evidence',
    stepPrefixes: ['context-evidence'],
    purpose: '创作上下文证据回查与覆盖核对',
    memberRole: 'researcher',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'v7-context-evidence-reader.ts:94,124',
    promptVersion: 'context-evidence-v1',
    batch: 3,
    source: 'apps/api/src/application/creation/v7-context-evidence-reader.ts:94,124'
  },
  {
    nodeKey: 'context-compile',
    stepPrefixes: ['context-compile'],
    purpose: '创作上下文编译（含修复重试）',
    memberRole: 'researcher',
    budgetClass: 5000,
    synthesisHeadroom: false,
    contractSummary: 'v7-creation-context-compiler.ts:286,324,405',
    promptVersion: 'context-compile-v1',
    batch: 3,
    source: 'apps/api/src/application/creation/v7-creation-context-compiler.ts:286,324,405'
  },
  {
    nodeKey: 'creation-formalize',
    stepPrefixes: ['creation-formalize'],
    purpose: '正文正式化（版本定稿）',
    memberRole: 'writer',
    budgetClass: 5000,
    synthesisHeadroom: false,
    contractSummary: 'v7-creation-formalization-service.ts:464',
    promptVersion: 'creation-formalize-v1',
    batch: 3,
    source: 'apps/api/src/application/creation/v7-creation-formalization-service.ts:464'
  },
  {
    nodeKey: 'cover-prompt-design',
    stepPrefixes: ['cover-design'],
    purpose: '封面制作单文字设计（图像渲染为图片能力，不参与文字排名）',
    memberRole: 'writer',
    budgetClass: 3000,
    synthesisHeadroom: false,
    contractSummary: 'v7-book-cover-design-service.ts:330 adapter.generate（203为图片通道）',
    promptVersion: 'cover-design-v1',
    batch: 3,
    source: 'apps/api/src/application/books/v7-book-cover-design-service.ts:330'
  }
];

/** 首批四类堵点。 */
export const EVAL_BATCH1_NODE_KEYS = EVAL_NODE_REGISTRY.filter(n => n.batch === 1).map(n => n.nodeKey);

/** 当前名册文字模型（@wenmi/agent-catalog TEXT_MODELS，排除已停用glm-5.2；MiniMax仅在后缀表未登记名册，不枚举）。
 * 模型清单以名册为唯一来源，此处不复制硬编码——运行时从V7_TEXT_MODEL_PROFILE_KEYS读取。 */
export interface EvalModelTarget {
  readonly modelProfileKey: string;
  readonly provider: string;
  readonly modelId: string;
  readonly plan: string;
  /** 岗位准入备注：如K3仅主笔岗位，测试不扩产品岗位。 */
  readonly admissionNote?: string;
}

export function findEvalNode(nodeKey: string): EvalNodeDefinition | undefined {
  return EVAL_NODE_REGISTRY.find(n => n.nodeKey === nodeKey);
}

/** 由运行期step id反查节点登记（step id形如 `${runId}:${node}` 的node部分及其:repair/:author-N后缀）。 */
export function matchEvalNode(stepNode: string): EvalNodeDefinition | undefined {
  // 统一自动修订（design revisionRound>=1）后缀优先归类revise节点。
  if (/:revision-\d+$/u.test(stepNode)) return findEvalNode('revise');
  const base = stepNode.replace(/:repair$/u, '').replace(/:author-\d+$/u, '');
  let best: EvalNodeDefinition | undefined;
  let bestPrefix = -1;
  for (const node of EVAL_NODE_REGISTRY) {
    for (const prefix of node.stepPrefixes) {
      if (base.startsWith(prefix) && prefix.length > bestPrefix) { best = node; bestPrefix = prefix.length; }
    }
  }
  return best;
}
