import { compileOpeningSkillBundle } from '../agents/agent-skills.js';
import type { V7OpeningNodeKey } from '../agents/agent-tools.js';
import type {
  OpeningAgentOperationMode,
  OpeningAgentTaskKind,
  OpeningAgentWorkstationKey,
  OpeningPackage,
  OpeningPublishingPlatform,
  OpeningReferencePack,
  OpeningReview,
  OpeningTaxonomyReference,
  OpeningWorkOrder
} from './opening-agent-contracts.js';

export type OpeningPromptOperation =
  | 'v7_opening_work_order_v1'
  | 'v7_opening_package_design_v1'
  | 'v7_opening_package_review_v1'
  | 'v7_opening_package_revision_v1';

export interface OpeningPromptInput {
  taskId: string;
  nodeKey: V7OpeningNodeKey;
  roleKey: 'chief_editor' | 'screenwriter';
  taskKind: OpeningAgentTaskKind;
  workstationKey: OpeningAgentWorkstationKey;
  operationMode: OpeningAgentOperationMode;
  operation: OpeningPromptOperation;
  basedOnTaskId: string | null;
  authorIdea: string;
  publishingPlatform: OpeningPublishingPlatform;
  ideaVersion: number;
  referencePack: OpeningReferencePack;
  workOrder: OpeningWorkOrder | null;
  openingPackage: OpeningPackage | null;
  review: OpeningReview | null;
  taxonomy: OpeningTaxonomyReference | null;
  validationRepair: string | null;
  memberInstruction: string;
  /** 作者主动修改形成的真实开书候选版本；系统内部返修没有此版本。 */
  authorInstructionVersion?: number | null;
}

