import { BOOK_TITLE_MAX_CHARACTERS, limitBookTitle } from '@wenmi/contracts';
import type { BookCreationMode, OpeningChannel, ProtagonistRole } from '../../lib/api/client';

export const OPENING_DRAFT_STORAGE_KEY = 'wenmi.opening-draft.v2';
const OPENING_DRAFT_SCHEMA_VERSION = 3 as const;

/** 草稿按账号隔离存储，同一浏览器切换账号不会看到彼此的开书信息。 */
export function openingDraftStorageKey(accountId: string): string {
  return `${OPENING_DRAFT_STORAGE_KEY}:${accountId}`;
}

export interface OpeningProtagonistDraft {
  role: ProtagonistRole;
  name: string;
  age: string;
  background: string;
  familyBackground: string;
  careerBackground: string;
  goldenFinger: string;
  personalities: string[];
}

export interface OpeningWizardDraft {
  schemaVersion: typeof OPENING_DRAFT_SCHEMA_VERSION;
  step: 1 | 2 | 3 | 4;
  creationMode: BookCreationMode;
  title: string;
  channel: OpeningChannel | null;
  categoryKey: string | null;
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  protagonists: OpeningProtagonistDraft[];
  storyDirection: string;
  targetAudience: string;
  worldBackground: string;
  openingBackground: string;
  stageOne: { start: string; development: string; end: string };
  fullBookOutline: string;
  initialMap: string;
  customTags: string[];
  selectedMustFollow: string[];
  mustFollowText: string;
  allSubjectsOpen: boolean;
  activeTagGroupKey: string;
  updatedAt: string;
}

export function emptyOpeningWizardDraft(): OpeningWizardDraft {
  return {
    schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
    step: 1,
    creationMode: 'new',
    title: '',
    channel: null,
    categoryKey: null,
    mainTags: [],
    auxiliaryTags: [],
    storyTraits: [],
    protagonists: [{ role: 'co_lead', name: '', age: '', background: '', familyBackground: '', careerBackground: '', goldenFinger: '', personalities: [] }],
    storyDirection: '',
    targetAudience: '',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    initialMap: '',
    customTags: [],
    selectedMustFollow: [],
    mustFollowText: '',
    allSubjectsOpen: false,
    activeTagGroupKey: 'recommended',
    updatedAt: ''
  };
}

