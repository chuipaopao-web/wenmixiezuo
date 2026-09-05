import type { BookProfile } from './opening-api';

export function openingProfileRows(profile: BookProfile): Array<{ label: string; value: string }> {
  const blueprint = profile.openingBlueprint;
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | undefined): void => {
    const normalized = value?.trim() ?? '';
    if (normalized.length > 0) rows.push({ label, value: normalized });
  };
  push('时代与世界', blueprint.worldBackground);
  if (blueprint.planningProfile !== undefined) {
    push('预计总字数', `${Math.round(blueprint.planningProfile.expectedTotalWords / 10_000)}万字`);
  }
  push('故事方向', blueprint.storyDirection ?? profile.storyDirection);
  push('结局方向', blueprint.storyEnding ?? profile.storyEnding);
  push('必须遵守', (blueprint.mustFollow ?? profile.mustFollow ?? []).join('、'));
  return rows;
}

export interface OpeningProfileCharacter {
  key: string;
  name: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
  visualRows: Array<{ label: string; value: string }>;
}

export function openingProfileCharacters(profile: BookProfile): OpeningProfileCharacter[] {
  const protagonists = profile.openingBlueprint.protagonists ?? profile.protagonists;
  return protagonists.map((item, index) => ({
    key: `${item.name || '角色'}-${index}`,
    name: item.name || `角色 ${index + 1}`,
    summary: uniqueNonEmpty([roleLabel(item.role), item.age]).join(' · '),
    rows: [
      { label: '角色背景', value: item.background ?? '' },
      { label: '家庭背景', value: item.familyBackground ?? '' },
      { label: '职业背景', value: item.careerBackground ?? '' },
      { label: '特殊能力', value: item.goldenFinger ?? '' },
      { label: '性格', value: item.personalities.join('、') }
    ].filter((row) => row.value.trim().length > 0),
    visualRows: [
      { label: '外貌', value: item.visualIdentity?.appearance ?? '' },
      { label: '身形', value: item.visualIdentity?.build ?? '' },
      { label: '辨识特征', value: item.visualIdentity?.signatureFeature ?? '' }
    ].filter((row) => row.value.trim().length > 0)
  }));
}

export function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))];
}

function roleLabel(role = ''): string {
  return ({ male_lead: '男主', female_lead: '女主', co_lead: '共同主角', dual_lead: '共同主角', ensemble: '群像主角', ensemble_lead: '群像主角', non_human: '非人主角', male_support: '男配', female_support: '女配', male_villain: '男反派', female_villain: '女反派' } as Record<string, string>)[role] ?? '';
}