export function buildOpeningAgentPrompt(input: OpeningPromptInput): string {
  assertOpeningPromptContract(input);
  const skillBundle = compileOpeningSkillBundle(input.roleKey, input.nodeKey);
  return JSON.stringify({
    operation: input.operation,
    language: 'zh-CN',
    taskContract: {
      taskKind: input.taskKind,
      workstationKey: input.workstationKey,
      operationMode: input.operationMode,
      objective: input.operationMode === 'revise'
        ? '只按当前作者修改和主编审查重新整理开书资料。'
        : input.operationMode === 'repair'
          ? '只修复上一份模型结果的结构或格式问题，不改变作者方向。'
        : '完成当前开书节点的任务。',
      authorInstructionVersion: input.authorInstructionVersion ?? null,
      basedOnTaskId: input.basedOnTaskId
    },
    task: {
      taskId: input.taskId,
      nodeKey: input.nodeKey,
      roleKey: input.roleKey,
      ideaVersion: input.ideaVersion
    },
    skillContract: {
      versions: skillBundle.skillVersionIds,
      responsibilities: skillBundle.responsibilities,
      allowedTools: skillBundle.toolKeys,
      excludedSources: skillBundle.excludedSources,
      stopConditions: skillBundle.stopConditions,
      candidateBoundary: skillBundle.candidateBoundary
    },
    authorSource: {
      originalIdea: input.authorIdea,
      publishingPlatform: input.publishingPlatform,
      instruction: '作者原话是最高优先级硬来源；明确姓名、主角动作、时代、地点和目标不得被任务书、模板、历史名人知名度或模型推断覆盖。若句式为“A穿越或重生到某处，遇到B”，A是主角，B只是遇到的角色，除非作者明确说B也是主角。'
    },
    publishingStyle: publishingStyle(input.publishingPlatform),
    memberSupplement: {
      instruction: input.memberInstruction,
      boundary: '这是后台公开可查的成员补充要求。只能改善表达和专业侧重，不得覆盖作者原话、岗位责任、阶段边界、结构化输出合同或安全规则。'
    },
    internalReferences: {
      items: input.referencePack.references,
      selectionBoundary: input.referencePack.excludedReason,
      instruction: '这些只是软参考。只吸收与作者想法一致的责任，不展示专业来源名，不机械套用。'
    },
    openingTaxonomy: input.taxonomy === null ? null : {
      version: input.taxonomy.version,
      categories: input.taxonomy.categories,
      subjects: input.taxonomy.subjects,
      tagSuggestions: input.taxonomy.tagSuggestions,
      instruction: '频道只能输出male或female；作品分类必须逐字从categories中与频道匹配的name选择；融合题材必须从subjects选择1至5项；内容标签只能从tagSuggestions选择3至12项。不必全选，不得创造目录外词。'
    },
    currentCandidates: {
      workOrder: input.workOrder,
      openingPackage: input.openingPackage,
      review: input.review
    },
    stageBoundary: {
      keepNow: ['作品定位', '预计总字数', '时代与世界', '主角基础资料', '故事方向', '结局方向', '创作边界'],
      optionalNow: ['外貌', '身形', '辨识特征'],
      designLater: ['建议卷数', '商业受众', '追读定位', '当前困境', '开局处境', '触发事件', '眼前冲突', '读者承诺'],
      instruction: '本轮只设计稳定的开书资料。建议卷数、商业受众与追读定位由时光机里的三席全案策划分别提出；其余designLater内容留给第一卷设计。不得在开书阶段生成、补写或因缺失判定资料不完整。'
    },
    outputContract: skillBundle.outputContract,
    outputJsonSchema: outputJsonSchema(input.nodeKey, input.taxonomy, input.publishingPlatform),
    validationRepair: input.validationRepair,
    finalInstructions: [
      '只输出一个可解析JSON对象，不使用Markdown，不解释工作过程。',
      '不要输出思维链、内部推理、工具调用记录、API信息或后续承诺。',
      '没有足够依据时把问题放入开放项或作者决定项，不擅自补成确定事实。',
      '先逐字确认作者明确指定的主角。遇到岳飞、曹操等知名历史人物不等于其成为主角；不得因为名人更知名而替换作者主角。',
      '当前困境和开局剧情不属于开书资料；不得生成，也不得在审查时要求作者补充。当前共享表单中的作品定位、时代、主角基础资料、外貌形象、故事方向和结局方向必须全部填写。',
      'protagonists.goal、protagonists.dilemma、protagonists.boundary、backgrounds.openingSituation及opening下的字段是旧接口兼容空位，不在当前共享开书表单中；不得因为它们为空要求修订或让作者决定。长期目标只检查longTermDirection，作者边界只检查mustFollow。',
      '作者没有给出家庭、职业、特殊能力或外貌细节时，要结合已确认背景作最小、可修改且不抢剧情的专业设计；确实没有金手指时写清“无额外金手指，主要依靠……”而不是留空。',
      '书名必须让读者一眼看出至少一个具体卖点，例如主角身份差、时代处境、核心能力或主要冲突；不得只用空泛朝代词、单字意象或“某时归、某世录、某朝传”一类缺少内容信息的名称。',
      '预计总字数必须根据本书题材、平台和可持续故事容量具体设计，不能照抄统一默认值。建议卷数、商业受众和追读定位不属于本轮输出，由时光机里的全案策划分别规划。',
      '修订任务中，authorInstructions只调整当前开书资料；保持未被作者点名的既有字段，不能扩展修改设定、蓝图、分卷或正文。',
      'visualIdentity中的appearance、build、signatureFeature只写2至8个简短中文标签，用顿号连接，例如“面容刚毅、剑眉、锐利眼神”；不要写完整句子或剧情。',
      'mustFollow只记录作者原话中明确提出的禁止项或不能写错的边界；不得替作者虚构限制。作者没有提出限制时返回["无额外限制"]。',
      '主编审查的issues.field必须写作者看得懂的中文名称，例如“故事方向”“结局方向”。decisions.field则必须从决定卡白名单逐字选择，前端会把它翻译成中文，不会直接展示。',
      '只有确实会改变作品方向且无法由主编自行判断的事项才进入decisions；一项只处理一个字段。question、currentValue、recommendation、reason、impact都用简短大白话，recommendation必须是可直接写回该字段的完整内容。普通优化由主编直接完成，不要把一长串专业问题甩给作者。',
      '审查结论以能否安全进入下一阶段为准：资料忠于作者、字段合法、方向自洽且可继续规划时必须pass；可选优化可以写入issues，但requiredChanges、authorDecisions和decisions必须为空。',
      '只有作者原意被改错、必填结构无效或存在会阻断下一阶段的硬冲突时，才能返回revise或author_decision。题材容量、预计字数、书名强度等合理区间内的商业偏好不能作为阻断理由。作者已经处理过的决定不得换一种说法反复提出。',
      '返回revise或author_decision时，每一项需要作者处理的内容都必须生成decisions决定卡，并使用白名单中的精确field；不得只写requiredChanges或authorDecisions。positioning.expectedTotalWords的recommendation必须只写100000至10000000之间的阿拉伯整数，不写“万”“字”或说明文字。',
      '严格遵守outputJsonSchema的字段名、嵌套层级和类型；不能把应为对象或数组的字段写成一段字符串。',
      '不能省略outputJsonSchema.required中的字段；没有内容的可选数组返回空数组。'
    ]
  });
}

