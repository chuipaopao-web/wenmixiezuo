import { buildNarrativeMethodPack } from '../narrative-methods/narrative-method-recommender.js';
import {
  GENRE_FAMILIES,
  V7_PLOT_PATTERN_LIBRARY_VERSION,
  type GenreFamily
} from '../plot-patterns/plot-pattern-library.js';
import { recommendPlotRecipes } from '../plot-patterns/plot-pattern-recommender.js';
import type { OpeningInternalReference, OpeningReferencePack } from './opening-agent-contracts.js';

export const V7_OPENING_REFERENCE_LIMIT = 6;

export function buildOpeningReferencePack(authorIdea: string): OpeningReferencePack {
  const idea = authorIdea.trim();
  if (idea.length === 0) throw new Error('开书想法不能为空');
  const narrative = buildNarrativeMethodPack({
    task: 'book_blueprint',
    signalText: idea,
    maxMethods: 3
  });
  const narrativeReferences: OpeningInternalReference[] = narrative.methodReferences.map((item, index) => ({
    source: 'narrative_method',
    sourceKey: item.key,
    libraryVersion: narrative.libraryVersion,
    responsibility: narrative.authorGuidance[index]
      ?? narrative.generationInstructions[index]
      ?? '保持完整因果、人物变化和持续阅读动力。',
    risk: narrative.guardrails[index] ?? '不要为了结构整齐机械打卡，也不要把未来规划写成已经发生。'
  }));
  const genreFamilies = inferGenreFamilies(idea);
  // 开书原话允许非常模糊。题材尚未识别时只给通用认知方法，不强猜题材，
  // 也不让“剧情配方必须有题材家族”成为成员开始工作的前置门槛。
  const plotReferences = genreFamilies.length === 0 ? [] : recommendPlotRecipes({
    taskId: 'opening-reference-preview',
    scope: 'volume',
    genreFamilies,
    currentGoal: idea,
    authorIdeas: idea,
    requestedUnitCount: 5,
    complexity: 'standard'
  }, 3).map((item): OpeningInternalReference => ({
    source: 'plot_recipe',
    sourceKey: item.recipeKey,
    libraryVersion: V7_PLOT_PATTERN_LIBRARY_VERSION,
    responsibility: `${item.publicExplanation}；${item.reason}`,
    risk: '这里只参考长期可持续的剧情效果，不预先生成具体分卷、事件或固定单元。'
  }));
  return {
    references: [...narrativeReferences, ...plotReferences].slice(0, V7_OPENING_REFERENCE_LIMIT),
    excludedReason: '只选当前开书任务最相关的少量责任；整库、专业术语和无关模板均排除。'
  };
}

export function inferGenreFamilies(authorIdea: string): GenreFamily[] {
  const normalized = authorIdea.toLocaleLowerCase('zh-CN');
  const matched = GENRE_FAMILIES.filter((genre) => genre.includes.some((signal) => (
    normalized.includes(signal.toLocaleLowerCase('zh-CN'))
  ))).map((genre) => genre.key);
  if (/三国|秦汉|唐朝|宋朝|明朝|清朝|古代/u.test(normalized)) matched.push('historical');
  if (/穿越.*(?:朝代|三国|秦|汉|唐|宋|明|清)|架空王朝/u.test(normalized)) matched.push('alternate_history');
  return [...new Set(matched)].slice(0, 4);
}
