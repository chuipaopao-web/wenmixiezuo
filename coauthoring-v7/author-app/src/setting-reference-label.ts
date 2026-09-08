/** Translate explicit catalog references for display without rewriting saved rules. */
export function settingReferenceLabel(text: string, catalog: readonly { key: string; label: string }[]): string {
  const labels = new Map(catalog.map((entry) => [entry.key, entry.label]));
  if (labels.has(text.trim())) return labels.get(text.trim())!;
  return text.replace(/((?:参见|参考|详见|见)\s*)([a-z][a-z0-9_-]*)(?![a-z0-9_-])/gi,
    (original, prefix: string, key: string) => labels.has(key) ? `${prefix}${labels.get(key)}` : original);
}
