export interface WriterSettingItem {
  itemKey: string;
  label: string;
  content: string;
}

export interface WriterSettingContext {
  hardItems: WriterSettingItem[];
  deferredCatalog: Array<Pick<WriterSettingItem, 'itemKey' | 'label'>>;
}

const CORE_SETTING_KEYS = new Set([
  'world-stage',
  'protagonist-situation',
  'rules-costs',
  'boundaries-blanks'
]);

const COMMON_GRAMS = new Set([
  '本章', '人物', '主角', '故事', '当前', '一个', '这个', '必须', '不能', '需要', '可以', '发生', '什么',
  '开始', '结束', '状态', '行动', '结果', '变化', '写作', '章节', '事件', '设定', '作者', '读者'
]);

export function compileWriterSettingContext(
  items: WriterSettingItem[],
  query: string
): WriterSettingContext {
  const unique = [...new Map(items
    .filter((item) => item.content.trim().length > 0)
    .map((item) => [item.itemKey, { ...item, content: item.content.trim() }])).values()];
  const core = unique.filter((item) => CORE_SETTING_KEYS.has(item.itemKey));
  const ranked = unique
    .filter((item) => !CORE_SETTING_KEYS.has(item.itemKey))
    .map((item) => ({ item, score: relevanceScore(item, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.item.itemKey.localeCompare(right.item.itemKey, 'zh-CN'))
    .slice(0, 4)
    .map(({ item }) => item);
  const hardIds = new Set([...core, ...ranked].map((item) => item.itemKey));
  return {
    hardItems: [...core, ...ranked],
    deferredCatalog: unique
      .filter((item) => !hardIds.has(item.itemKey))
      .map(({ itemKey, label }) => ({ itemKey, label }))
  };
}

function relevanceScore(item: WriterSettingItem, query: string): number {
  const normalizedQuery = query.toLocaleLowerCase('zh-CN');
  const label = item.label.toLocaleLowerCase('zh-CN').trim();
  const itemKey = item.itemKey.toLocaleLowerCase('zh-CN').trim();
  let score = (label.length > 0 && normalizedQuery.includes(label) ? 100 : 0)
    + (itemKey.length > 0 && normalizedQuery.includes(itemKey) ? 80 : 0);
  const haystack = `${item.label}\n${item.content}`.toLocaleLowerCase('zh-CN');
  for (const gram of queryNgrams(normalizedQuery)) {
    if (haystack.includes(gram)) score += gram.length;
  }
  return score;
}

function queryNgrams(query: string): Set<string> {
  const grams = new Set<string>();
  const tokens = query.split(/[^\p{L}\p{N}]+/gu).filter((token) => token.length >= 2);
  for (const token of tokens) {
    for (const size of [4, 3, 2]) {
      for (let index = 0; index <= token.length - size; index += 1) {
        const gram = token.slice(index, index + size);
        if (!COMMON_GRAMS.has(gram)) grams.add(gram);
        if (grams.size >= 800) return grams;
      }
    }
  }
  return grams;
}
