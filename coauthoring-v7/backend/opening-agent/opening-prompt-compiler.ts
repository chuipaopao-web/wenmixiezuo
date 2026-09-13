import { creativeDirective, type CreativeProfile } from '@wenmi/agent-catalog';
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
  OpeningTaxonomyReference
} from './opening-agent-contracts.js';

export type OpeningPromptOperation =
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
  creativeProfile?: CreativeProfile | undefined;
  publishingPlatform: OpeningPublishingPlatform;
  ideaVersion: number;
  referencePack: OpeningReferencePack;
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
      candidateBoundary: skillBundle.candidateBoundary
    },
    authorSource: {
      originalIdea: input.authorIdea,
      publishingPlatform: input.publishingPlatform,
      instruction: '作者原话是最高优先级硬来源；明确姓名、主角动作、时代、地点和目标不得被任务书、模板、历史名人知名度或模型推断覆盖。若句式为“A穿越或重生到某处，遇到B”，A是主角，B只是遇到的角色，除非作者明确说B也是主角。'
    },
    authorAdjustment: {
      instructions: input.openingPackage?.authorInstructions ?? [],
      instruction: '这些是作者后续明确提出的调整意见，优先于最初想法中被明确修改的同一内容；未涉及的原始要求继续保留。设计成员据此修订，主编按修订后的作者意图审查，不得以旧想法否决作者的新决定。'
    },
    creativeDirection: creativeDirective(input.creativeProfile, 'opening'),
    creativeAssets: null, // New runtime supplies only selected, versioned references.
    publishingStyle: publishingStyle(input.publishingPlatform),
    memberSupplement: {
      instruction: input.memberInstruction,
      boundary: '这是后台公开可查的成员补充要求。只能改善表达和专业侧重，不得覆盖作者原话、岗位责任、阶段边界、结构化输出合同或安全规则。'
    },
    internalReferences: null, // The shared runtime supplies released references; no second legacy catalogue.
    openingTaxonomy: input.taxonomy === null ? null : {
      version: input.taxonomy.version,
      categories: {
        male: input.taxonomy.categories.filter(c=>c.channel==='male').map(c=>c.name),
        female: input.taxonomy.categories.filter(c=>c.channel==='female').map(c=>c.name)
      },
      subjects: input.taxonomy.subjects,
      tagSuggestions: input.taxonomy.tagSuggestions,
      instruction: '频道只能输出male或female；作品分类必须逐字从categories对应频道数组选择；融合题材从subjects选择1至5项；标签从tagSuggestions选择3至12项。不得创造目录外词。'
    },
    currentCandidates: {
      openingPackage: input.openingPackage === null ? null : {...input.openingPackage,authorInstructions:undefined},
      review: input.review === null ? null : {
        verdict: input.review.verdict,
        summary: input.review.summary,
        issues: input.review.issues,
        requiredChanges: input.review.requiredChanges,
        // Resolved author decisions are carried once in authorAdjustment.
      }
    },
    stageBoundary: {
      keepNow: ['作品定位', '核心卖点', '阅读味道', '预计总字数', '时代与世界', '主角基础资料', '故事方向', '结局方向', '创作边界'],
      optionalNow: ['外貌', '身形', '辨识特征'],
      designLater: ['建议卷数', '商业受众', '追读定位', '当前困境', '开局处境', '触发事件', '眼前冲突', '读者承诺'],
      instruction: '本轮只设计稳定的开书资料。建议卷数、商业受众与追读定位由时光机里的三席全案策划分别提出；其余designLater内容留给第一卷设计。不得在开书阶段生成、补写或因缺失判定资料不完整。'
    },
    outputTemplate: schemaTemplate(outputJsonSchema(input.nodeKey, input.taxonomy, input.publishingPlatform)),
    validationRepair: input.validationRepair,
    finalInstructions: [
      '按outputTemplate字段、嵌套及类型输出JSON；模板的字符串是类型约束，不是正文。不省略必填字段，不增加字段；可选标记不写入字段名。不输出思维链、内部过程、工具协议或后续承诺。',
      '作者后续明确调整优先；保留其余原意与主角身份，不因遇见历史名人就替换主角。未指定的家庭、职业、能力、外貌由成员提出候选，不冒充确认事实；修订只改作者指出的字段。',
      '填写稳定开书资料：定位、时代、主角基础与外貌、故事方向、结局方向。designLater留待后续，不生成或以缺失阻断。旧兼容空位goal/dilemma/boundary/openingSituation/opening不必补写；长期目标看longTermDirection，边界看mustFollow。',
      '卖点写具体身份、能力、关系或处境的吸引力，味道说明阅读体验。服从作者尺度；职业只是入口，开局弱不等于永远弱。可设计金手指，不默认附加代价、冷却、禁止成长、爱情或争霸。题材常见写法只是参考。',
      '书名参考所选平台商业表达，呈现本书具体卖点。番茄可用口语、反差、行动、短句或冒号，不套统一格式、不仿写已有书名、不编造系统无敌等承诺。总字数按题材与容量设计，不照抄默认值。',
      'visualIdentity三项各写2至8个简短标签，以顿号连接；不写剧情句。mustFollow只记作者明确边界，无限制时返回["无额外限制"]。',
      '审查检查原意、字段合法性、事实硬冲突、卖点具体性和味道是否符合作者尺度；文学偏好不得冒充错误。可继续规划时pass，可选建议写issues，requiredChanges/authorDecisions/decisions为空；不因缺少感情、战争、牺牲等模板阻断。',
      '只有原意被改错、必填结构无效或姓名身份等硬冲突才revise/author_decision。普通优化主编自行处理，不重复已解决决定。issues.field用中文；decisions.field严格用白名单，每项一个字段，recommendation可完整写回，其他说明简短。',
      '需要作者处理的revise/author_decision必须给决定卡，不能只写requiredChanges；字数建议只写100000至10000000之间整数。保持未被点名的既有字段，不改后续设定或正文。'
    ]
  });
}

