import { createHash } from 'node:crypto';
import type { PositioningField, PositioningTag } from '../../domain/positioning.js';

export interface AdaptationRules {
  genre: string;
  qualityWeights: Record<string, number>;
  specialistRoles: string[];
  schemaModules: string[];
  suppressedGenericRules: string[];
}

export function buildAdaptationRules(fields: PositioningField[], tags: PositioningTag[]): AdaptationRules {
  const genre = String(fields.find((field) => field.key === 'genre')?.value ?? tags.find((tag) => tag.category === 'genre')?.name ?? '通用');
  const base = { plot: 25, character: 20, prose: 15, emotion: 15, continuity: 15, hook: 10 };
  if (genre === '历史') return { genre, qualityWeights: { ...base, continuity: 25, plot: 20, prose: 10 }, specialistRoles: ['role-researcher', 'role-copyright'], schemaModules: ['historical_timeline', 'source_evidence'], suppressedGenericRules: ['现代口语默认'] };
  if (genre === '游戏') return { genre, qualityWeights: { ...base, plot: 20, hook: 20 }, specialistRoles: ['role-reader-experience', 'role-continuity'], schemaModules: ['stats', 'skills', 'equipment', 'quests'], suppressedGenericRules: ['现实物理唯一尺度'] };
  if (genre === '悬疑') return { genre, qualityWeights: { ...base, plot: 30, continuity: 25, hook: 15 }, specialistRoles: ['role-continuity', 'role-reader-experience'], schemaModules: ['clues', 'knowledge_gaps', 'suspects'], suppressedGenericRules: ['过早解释谜底'] };
  return { genre, qualityWeights: base, specialistRoles: ['role-reader-experience'], schemaModules: ['generic_story'], suppressedGenericRules: [] };
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

