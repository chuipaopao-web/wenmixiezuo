export type StyleStrength = 'weak' | 'medium' | 'strong';

export interface StyleBaselineInput {
  languageTones: string[];
  emotionalTones: string[];
  pacingAndPayoff: string[];
  atmospheres: string[];
  custom: string[];
  strength: StyleStrength;
  adaptiveRules: string[];
  avoidPatterns: string[];
  narrativePerson: string;
  viewpointDistance: string;
  textDensity: string;
}

export function validateStyleBaseline(input: StyleBaselineInput): StyleBaselineInput {
  return {
    languageTones: texts(input.languageTones, '可用语言气质', 0, 8, 40),
    emotionalTones: texts(input.emotionalTones, '可用情绪色彩', 0, 8, 40),
    pacingAndPayoff: texts(input.pacingAndPayoff, '可用节奏策略', 0, 8, 40),
    atmospheres: texts(input.atmospheres, '叙事氛围', 0, 8, 40),
    custom: texts(input.custom, '自定义风格', 0, 12, 80),
    strength: ['weak', 'medium', 'strong'].includes(input.strength) ? input.strength : 'medium',
    adaptiveRules: texts(input.adaptiveRules, '场景动态适配', 0, 12, 300),
    avoidPatterns: texts(input.avoidPatterns, '禁止退化', 0, 12, 300),
    narrativePerson: optional(input.narrativePerson, 40),
    viewpointDistance: optional(input.viewpointDistance, 40),
    textDensity: optional(input.textDensity, 40)
  };
}

function texts(value: unknown, label: string, min: number, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}格式无效`);
  const normalized = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
  if (normalized.length < min || normalized.length > max) throw new Error(`${label}需要填写${min}至${max}项`);
  if (normalized.some((item) => item.length > maxLength)) throw new Error(`${label}单项不能超过${maxLength}字`);
  return normalized;
}

function optional(value: unknown, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length > maxLength) throw new Error(`字段不能超过${maxLength}字`);
  return normalized;
}
