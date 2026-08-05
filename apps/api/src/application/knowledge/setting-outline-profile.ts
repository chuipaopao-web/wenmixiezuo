import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';

export interface SettingOutlineProfile {
  profileKey: string;
  profileLabel: string;
  required: string[];
  recommended: string[];
}

const CORE_REQUIRED = [
  'creative-concept',
  'reader-promise',
  'era',
  'protagonist',
  'motivation',
  'must-follow'
] as const;

const CORE_RECOMMENDED = [
  'theme-intent',
  'differentiator',
  'tone-boundary',
  'geography',
  'strength-flaw',
  'supporting',
  'relations',
  'open',
  'intentional-unknown'
] as const;

interface ProfileRule {
  key: string;
  label: string;
  packKeys: readonly string[];
  pattern: RegExp;
  required?: readonly string[];
  recommended?: readonly string[];
}

const PROFILE_RULES: readonly ProfileRule[] = [
  {
    key: 'romance',
    label: '言情关系',
    packKeys: ['romance'],
    pattern: /言情|现言|恋爱|爱情|甜宠|婚恋|豪门|情感|青春|先婚后爱|破镜重圆|romance|wealthy|youth/u,
    required: ['relationship-premise', 'relationship-obstacle'],
    recommended: ['relationship-growth', 'emotional-boundaries', 'life-circle', 'class', 'information']
  },
  {
    key: 'urban',
    label: '都市现实',
    packKeys: ['urban', 'reality', 'era'],
    pattern: /都市|现代|现实|职场|商战|娱乐圈|校园|日常|年代|modern|urban/u,
    recommended: ['life-circle', 'geography', 'class', 'culture', 'information']
  },
  {
    key: 'game',
    label: '游戏竞技',
    packKeys: ['game'],
    pattern: /游戏|电竞|网游|游戏异界|虚拟网游|游戏体育|male-game/u,
    required: ['game-entry', 'player-npc', 'game-panel', 'class-skill', 'loot'],
    recommended: ['levels', 'costs', 'abilities', 'equipment', 'quest-instance', 'ranking']
  },
  {
    key: 'fantasy',
    label: '玄幻修真',
    packKeys: ['fantasy', 'xianxia', 'western_fantasy', 'martial'],
    pattern: /玄幻|仙侠|修仙|修真|奇幻|魔法|高武|武侠|东方幻想|fantasy|xianxia|cultivation/u,
    required: ['power-source', 'levels', 'costs'],
    recommended: ['geography', 'factions', 'abilities', 'counters', 'cultivation', 'bloodline', 'treasures', 'causality']
  },
  {
    key: 'history',
    label: '历史古代',
    packKeys: ['history'],
    pattern: /历史|古代|三国|秦汉|明清|架空历史|抗战|谍战|宫斗|宅斗|history|war-spy/u,
    required: ['history-baseline'],
    recommended: ['governance', 'geography', 'history', 'class', 'culture', 'politics-military', 'technology-spread', 'historical-names']
  },
  {
    key: 'lord',
    label: '领主经营',
    packKeys: ['lord'],
    pattern: /领主|领地|领主争霸|种田经营|基建发展|城池建设/u,
    required: ['territory', 'population', 'yield'],
    recommended: ['production', 'currency', 'factions', 'army']
  },
  {
    key: 'business',
    label: '商业经营',
    packKeys: ['business'],
    pattern: /商业经营|商战经营|公司经营|创业经营/u,
    recommended: ['production', 'currency', 'class', 'information']
  },
  {
    key: 'mystery',
    label: '悬疑调查',
    packKeys: ['suspense'],
    pattern: /悬疑|推理|探案|刑侦|灵异|规则怪谈|民俗怪谈|suspense|supernatural/u,
    required: ['case-rules', 'evidence-chain', 'truth-layers'],
    recommended: ['investigation', 'information', 'intentional-unknown']
  },
  {
    key: 'scifi',
    label: '科幻未来',
    packKeys: ['scifi', 'apocalypse'],
    pattern: /科幻|末世|星际|未来世界|赛博|机甲|scifi|apocalypse/u,
    required: ['technology-boundary', 'science-cost'],
    recommended: ['social-impact', 'space-rules', 'civilization', 'hazards', 'production']
  }
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function blueprintSignals(blueprint: OpeningBlueprintInput): { hints: string; packKeys: Set<string> } {
  const categories = [blueprint.categoryKey, ...(blueprint.auxiliaryCategoryKeys ?? [])]
    .map((key) => OPENING_TAXONOMY.categories.find((item) => item.key === key))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const subjects = new Set(blueprint.auxiliaryTags ?? []);
  const subjectPacks = OPENING_TAXONOMY.subjects
    .filter((subject) => subjects.has(subject.name))
    .flatMap((subject) => subject.packKeys);

  return {
    hints: [
      ...categories.flatMap((category) => [category.key, category.name]),
      ...(blueprint.auxiliaryTags ?? []),
      ...(blueprint.mainTags ?? []),
      ...(blueprint.storyTraits ?? []),
      ...(blueprint.customTags ?? [])
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' '),
    packKeys: new Set([
      ...categories.flatMap((category) => category.tagPackKeys),
      ...subjectPacks
    ])
  };
}

export function resolveSettingOutlineProfile(blueprint: OpeningBlueprintInput): SettingOutlineProfile {
  const { hints, packKeys } = blueprintSignals(blueprint);
  const matched = PROFILE_RULES.filter((rule) => (
    rule.packKeys.some((packKey) => packKeys.has(packKey)) || rule.pattern.test(hints)
  ));
  const required = unique([
    ...CORE_REQUIRED,
    ...matched.flatMap((rule) => rule.required ?? [])
  ]);
  const recommended = unique([
    ...CORE_RECOMMENDED,
    ...matched.flatMap((rule) => rule.recommended ?? [])
  ]).filter((key) => !required.includes(key));

  if (/脑洞|架空|穿越|重生/u.test(hints) && matched.some((rule) => rule.key === 'history')) {
    required.push('divergence');
    const index = recommended.indexOf('divergence');
    if (index >= 0) recommended.splice(index, 1);
  }
  if (/战争|军事|争霸|军团/u.test(hints) && matched.some((rule) => rule.key === 'lord')) {
    required.push('army');
    const index = recommended.indexOf('army');
    if (index >= 0) recommended.splice(index, 1);
  }

  return {
    profileKey: matched.length === 0 ? 'common' : matched.map((rule) => rule.key).join('+'),
    profileLabel: matched.length === 0 ? '通用故事' : matched.map((rule) => rule.label).join('＋'),
    required: unique(required),
    recommended
  };
}

export function resolveContinuationSettingOutlineProfile(): SettingOutlineProfile {
  return {
    profileKey: 'continuation-reverse',
    profileLabel: '已有正文反向整理',
    required: [...CORE_REQUIRED],
    recommended: [...CORE_RECOMMENDED]
  };
}
