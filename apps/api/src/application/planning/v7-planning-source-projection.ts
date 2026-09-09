import { renderSettingRule, type SettingRule } from '@wenmi/opening-runtime';

/** A transport-only projection: frozen source content and hashes remain unchanged. */
export function planningSourceProjection(value: unknown): unknown {
  if (!isObject(value) || value.schema !== 'v7-setting-fact-source-v1' || !Array.isArray(value.rules)
    || value.rules.length === 0) return value;
  const represented = new Set<string>();
  const rules = value.rules.map((rule: unknown) => {
    if (typeof rule === 'string') { represented.add(rule.trim()); return rule; }
    if (!isObject(rule) || typeof rule.statement !== 'string') return rule;
    represented.add(rule.statement.trim());
    const compact = removeEmpty(rule) as Record<string, unknown>;
    const knownFields = ['level', 'statement', 'scope', 'conditions', 'costs', 'exceptions', 'objects'];
    const renderable = Object.keys(rule).every(key => knownFields.includes(key))
      && ['conditions', 'costs', 'exceptions', 'objects'].every(key => rule[key] === undefined
        || Array.isArray(rule[key]) && (rule[key] as unknown[]).every(x => typeof x === 'string'))
      && (rule.scope === undefined || typeof rule.scope === 'string');
    const rendered = renderable ? renderSettingRule({ scope: '', conditions: [], costs: [], exceptions: [], objects: [], ...rule,
      level: rule.level as SettingRule['level'], statement: rule.statement } as SettingRule) : null;
    if (rendered !== null) represented.add(rendered.trim());
    // Keep a global rule atomic/pinned in the evidence reader, including its qualifiers.
    if (rule.level === 'global') return { ...compact,
      conditions: rule.conditions ?? [], costs: rule.costs ?? [], exceptions: rule.exceptions ?? [] };
    const qualifiers = Object.keys(compact).filter(key => !['level', 'statement'].includes(key));
    // Legacy auxiliary conditions remain together with their statement, never independently selectable.
    return rendered ?? (qualifiers.length === 0 ? rule.statement : JSON.stringify(compact));
  });
  const { contextSummary: ignoredSummary, facts, rules: ignoredRules, label: ignoredLabel, ...identity } = value;
  void ignoredSummary; void ignoredRules; void ignoredLabel;
  return { ...identity, rules,
    ...(Array.isArray(facts) ? { facts: facts.filter(fact => typeof fact !== 'string' || !represented.has(fact.trim())) } : facts === undefined ? {} : { facts }) };
}

/** Remove empty containers only; zero, false and every nonempty author field survive. */
export function removeEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeEmpty).filter(nonempty);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, removeEmpty(entry)])
    .filter(([, entry]) => nonempty(entry)));
}
function nonempty(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
    && (!Array.isArray(value) || value.length > 0)
    && (!isObject(value) || Object.keys(value).length > 0);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
