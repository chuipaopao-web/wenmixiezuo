import { OPENING_TAXONOMY } from '../contracts/opening-blueprint.js';

/**
 * 题材简报层：岗位身份不变，但每个创作岗位的提示词都自动带上本书题材定位。
 * 简报只来自作者已经确认的开书信息；解析失败时返回 null，由调用方省略该段，
 * 绝不用猜测的题材冒充作者选择。
 */
export function buildGenreBrief(openingContentJson: string | null | undefined): string | null {
  if (openingContentJson === null || openingContentJson === undefined) return null;
  let content: unknown;
  try {
    content = JSON.parse(openingContentJson) as unknown;
  } catch {
    return null;
  }
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const record = content as Record<string, unknown>;
  const channel = record.channel === 'male' ? '男频' : record.channel === 'female' ? '女频' : null;
  const category = typeof record.categoryKey === 'string'
    ? OPENING_TAXONOMY.categories.find((item) => item.key === record.categoryKey)
    : undefined;
  if (channel === null || category === undefined) return null;
  const parts: string[] = [`${channel} · ${category.name}（${category.description}）`];
  const auxiliaryKeys = Array.isArray(record.auxiliaryCategoryKeys) ? record.auxiliaryCategoryKeys : [];
  const auxiliaryNames = auxiliaryKeys
    .map((key) => OPENING_TAXONOMY.categories.find((item) => item.key === key)?.name)
    .filter((name): name is string => typeof name === 'string');
  const subjects = textList(record.auxiliaryTags).filter((tag) => !auxiliaryNames.includes(tag));
  const fused = [...new Set([...auxiliaryNames, ...subjects])];
  if (fused.length > 0) parts.push(`融合题材：${fused.join('、')}`);
  const mainTags = textList(record.mainTags);
  if (mainTags.length > 0) parts.push(`主要标签：${mainTags.join('、')}`);
  const traits = textList(record.storyTraits);
  if (traits.length > 0) parts.push(`全书特点：${traits.join('、')}`);
  const tones = [record.stylePrimary, record.styleSecondary]
    .filter((tone): tone is string => typeof tone === 'string' && tone.trim().length > 0);
  if (tones.length > 0) parts.push(`基调：${tones.join('＋')}`);
  const styleIntent = typeof record.styleIntent === 'object' && record.styleIntent !== null
    ? record.styleIntent as Record<string, unknown>
    : null;
  const pacing = styleIntent === null ? [] : textList(styleIntent.pacingAndPayoff);
  if (pacing.length > 0) parts.push(`节奏策略：${pacing.join('、')}`);
  if (typeof record.targetAudience === 'string' && record.targetAudience.trim().length > 0) {
    parts.push(`目标读者：${record.targetAudience.trim()}`);
  }
  return [
    `本书题材简报：${parts.join('；')}。`,
    '所有建议、方案和评价都必须贴合上述题材定位与基调；可以参考其他题材的手法，但成果必须仍然是这个题材读者愿意追读的故事。'
  ].join('\n');
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim()))];
}