export function loadOpeningWizardDraft(accountId: string, storage: Pick<Storage, 'getItem'> = globalThis.localStorage): OpeningWizardDraft | null {
  try {
    const raw = storage.getItem(openingDraftStorageKey(accountId));
    if (raw === null) return null;
    return parseOpeningWizardDraft(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveOpeningWizardDraft(
  accountId: string,
  draft: Omit<OpeningWizardDraft, 'schemaVersion' | 'updatedAt'>,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
  now: () => Date = () => new Date()
): OpeningWizardDraft {
  const saved: OpeningWizardDraft = {
    ...draft,
    schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
    updatedAt: now().toISOString()
  };
  storage.setItem(openingDraftStorageKey(accountId), JSON.stringify(saved));
  return saved;
}

export function clearOpeningWizardDraft(accountId: string, storage: Pick<Storage, 'removeItem'> = globalThis.localStorage): void {
  storage.removeItem(openingDraftStorageKey(accountId));
}

export function hasMeaningfulOpeningDraft(draft: Omit<OpeningWizardDraft, 'schemaVersion' | 'updatedAt'>): boolean {
  return draft.creationMode === 'continuation'
    || draft.title.trim().length > 0
    || draft.channel !== null
    || draft.categoryKey !== null
    || draft.storyDirection.trim().length > 0
    || draft.targetAudience.trim().length > 0
    || draft.worldBackground.trim().length > 0
    || draft.openingBackground.trim().length > 0
    || Object.values(draft.stageOne).some((item) => item.trim().length > 0)
    || draft.fullBookOutline.trim().length > 0
    || draft.initialMap.trim().length > 0
    || draft.mainTags.length > 0
    || draft.auxiliaryTags.length > 0
    || draft.customTags.length > 0
    || draft.selectedMustFollow.length > 0
    || draft.mustFollowText.trim().length > 0
    || draft.protagonists.some((item) => item.name.trim().length > 0 || item.age.trim().length > 0
      || item.background.trim().length > 0 || item.familyBackground.trim().length > 0
      || item.careerBackground.trim().length > 0 || item.goldenFinger.trim().length > 0
      || item.personalities.length > 0);
}

export function parseOpeningWizardDraft(value: unknown): OpeningWizardDraft | null {
  // v2 是旧三步向导的草稿：第2步（作品方向）落到新第3步，第3步（初始角色）并入新第4步；更早的第4步回落到第2步。
  if (!isRecord(value) || (value.schemaVersion !== 2 && value.schemaVersion !== OPENING_DRAFT_SCHEMA_VERSION)) return null;
  const empty = emptyOpeningWizardDraft();
  const protagonists = Array.isArray(value.protagonists)
    ? value.protagonists.slice(0, 8).map(parseProtagonist).filter((item): item is OpeningProtagonistDraft => item !== null)
    : [];
  const rawStep = value.step;
  return {
    schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
    step: value.schemaVersion === 2
      ? rawStep === 2 ? 3 : rawStep === 3 ? 4 : rawStep === 4 ? 2 : 1
      : rawStep === 2 || rawStep === 3 || rawStep === 4 ? rawStep as 2 | 3 | 4 : 1,
    creationMode: value.creationMode === 'continuation' ? 'continuation' : 'new',
    title: limitBookTitle(limitedText(value.title, BOOK_TITLE_MAX_CHARACTERS * 2)),
    channel: value.channel === 'male' || value.channel === 'female' ? value.channel : null,
    categoryKey: nullableLimitedText(value.categoryKey, 120),
    mainTags: uniqueTexts(value.mainTags, 200, 40),
    auxiliaryTags: uniqueTexts(value.auxiliaryTags, 8, 40),
    storyTraits: uniqueTexts(value.storyTraits, 11, 40),
    protagonists: protagonists.length > 0 ? protagonists : empty.protagonists,
    storyDirection: limitedText(value.storyDirection, 800),
    targetAudience: limitedText(value.targetAudience, 500),
    worldBackground: limitedText(value.worldBackground, 10_000),
    openingBackground: limitedText(value.openingBackground, 10_000),
    stageOne: isRecord(value.stageOne) ? {
      start: limitedText(value.stageOne.start, 10_000),
      development: limitedText(value.stageOne.development, 10_000),
      end: limitedText(value.stageOne.end, 10_000)
    } : empty.stageOne,
    fullBookOutline: limitedText(value.fullBookOutline, 20_000),
    initialMap: limitedText(value.initialMap, 5_000),
    customTags: uniqueTexts(value.customTags, 13, 40),
    selectedMustFollow: uniqueTexts(value.selectedMustFollow, 15, 500),
    mustFollowText: limitedText(value.mustFollowText, 6_000),
    allSubjectsOpen: value.allSubjectsOpen === true,
    activeTagGroupKey: limitedText(value.activeTagGroupKey, 120) || 'recommended',
    updatedAt: limitedText(value.updatedAt, 80)
  };
}

function parseProtagonist(value: unknown): OpeningProtagonistDraft | null {
  if (!isRecord(value)) return null;
  const validRoles: ProtagonistRole[] = [
    'male_lead', 'female_lead', 'co_lead', 'ensemble', 'non_human',
    'male_support', 'female_support', 'male_villain', 'female_villain'
  ];
  const role = typeof value.role === 'string' && validRoles.includes(value.role as ProtagonistRole)
    ? value.role as ProtagonistRole
    : 'co_lead';
  const legacyBackground = limitedText(value.background, 2_000);
  // 旧草稿只有整段人物背景：恢复时归入家庭背景框，避免作者重填。
  const familyBackground = limitedText(value.familyBackground, 2_000) || legacyBackground;
  return {
    role,
    name: limitedText(value.name, 80),
    age: limitedText(value.age, 80),
    background: familyBackground.length > 0 ? '' : legacyBackground,
    familyBackground,
    careerBackground: limitedText(value.careerBackground, 2_000),
    goldenFinger: limitedText(value.goldenFinger, 2_000),
    personalities: uniqueTexts(value.personalities, 12, 40)
  };
}

function limitedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function nullableLimitedText(value: unknown, maximum: number): string | null {
  const text = limitedText(value, maximum).trim();
  return text.length === 0 ? null : text;
}

function uniqueTexts(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maximumLength)).filter(Boolean))].slice(0, maximumItems);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
