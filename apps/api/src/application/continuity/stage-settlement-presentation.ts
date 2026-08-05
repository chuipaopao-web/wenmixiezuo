interface StageSettlementLike {
  stageKey: string;
  chapterStart: number;
  chapterEnd: number;
  payload: {
    irreversibleResults?: unknown;
    openThreads?: unknown;
  };
}

export function stageTitleFromKey(stageKey: string): string {
  const match = stageKey.match(/^story-arc:\d+-\d+:(.+)$/u);
  return match?.[1]?.trim() || '已完成剧情阶段';
}

export function stageResultSummary(value: unknown, maximum = 360): string | null {
  if (!Array.isArray(value)) return null;
  const candidates = value.flatMap((item, index) => {
    if (typeof item === 'string') return [{ text: item, score: 1, index }];
    if (item === null || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const text = readableText(record.value ?? record.summary ?? record.description ?? record.title, 180);
    if (text === null || /^(?:true|false|[+-]?\d+)$/iu.test(text)) return [];
    const relation = typeof record.relationKey === 'string' ? record.relationKey : '';
    const score = /protagonist_(?:state|delta)|人物|角色|relationship/iu.test(relation) ? 5
      : /result|outcome|status|状态|结局/iu.test(relation) ? 4
        : /rule|constraint|规则|resource|item|资源|持有/iu.test(relation) ? 3
          : 1;
    return [{ text, score, index }];
  });
  const selected = [...candidates]
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .filter((candidate, index, all) => all.findIndex((other) => other.text === candidate.text) === index)
    .slice(0, 4)
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.text.replace(/[。；\s]+$/u, '').trim())
    .filter(Boolean);
  if (selected.length === 0) return null;
  const summary = `${selected.join('；')}。`;
  return summary.length <= maximum ? summary : `${summary.slice(0, Math.max(1, maximum - 2))}……`;
}

export function compactStageSettlementContext(settlements: StageSettlementLike[], maximum = 600): string {
  const lines = settlements.map((settlement) => {
    const title = stageTitleFromKey(settlement.stageKey);
    const result = stageResultSummary(settlement.payload.irreversibleResults, 300);
    const openCount = Array.isArray(settlement.payload.openThreads) ? settlement.payload.openThreads.length : 0;
    return [
      `已定稿阶段《${title}》（第${settlement.chapterStart}—${settlement.chapterEnd}章）`,
      result === null ? null : `关键变化：${result}`,
      openCount > 0 ? `仍有${openCount}项开放线索，触发时按来源回查正史。` : '没有登记为开放状态的阶段线索。'
    ].filter((line): line is string => line !== null).join('\n');
  }).join('\n\n');
  return lines.length <= maximum ? lines : `${lines.slice(0, Math.max(1, maximum - 2))}……`;
}

function readableText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 2))}……`;
}
