import type { OpeningChannel, ProtagonistRole } from '../../lib/api/client';

export const OPENING_CHANNELS: Array<{ id: OpeningChannel; label: string; description: string }> = [
  { id: 'male', label: '男频', description: '' },
  { id: 'female', label: '女频', description: '' }
];

export const PROTAGONIST_ROLES: Array<{ id: ProtagonistRole; label: string }> = [
  { id: 'male_lead', label: '男主' },
  { id: 'female_lead', label: '女主' },
  { id: 'co_lead', label: '共同主角' },
  { id: 'ensemble', label: '群像主角' },
  { id: 'non_human', label: '非人主角' },
  { id: 'male_support', label: '男配' },
  { id: 'female_support', label: '女配' },
  { id: 'male_villain', label: '男反' },
  { id: 'female_villain', label: '女反' }
];
