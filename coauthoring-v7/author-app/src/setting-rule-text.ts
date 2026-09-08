import type { SettingItemView } from './opening-api';

/** Legacy facts stay visible until a reviewed revision merges them into complete prose. */
export function settingRuleText(rule: NonNullable<SettingItemView['rules']>[number]): string {
  const legacy = [
    rule.scope ? `适用：${rule.scope}` : '',
    rule.conditions.length ? `条件：${rule.conditions.join('；')}` : '',
    rule.costs.length ? `代价：${rule.costs.join('；')}` : '',
    rule.exceptions.length ? `限制与例外：${rule.exceptions.join('；')}` : '',
    rule.objects.length ? `涉及：${rule.objects.join('、')}` : ''
  ].filter(Boolean);
  return legacy.length ? `${rule.statement}（${legacy.join('；')}）` : rule.statement;
}
