import type {
  ModelRequest,
  ModelResult
} from '../../apps/api/src/infrastructure/models/model-adapter.js';

const GENRE_PROFILE_OPERATIONS = new Set([
  'v7_compile_book_genre_profile_v1',
  'v7_compile_book_genre_profile_v2'
]);

export function v7GenreProfileFixtureResult(
  provider: string,
  modelId: string,
  request: Pick<ModelRequest, 'prompt'>
): ModelResult | null {
  const task = genreProfileTask(request.prompt);
  if (task === null) return null;
  const cards = Array.isArray(task.availableGenreCards)
    ? task.availableGenreCards.filter(isGenreCard)
    : [];
  const hints = isRecord(task.exactMatchHints) ? task.exactMatchHints : {};
  const hintedPrimary = typeof hints.primaryGenreKey === 'string' ? hints.primaryGenreKey : null;
  const primary = cards.find((card) => card.genreKey === hintedPrimary) ?? cards[0];
  if (primary === undefined) throw new Error('测试题材档案任务没有提供可用题材卡');
  const hintedSupporting = Array.isArray(hints.supportingGenreKeys)
    ? hints.supportingGenreKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const supporting = hintedSupporting
    .filter((key, index, all) => key !== primary.genreKey && all.indexOf(key) === index)
    .filter((key) => cards.some((card) => card.genreKey === key))
    .slice(0, 4);
  const label = [primary.publicName, ...supporting.map((key) => (
    cards.find((card) => card.genreKey === key)?.publicName ?? key
  ))].join('＋');
  const output = JSON.stringify({
    primaryGenreKey: primary.genreKey,
    supportingGenreKeys: supporting,
    publicLabel: label,
    workingIdentity: `以${primary.publicName}的主要阅读承诺为核心，让人物选择在可信边界内持续改变局面。`,
    primaryPromise: `主角依靠主动选择推进${primary.publicName}故事，并承担连续可见的代价。`,
    supportingFunctions: supporting.length > 0
      ? supporting.map((key) => `${cards.find((card) => card.genreKey === key)?.publicName ?? key}：只承担辅助推进功能。`)
      : [`${primary.publicName}：保持本书主体承诺，不额外拼接作者未选择的题材。`],
    writingPriorities: ['人物行动符合当前正式资料', '成长与结果保持连续因果'],
    authenticityChecks: ['时代、身份、资源与人物知识边界互相一致'],
    avoidPatterns: ['用巧合替代人物行动', '把测试题材卡直接拼成剧情'],
    conflictResolutions: []
  });
  return {
    provider,
    modelId,
    output,
    inputTokens: Math.max(1, Math.ceil(request.prompt.length / 2)),
    outputTokens: Math.max(1, Math.ceil(output.length / 2)),
    cashCostCny: 0,
    state: 'succeeded'
  };
}

function genreProfileTask(compiledPrompt: string): Record<string, unknown> | null {
  const root = parseRecord(compiledPrompt);
  if (root === null) return null;
  const directOperation = typeof root.operation === 'string' ? root.operation : null;
  if (directOperation !== null && GENRE_PROFILE_OPERATIONS.has(directOperation)) return root;
  const contextPack = isRecord(root.contextPack) ? root.contextPack : null;
  const content = contextPack !== null && isRecord(contextPack.content) ? contextPack.content : null;
  const payload = content?.stageTaskPayload;
  const task = typeof payload === 'string'
    ? parseRecord(payload)
    : isRecord(payload)
      ? payload
      : null;
  const operation = task !== null && typeof task.operation === 'string' ? task.operation : null;
  return operation !== null && GENRE_PROFILE_OPERATIONS.has(operation) ? task : null;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGenreCard(value: unknown): value is { genreKey: string; publicName: string } {
  return isRecord(value)
    && typeof value.genreKey === 'string'
    && value.genreKey.trim().length > 0
    && typeof value.publicName === 'string'
    && value.publicName.trim().length > 0;
}
