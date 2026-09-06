import type { V7WriterProposal } from './setting-agent-contracts.js';

export const SETTING_CONCISE_INSTRUCTION = '普通条目目标150至300字；复杂规则可适当增加，但最终设定不超过600字。直接写结论，适合时用短句分点；保留条件、例外、限制、代价和精确数值。不要写教学说明、剧情示例或重复其他条目的事实；不为凑字数补内容。contextSummary不超过100字，factEntries至多12条、合计不超过500字，只摘录本条内容中需要记住的事实，不重复摘要；设计理由只需一句话。';

/** A bounded repair signal, not a truncator. Existing accepted versions use their original parser. */
export function assertConciseSetting(proposal: V7WriterProposal): void {
  const count = (text: string) => Array.from(text).length;
  const facts = proposal.factEntries ?? [];
  if (count(proposal.content) > 600 || count(proposal.contextSummary ?? '') > 100
    || facts.length > 12 || facts.reduce((sum, fact) => sum + count(fact), 0) > 500) {
    throw new Error('设定需精简：正文不超过600字、检索摘要100字、事实最多12条且合计500字；保留条件、例外、代价和数值，不截断事实。');
  }
}
