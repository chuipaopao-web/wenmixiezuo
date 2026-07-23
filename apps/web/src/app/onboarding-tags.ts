import type { OpeningChannel, OpeningTaxonomyData } from '../lib/api/client';

/**
 * 兼容旧前端导入点。开书分类与标签的唯一数据源已经迁移到
 * GET /api/v1/opening-taxonomy；这里不得再维护第二份静态目录。
 */
export type BookChannel = OpeningChannel;

export function categoriesForChannel(taxonomy: OpeningTaxonomyData, channel: OpeningChannel) {
  return taxonomy.categories.filter((category) => category.channel === channel);
}