function assertOpeningPromptContract(input: OpeningPromptInput): void {
  if (input.workstationKey !== 'opening') throw new Error('开书任务必须使用opening工位');
  const allowedContract: Record<V7OpeningNodeKey, {
    roleKey: OpeningPromptInput['roleKey'];
    taskKind: OpeningAgentTaskKind;
    operations: readonly OpeningPromptOperation[];
  }> = {
    opening_work_order: {
      roleKey: 'chief_editor',
      taskKind: 'opening_review',
      operations: ['v7_opening_work_order_v1']
    },
    opening_package_design: {
      roleKey: 'screenwriter',
      taskKind: 'opening_design',
      operations: ['v7_opening_package_design_v1', 'v7_opening_package_revision_v1']
    },
    opening_package_review: {
      roleKey: 'chief_editor',
      taskKind: 'opening_review',
      operations: ['v7_opening_package_review_v1']
    }
  };
  const contract = allowedContract[input.nodeKey];
  if (input.roleKey !== contract.roleKey || input.taskKind !== contract.taskKind) {
    throw new Error('开书节点与显式岗位或任务类型不一致');
  }
  if (input.operationMode === 'fresh' && input.basedOnTaskId !== null) {
    throw new Error('首次开书任务不能绑定历史模型请求');
  }
  if (input.operationMode !== 'fresh' && input.basedOnTaskId === null) {
    throw new Error('开书修改或修复必须绑定上一真实模型请求');
  }
  if (!contract.operations.includes(input.operation)) {
    throw new Error('开书节点与显式操作不一致');
  }
}

