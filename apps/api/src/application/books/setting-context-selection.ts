export type SettingSelectionFact = { id: string; itemKey: string; label: string; authority: string; text: string };

export class SettingContextPreparationError extends Error {}

// Real Chinese selection calls used more tokens than the legacy char/2.5 estimate.
// Keep substantial headroom for governance, serialization and the model response.
export const SETTING_SELECTION_PROMPT_LIMIT = 18_000;

export function settingOpeningSelection(text: string, required: readonly string[] = []): { prefix: string; anchor: string; facts: SettingSelectionFact[] } {
  if (Array.from(text).length <= 4_000) return { prefix: text, anchor: text, facts: [] };
  const anchor = [...new Set(required.map(part => part.trim()).filter(Boolean))].join(' · ');
  // Split only at the profile's field separator, never in the middle of a rule.
  return { anchor, prefix: `${anchor}\n其余开书资料见分页事实；必须选入当前主题依赖的完整背景与例外。`,
    facts: text.split(' · ').filter(part => part.trim() && !required.includes(part)).map((part, index) => ({
      id: `opening:${index}`, itemKey: '__opening__', label: '已确认开书资料', authority: 'confirmed', text: part
    })) };
}

export function settingSelectionPages(facts: readonly SettingSelectionFact[], prefix: string): SettingSelectionFact[][] {
  const pages: SettingSelectionFact[][] = [];
  let page: SettingSelectionFact[] = [];
  for (const fact of facts) {
    if (Array.from(settingSelectionPrompt(prefix, [fact])).length > SETTING_SELECTION_PROMPT_LIMIT) {
      throw new SettingContextPreparationError('单条设定或开书资料过长，无法完整整理；已保存内容保留，请精简该条后继续。');
    }
    if (Array.from(settingSelectionPrompt(prefix, [...page, fact])).length > SETTING_SELECTION_PROMPT_LIMIT) {
      pages.push(page); page = [];
    }
    page.push(fact);
  }
  if (page.length) pages.push(page);
  if (pages.length > 16) throw new SettingContextPreparationError('待整理资料过多，已保留现有结果，请缩小本次设计范围。');
  return pages;
}

export function settingSelectionPrompt(prefix: string, facts: readonly SettingSelectionFact[]): string {
  return `${prefix}\n【可选事实】${JSON.stringify(facts)}\n只返回JSON：{"selectedFactIds":["0:0"],"blocked":false}。本页无相关事实可返回空数组；不要选择本页不存在的ID。`;
}

export async function selectSettingContext<T>(input: {
  facts: readonly SettingSelectionFact[];
  prefix: string;
  select: (prompt: string, round: number, page: number) => Promise<string>;
  build: (ids: ReadonlySet<string>) => T;
}): Promise<T> {
  let facts = [...input.facts];
  for (let round = 0; round < 3; round++) {
    const pages = settingSelectionPages(facts, input.prefix);
    const selected = new Set<string>();
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]!;
      const raw = await input.select(settingSelectionPrompt(input.prefix, page), round, index);
      const value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/u, '').replace(/\s*```\s*$/u, '')) as { selectedFactIds?: unknown; blocked?: boolean };
      if (value.blocked || !Array.isArray(value.selectedFactIds)) throw new SettingContextPreparationError('必要资料尚未整理完整，已完成设定已保留。');
      for (const id of value.selectedFactIds) {
        if (typeof id !== 'string' || !page.some(fact => fact.id === id)) throw new Error('资料整理引用了本页不存在的事实');
        selected.add(id);
      }
    }
    try { return input.build(selected); }
    catch (error) {
      // Reconsider the union semantically; never truncate an original fact to fit.
      if (selected.size >= facts.length || round === 2) throw new SettingContextPreparationError('必要资料仍超过本轮容量，已完成设定已保留，请缩小本次设计范围。');
      facts = facts.filter(fact => selected.has(fact.id));
    }
  }
  throw new SettingContextPreparationError('资料整理未完成。');
}
