import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';

export interface SettingOutlineProfile {
  profileKey: string;
  profileLabel: string;
  required: string[];
  recommended: string[];
}

// 核心六问：任何题材都必须先确认的六张卡。题材包项一律作为建议出现，
// 不再单独阻塞进入分卷；作者可以在建议、完整类目与自定义之间自由取舍。
export const CORE_SETTING_KEYS = [
  'story-kernel',
  'world-stage',
  'protagonist-situation',
  'opposition',
  'rules-costs',
  'boundaries-blanks'
] as const;

const CORE_REQUIRED: readonly string[] = [...CORE_SETTING_KEYS];

const CORE_RECOMMENDED = [
  'geography',
  'strength-flaw',
  'supporting',
  'relations'
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
    recommended: ['investigation', 'information']
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
  // 主分类单独取信号：推荐排序必须让主题材的条目优先，副题材靠后，
  // 团队按这个顺序逐项讨论，先立住主类型，再补副题材。
  const primaryCategory = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey);
  const primaryHints = primaryCategory === undefined ? '' : `${primaryCategory.key} ${primaryCategory.name}`;
  const primaryPackKeys = new Set(primaryCategory?.tagPackKeys ?? []);
  const matched = PROFILE_RULES.filter((rule) => (
    rule.packKeys.some((packKey) => packKeys.has(packKey)) || rule.pattern.test(hints)
  ));
  const primaryMatched = matched.filter((rule) => (
    rule.packKeys.some((packKey) => primaryPackKeys.has(packKey))
    || (primaryHints.length > 0 && rule.pattern.test(primaryHints))
  ));
  const ordered = [...primaryMatched, ...matched.filter((rule) => !primaryMatched.includes(rule))];
  const required = unique([...CORE_REQUIRED]);
  const recommended = unique([
    ...ordered.flatMap((rule) => rule.required ?? []),
    ...ordered.flatMap((rule) => rule.recommended ?? []),
    ...CORE_RECOMMENDED
  ]).filter((key) => !required.includes(key));

  if (/脑洞|架空|穿越|重生/u.test(hints) && matched.some((rule) => rule.key === 'history') && !recommended.includes('divergence')) {
    recommended.push('divergence');
  }
  if (/战争|军事|争霸|军团/u.test(hints) && matched.some((rule) => rule.key === 'lord') && !recommended.includes('army')) {
    recommended.push('army');
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