/** Compact output shape; field constraints remain exact and server validation is unchanged. */
function schemaTemplate(schema: Record<string, unknown>): unknown {
  if(schema.type==='object'){
    const properties=schema.properties as Record<string,Record<string,unknown>>;
    return Object.fromEntries(Object.entries(properties).map(([key,value])=>[
      (schema.required as string[]).includes(key)?key:key+'（可选）',schemaTemplate(value)
    ]));
  }
  if(schema.type==='array')return {数组元素:schemaTemplate(schema.items as Record<string,unknown>),数量:[schema.minItems??0,schema.maxItems??'不限']};
  if(schema.enum)return {枚举:schema.enum};
  if(schema.type==='integer')return '整数 '+schema.minimum+'至'+schema.maximum;
  if(schema.type==='boolean')return '布尔值';
  return '字符串 '+schema.minLength+'至'+schema.maxLength+'字'+(schema.description?'；'+schema.description:'');
}

function assertOpeningPromptContract(input: OpeningPromptInput): void {
  if (input.workstationKey !== 'opening') throw new Error('开书任务必须使用opening工位');
  const allowedContract: Record<V7OpeningNodeKey, {
    roleKey: OpeningPromptInput['roleKey'];
    taskKind: OpeningAgentTaskKind;
    operations: readonly OpeningPromptOperation[];
  }> = {
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
                  'title', 'positioning.coreAppeal', 'positioning.readingTone', 'positioning.expectedTotalWords', 'backgrounds.eraAndWorld',
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
        ['publishingPlatform', 'channel', 'category', 'genres', 'tags', 'coreAppeal', 'readingTone', 'expectedTotalWords'],
        {
          publishingPlatform: { type: 'string', enum: [publishingPlatform] },
          channel: { type: 'string', enum: ['male', 'female'] },
          category: {
            ...textSchema(1, 100),
            description: '从openingTaxonomy.categories选择与channel匹配的name'
          },
          genres: {...textListSchema(1, 5, 50),description:'值须来自openingTaxonomy.subjects'},
          tags: {...textListSchema(3, 12, 50),description:'值须来自openingTaxonomy.tagSuggestions'},
          coreAppeal: textSchema(8, 800),
          // R208：新AI开书要求输出阅读味道短句（1—300字符）。
          readingTone: textSchema(1, 300),
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
      authorInstructions: textListSchema(0, 8, 2_000)
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
