/** Small deterministic model response for transport tests, not a semantic implementation. */
export function evidenceFixtureAnswer(prompt: string): string {
  const entries = JSON.parse(prompt.split('可选原文：')[1]!.split('\n')[0]!) as Array<{ id: number; source: number; path: string; text: string }>;
  const previous = JSON.parse(prompt.split('此前必须保留编号：')[1]!.split('\n')[0]!) as number[];
  const keys = new Map<number, number>();
  for (const entry of entries) if (!keys.has(entry.source)) keys.set(entry.source, entry.id);
  const keepIds = [...new Set([...previous, ...keys.values(),
    ...entries.filter((entry) => entry.text.includes('必须在开场坦白') || entry.text.includes('不得提前开启')).map((entry) => entry.id)])];
  return JSON.stringify({ keepIds, essentialIds: keepIds });
}
