import type { V7WriterProposal } from './setting-agent-contracts.js';

export const SETTING_CONCISE_INSTRUCTION = '直接交付必要规则，用简洁大白话，每条只表达一个独立意思。短规则两三句即可，复杂机制可展开或拆为多条规则，不能因篇幅丢失条件、例外、限制、代价和精确数值。不写教学说明、剧情推演、凑字空话或重复其他主题的事实。已有规则引用而不重复改写。检索摘要只帮助查找，不能代替规则；事实必须来自完整规则。审查应检查必要性、重复和关键条件，不以统一字数判质量。';

/** A bounded repair signal, not a truncator. Existing accepted versions use their original parser. */
export function assertConciseSetting(proposal: V7WriterProposal): void {
  const count = (text: string) => Array.from(text).length;
  const facts = proposal.factEntries ?? [];
  if (!proposal.content.trim() || count(proposal.content) > 12_000
    || facts.reduce((sum, fact) => sum + count(fact), 0) > 24_000) {
    throw new Error('设定交付为空或超出单次传输容量，请拆分独立机制，保留条件、例外、代价和数值；不得截断后当作完整结果。');
  }
}
