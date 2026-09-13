/** 合成样例：方法卡与参考卡payload（内容为编辑性合成，不代表已审核内容）。 */
import type { CardPayload, LegacyRef } from '../../../apps/api/src/application/creative-reference/types.js';

export function methodPayload(overrides: Partial<{ name: string; shortPhrase: string; summary: string; instruction: string; usageTree: string }> = {}): CardPayload {
  return {
    assetKind: 'method',
    name: overrides.name ?? '起承转合',
    shortPhrase: overrides.shortPhrase ?? '四段推进',
    summary: overrides.summary ?? '建立处境—展开发展—关键转向—收束回应。',
    aliases: [],
    method: {
      title: overrides.name ?? '起承转合',
      instruction: overrides.instruction ?? '建立处境—展开发展—关键转向—收束回应。',
      boundary: '需要组织处境、发展、关键转向和阶段收束。',
      usageTree: overrides.usageTree ?? '结构与节奏',
      applicableLayers: ['book_backbone', 'volume'],
      aliases: []
    }
  };
}

export function referencePayload(overrides: Partial<{ name: string; shortPhrase: string; summary: string }> = {}): CardPayload {
  return {
    assetKind: 'reference',
    name: overrides.name ?? '三国·小人物进入大局',
    shortPhrase: overrides.shortPhrase ?? '小人物入局',
    summary: overrides.summary ?? '独特本领改变人物关系与局部局势。',
    aliases: [],
    reference: {
      kind: 'genre',
      facets: { genres: ['历史脑洞'], mechanisms: ['职业跨界'], experiences: ['反差'], purposes: ['发展空间'] },
      stages: ['opening'],
      useWhen: ['原始身份有趣却容易重复营生'],
      questions: ['最初靠什么行动被看见？'],
      possibilities: ['技艺→人物接触→信任'],
      imbalanceChecks: ['不强制逐级升官'],
      examples: [{ premise: '厨师用宴席接触将领', direction: '参与军粮组织', boundary: '作者只想温暖小店时不套战争' }],
      relatedCards: [],
      methodRefs: [],
      evidence: { kind: 'editorial_heuristic', refs: ['编辑假设'], limitations: '示例为合成内容' }
    }
  };
}

export const legacyFourAct: LegacyRef = { namespace: 'audited-v4', key: 'four-act' };
export const legacyFourActComplete: LegacyRef = { namespace: 'complete-v3', key: 'four-act' };