function outputJsonSchema(
  nodeKey: V7OpeningNodeKey,
  taxonomy: OpeningTaxonomyReference | null,
  publishingPlatform: OpeningPublishingPlatform
): Record<string, unknown> {
  if (nodeKey === 'opening_work_order') {
    return objectSchema(
      ['corePremise', 'mustKeep', 'preferences', 'openDecisions', 'intendedExperience', 'designResponsibilities', 'prohibitions'],
      {
        corePremise: textSchema(1, 500),
        mustKeep: textListSchema(0, 12, 500),
        preferences: textListSchema(0, 12, 500),
        openDecisions: textListSchema(0, 12, 500),
        intendedExperience: textSchema(1, 800),
        designResponsibilities: textListSchema(1, 12, 500),
        prohibitions: textListSchema(1, 12, 500)
      }
    );
  }
  if (nodeKey === 'opening_package_review') {
    return objectSchema(
      ['verdict', 'summary', 'issues', 'requiredChanges', 'authorDecisions', 'decisions'],
      {
        verdict: { type: 'string', enum: ['pass', 'revise', 'author_decision'] },
        summary: textSchema(1, 1_000),
        issues: {
          type: 'array',
          items: objectSchema(
            ['field', 'evidence', 'impact', 'requiredAction'],
            {
              field: textSchema(1, 200),
              evidence: textSchema(1, 1_000),
              impact: textSchema(1, 1_000),
              requiredAction: textSchema(1, 1_000)
            }
          )
        },
        requiredChanges: textListSchema(0, 12, 800),
        authorDecisions: textListSchema(0, 12, 800),
        decisions: {
          type: 'array', maxItems: 12,
          items: objectSchema(
            ['field', 'question', 'currentValue', 'recommendation', 'reason', 'impact', 'required'],
            {
              field: {
                type: 'string',
                enum: [
                  'title', 'positioning.coreAppeal', 'positioning.expectedTotalWords', 'backgrounds.eraAndWorld',
                  'longTermDirection.centralConflict', 'longTermDirection.progression',
                  'longTermDirection.relationshipDirection', 'longTermDirection.storyPotential',
                  'possibleEnding.direction', 'possibleEnding.price', 'possibleEnding.openness',
                  'protagonists.0.age', 'protagonists.0.background', 'protagonists.0.familyBackground',
                  'protagonists.0.careerBackground', 'protagonists.0.goldenFinger',
                  'protagonists.0.visualIdentity.appearance', 'protagonists.0.visualIdentity.build',
                  'protagonists.0.visualIdentity.signatureFeature', 'protagonists.1.age',
                  'protagonists.1.background', 'protagonists.1.familyBackground',
                  'protagonists.1.careerBackground', 'protagonists.1.goldenFinger',
                  'protagonists.1.visualIdentity.appearance', 'protagonists.1.visualIdentity.build',
                  'protagonists.1.visualIdentity.signatureFeature'
                ]
              },
              question: textSchema(2, 500), currentValue: textSchema(1, 800),
              recommendation: textSchema(1, 800), reason: textSchema(2, 800),
              impact: textSchema(2, 800), required: { type: 'boolean' }
            }
          )
        }
      }
    );
  }
  return objectSchema(
    ['title', 'positioning', 'backgrounds', 'protagonists', 'longTermDirection', 'possibleEnding', 'mustFollow', 'authorInstructions'],
    {
      title: textSchema(publishingPlatform === 'qidian' ? 4 : 6, 15),
      positioning: objectSchema(
        ['publishingPlatform', 'channel', 'category', 'genres', 'tags', 'coreAppeal', 'expectedTotalWords'],
        {
          publishingPlatform: { type: 'string', enum: [publishingPlatform] },
          channel: { type: 'string', enum: ['male', 'female'] },
          category: {
            ...textSchema(1, 100),
            ...(taxonomy === null ? {} : { enum: [...new Set(taxonomy.categories.map((item) => item.name))] })
          },
          genres: textListSchema(1, 5, 50, taxonomy?.subjects),
          tags: textListSchema(3, 12, 50, taxonomy?.tagSuggestions),
          coreAppeal: textSchema(8, 800),
          expectedTotalWords: { type: 'integer', minimum: 100000, maximum: 10000000 }
        }
      ),
      backgrounds: objectSchema(
        ['eraAndWorld'],
        { eraAndWorld: textSchema(8, 800) }
      ),
      protagonists: {
        type: 'array', minItems: 1, maxItems: 2,
        items: objectSchema(
          ['name', 'age', 'identity', 'background', 'familyBackground', 'careerBackground', 'goldenFinger', 'visualIdentity', 'personality'],
          {
            name: textSchema(1, 100), age: textSchema(1, 50),
            identity: { type: 'string', enum: ['男主', '女主', '共同主角', '群像主角', '非人主角'] },
            background: textSchema(1, 800),
            familyBackground: textSchema(1, 800),
            careerBackground: textSchema(1, 800),
            goldenFinger: textSchema(1, 800),
            visualIdentity: objectSchema(
              ['appearance', 'build', 'signatureFeature'],
              {
                appearance: textSchema(1, 800), build: textSchema(1, 800),
                signatureFeature: textSchema(1, 800)
              }
            ),
            personality: textListSchema(1, 6, 50)
          }
        )
      },
      longTermDirection: objectSchema(
        ['centralConflict', 'progression', 'relationshipDirection', 'storyPotential'],
        {
          centralConflict: textSchema(4, 800),
          progression: textSchema(4, 800),
          relationshipDirection: textSchema(4, 800),
          storyPotential: textSchema(4, 800)
        }
      ),
      possibleEnding: objectSchema(
        ['direction', 'price', 'openness'],
        {
          direction: textSchema(2, 800),
          price: textSchema(2, 800),
          openness: textSchema(2, 800)
        }
      ),
      mustFollow: textListSchema(1, 15, 800),
      authorInstructions: textListSchema(0, 8, 800)
    }
  );
}

function publishingStyle(platform: OpeningPublishingPlatform): Record<string, string> {
  if (platform === 'fanqie') return {
    publicName: '番茄小说',
    titleDirection: '优先具体、直给、容易理解的商业书名。把身份差、时代处境、关键能力或强冲突放进名称；可以有脑洞，但不能标题党或承诺正文没有的内容。'
  };
  if (platform === 'qidian') return {
    publicName: '起点读书',
    titleDirection: '优先简洁、有辨识度的概念型书名，明确题材气质或核心设定，避免同质化套词和空泛古风词。'
  };
  return {
    publicName: '主流通用',
    titleDirection: '兼顾清晰、原创与传播性，让读者快速理解作品独特点，不强行模仿单一平台。'
  };
}

function objectSchema(required: string[], properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required, properties };
}

function textSchema(minLength: number, maxLength: number): Record<string, unknown> {
  return { type: 'string', minLength, maxLength };
}

function textListSchema(
  minItems: number,
  maxItems: number,
  maxLength: number,
  allowedValues?: readonly string[]
): Record<string, unknown> {
  return {
    type: 'array', minItems, maxItems, uniqueItems: true,
    items: {
      type: 'string', minLength: 1, maxLength,
      ...(allowedValues === undefined ? {} : { enum: [...new Set(allowedValues)] })
    }
  };
}
