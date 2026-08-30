export interface V7SettingContextProjection {
  itemKey: string;
  label: string;
  versionId: string;
  revision: number;
  contextSummary: string;
  factEntries: string[];
  projectionSource: 'agent_projection' | 'legacy_exact';
  needsSemanticRebuild: boolean;
}

export interface V7ConfirmedSettingProjectionInput {
  item_key: string;
  item_label: string;
  version_id: string;
  revision: number;
  content_json: string;
}

const MAXIMUM_SAFE_LEGACY_EXACT_CHARACTERS = 700;

/**
 * Read a semantic projection that was authored in the same Agent call as the
 * setting itself.  Older rows are never summarized by program logic: a short
 * legacy row is carried exactly, while a large row is marked for one-time Agent
 * rebuilding before it can enter a lightweight downstream pack.
 */
export function confirmedSettingProjection(input: V7ConfirmedSettingProjectionInput): V7SettingContextProjection {
  const parsed = parseObject(input.content_json);
  const projectedFacts = stringArray(parsed.factEntries);
  const projectedSummary = text(parsed.contextSummary);
  if (projectedSummary !== null && projectedFacts.length > 0) {
    return {
      itemKey: input.item_key,
      label: input.item_label,
      versionId: input.version_id,
      revision: input.revision,
      contextSummary: projectedSummary,
      factEntries: projectedFacts,
      projectionSource: 'agent_projection',
      needsSemanticRebuild: false
    };
  }

  const exact = legacyExactContent(parsed, input.content_json);
  const exactCharacters = Array.from(exact).length;
  return {
    itemKey: input.item_key,
    label: input.item_label,
    versionId: input.version_id,
    revision: input.revision,
    contextSummary: text(parsed.summary) ?? input.item_label,
    factEntries: [exact],
    projectionSource: 'legacy_exact',
    needsSemanticRebuild: exactCharacters > MAXIMUM_SAFE_LEGACY_EXACT_CHARACTERS
  };
}

export function requireUsableSettingProjections(projections: readonly V7SettingContextProjection[]): void {
  const stale = projections.filter((projection) => projection.needsSemanticRebuild);
  if (stale.length === 0) return;
  const labels = stale.slice(0, 4).map((projection) => projection.label).join('、');
  const suffix = stale.length > 4 ? `等${stale.length}项` : '';
  throw new Error(`设定事实账本需要重新整理：${labels}${suffix}`);
}

function legacyExactContent(parsed: Record<string, unknown>, raw: string): string {
  return text(parsed.finalContent) ?? text(parsed.content) ?? stableJson(parsed) ?? raw;
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('已确认设定内容不完整');
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim()).filter(Boolean).slice(0, 32);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
