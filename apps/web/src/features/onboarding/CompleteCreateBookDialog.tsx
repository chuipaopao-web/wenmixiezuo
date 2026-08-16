import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  MagicWandIcon,
  PlusIcon,
  ShieldCheckIcon,
  XIcon
} from '@phosphor-icons/react';
import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount, limitBookTitle } from '@wenmi/contracts';
import {
  clearOpeningDraftOnServer,
  createBook,
  fetchOpeningDraft,
  fetchOpeningTaxonomy,
  saveOpeningDraftToServer,
  type BookProfileViewData,
  type OpeningBlueprintData,
  type OpeningChannel,
  type OpeningTaxonomyData,
  type ProtagonistRole
} from '../../lib/api/client';
import { NamingAssistantPanel } from '../../app/NamingAssistantPanel';
import { recommendCharacterTarget, type NamingContext } from '../../app/naming-assistant';
import { OPENING_CHANNELS, PROTAGONIST_ROLES } from './opening-options';
import {
  clearOpeningWizardDraft,
  emptyOpeningWizardDraft,
  hasMeaningfulOpeningDraft,
  loadOpeningWizardDraft,
  parseOpeningWizardDraft,
  saveOpeningWizardDraft,
  type OpeningProtagonistDraft,
  type OpeningWizardDraft
} from './opening-draft-store';

export function CompleteCreateBookDialog({ accountId = '', busy, onCancel, onCreate, initialProfile, onUpdate }: {
  accountId?: string;
  busy: boolean;
  onCancel: () => void;
  onCreate?: (input: Parameters<typeof createBook>[0]) => Promise<boolean>;
  initialProfile?: BookProfileViewData;
  onUpdate?: (input: { expectedVersion: number; title: string; openingBlueprint: OpeningBlueprintData }) => Promise<boolean>;
}): React.JSX.Element {
  const editing = initialProfile !== undefined;
  const [restoredDraft] = useState(() => editing ? null : loadOpeningWizardDraft(accountId));
  const [initialDraft] = useState(() => initialProfile === undefined
    ? restoredDraft ?? emptyOpeningWizardDraft()
    : openingProfileDraft(initialProfile));
  const [taxonomy, setTaxonomy] = useState<OpeningTaxonomyData | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialDraft.step);
  const [title, setTitle] = useState(initialDraft.title);
  const [creationMode, setCreationMode] = useState<'new' | 'continuation'>(initialDraft.creationMode);
  const [channel, setChannel] = useState<OpeningChannel | null>(initialDraft.channel);
  const [categoryKey, setCategoryKey] = useState<string | null>(initialDraft.categoryKey);
  const [mainTags, setMainTags] = useState<string[]>(initialDraft.mainTags);
  const [auxiliaryTags, setAuxiliaryTags] = useState<string[]>(initialDraft.auxiliaryTags);
  const [storyTraits, setStoryTraits] = useState<string[]>(initialDraft.storyTraits);
  const [protagonists, setProtagonists] = useState<OpeningProtagonistDraft[]>(initialDraft.protagonists);
  const [namingProtagonistIndex, setNamingProtagonistIndex] = useState<number | null>(null);
  const [storyDirection, setStoryDirection] = useState(initialDraft.storyDirection);
  const [targetAudience, setTargetAudience] = useState(initialDraft.targetAudience);
  const [worldBackground, setWorldBackground] = useState(initialDraft.worldBackground);
  const [openingBackground, setOpeningBackground] = useState(initialDraft.openingBackground);
  const [stageOne, setStageOne] = useState(initialDraft.stageOne);
  const [fullBookOutline, setFullBookOutline] = useState(initialDraft.fullBookOutline);
  const [initialMap, setInitialMap] = useState(initialDraft.initialMap);
  const [customTags, setCustomTags] = useState<string[]>(initialDraft.customTags);
  const [customTag, setCustomTag] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [allSubjectsOpen, setAllSubjectsOpen] = useState(initialDraft.allSubjectsOpen);
  const [activeTagGroupKey, setActiveTagGroupKey] = useState(initialDraft.activeTagGroupKey);
  const [selectedMustFollow, setSelectedMustFollow] = useState<string[]>(initialDraft.selectedMustFollow);
  const [mustFollowText, setMustFollowText] = useState(initialDraft.mustFollowText);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState(restoredDraft !== null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const automaticTagSignature = useRef('');
  const automaticTagValues = useRef<string[]>([]);
  const automaticTagCategory = useRef<string | null>(null);
  const dismissedAutomaticTags = useRef<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    void fetchOpeningTaxonomy(controller.signal).then((value) => {
      setTaxonomy(value); setTaxonomyError(null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setTaxonomyError(reason instanceof Error ? reason.message : '分类目录加载失败');
    });
    return () => controller.abort();
  }, []);

  const applyDraft = (draft: OpeningWizardDraft): void => {
    setStep(draft.step);
    setCreationMode(draft.creationMode);
    setTitle(draft.title);
    setChannel(draft.channel);
    setCategoryKey(draft.categoryKey);
    setMainTags(draft.mainTags);
    setAuxiliaryTags(draft.auxiliaryTags);
    setStoryTraits(draft.storyTraits);
    setProtagonists(draft.protagonists);
    setStoryDirection(draft.storyDirection);
    setTargetAudience(draft.targetAudience);
    setWorldBackground(draft.worldBackground);
    setOpeningBackground(draft.openingBackground);
    setStageOne(draft.stageOne);
    setFullBookOutline(draft.fullBookOutline);
    setInitialMap(draft.initialMap);
    setCustomTags(draft.customTags);
    setSelectedMustFollow(draft.selectedMustFollow);
    setMustFollowText(draft.mustFollowText);
    setAllSubjectsOpen(draft.allSubjectsOpen);
    setActiveTagGroupKey(draft.activeTagGroupKey);
  };

  // 服务器草稿是权威来源：浏览器清理或换设备后，从这里恢复。
  // 本地 localStorage 只作即时缓存；服务器草稿更新鲜（或本地没有）时覆盖本地。
  useEffect(() => {
    if (editing) return;
    const controller = new AbortController();
    void fetchOpeningDraft(controller.signal).then((envelope) => {
      if (controller.signal.aborted || envelope.draft === null) return;
      const serverDraft = parseOpeningWizardDraft(envelope.draft);
      if (serverDraft === null) return;
      const localUpdatedAt = restoredDraft?.updatedAt ?? '';
      if (serverDraft.updatedAt <= localUpdatedAt) return;
      applyDraft(serverDraft);
      try { saveOpeningWizardDraft(accountId, serverDraft); } catch { /* 本地缓存失败不影响服务器草稿 */ }
      setRestoredNotice(true);
    }).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing) return;
    const snapshot: Omit<OpeningWizardDraft, 'schemaVersion' | 'updatedAt'> = {
      step, creationMode, title, channel, categoryKey, mainTags, auxiliaryTags, storyTraits,
      protagonists, storyDirection, targetAudience, worldBackground, openingBackground, stageOne,
      fullBookOutline, initialMap, customTags, selectedMustFollow, mustFollowText,
      allSubjectsOpen, activeTagGroupKey
    };
    const timer = window.setTimeout(() => {
      if (editing) return;
      try {
        if (hasMeaningfulOpeningDraft(snapshot)) {
          const saved = saveOpeningWizardDraft(accountId, snapshot);
          setDraftSaveMessage(`草稿已自动保存 · ${new Date(saved.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
          void saveOpeningDraftToServer(saved as unknown as Record<string, unknown>).catch(() => undefined);
        } else {
          clearOpeningWizardDraft(accountId);
          setDraftSaveMessage(null);
          void clearOpeningDraftOnServer().catch(() => undefined);
        }
      } catch {
        setDraftSaveMessage('当前浏览器无法自动保存草稿，请不要关闭页面。');
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountId, step, creationMode, title, channel, categoryKey, mainTags, auxiliaryTags, storyTraits,
    protagonists, storyDirection, targetAudience, worldBackground, openingBackground, stageOne,
    fullBookOutline, initialMap, customTags, selectedMustFollow, mustFollowText,
    allSubjectsOpen, activeTagGroupKey, editing]);

  const categories = taxonomy?.categories.filter((item) => item.channel === channel) ?? [];
  const category = taxonomy?.categories.find((item) => item.key === categoryKey) ?? null;
  const subjects = taxonomy?.subjects ?? (taxonomy?.auxiliaryTags ?? []).map((name) => ({ name, packKeys: ['common'] }));
  const activePackKeys = [...new Set([
    'common',
    ...(category?.tagPackKeys ?? []),
    ...subjects.filter((item) => auxiliaryTags.includes(item.name)).flatMap((item) => item.packKeys)
  ])];
  const availableTagGroups = taxonomy?.tagGroups ?? [{
    key: 'common', name: '当前分类', description: '当前分类可用标签',
    packKeys: ['common'],
    mainTags: taxonomy?.mainTags ?? [], auxiliaryTags: taxonomy?.auxiliaryTags ?? [], storyTraits: taxonomy?.storyTraits ?? []
  }];
  const relevantTagGroups = availableTagGroups.filter((group) => group.packKeys?.some((pack) => activePackKeys.includes(pack)) ?? activePackKeys.includes(group.key));
  const activeTagGroup = activeTagGroupKey === 'recommended'
    ? null
    : availableTagGroups.find((group) => group.key === activeTagGroupKey) ?? null;
  const recommendedSubjects = subjects.filter((item) => (item.packKeys ?? ['common']).some((pack) => category?.tagPackKeys?.includes(pack)));
  const subjectOptions = allSubjectsOpen ? subjects : [...new Map([...recommendedSubjects, ...subjects.filter((item) => auxiliaryTags.includes(item.name))].map((item) => [item.name, item])).values()];
  const groupTagValues = (group: typeof availableTagGroups[number]): string[] => [
    ...group.mainTags,
    ...group.auxiliaryTags,
    ...group.storyTraits
  ];
  const recommendedTagOptions = [...new Set([
    ...(category?.recommendedMainTags ?? []),
    ...relevantTagGroups.flatMap(groupTagValues)
  ])].filter((tag) => {
    if (tag === category?.name || auxiliaryTags.includes(tag)) return false;
    if (channel === 'male' && tag === '女性成长') return false;
    if (channel === 'female' && tag === '男性成长') return false;
    return true;
  });
  const displayedTagOptions = activeTagGroup === null ? recommendedTagOptions : [...new Set(groupTagValues(activeTagGroup))];
  const normalizedTagQuery = tagQuery.trim().toLocaleLowerCase('zh-CN');
  const matchingTags = (options: string[]): string[] => normalizedTagQuery.length === 0
    ? options
    : options.filter((item) => item.toLocaleLowerCase('zh-CN').includes(normalizedTagQuery));
  // 同一个词在作品分类名、融合题材、主要标签、故事特点或自定义标签中已占用时，其他选区一律置灰，避免重复选择。
  const blockedSubjectTags = new Set([
    ...(category === null ? [] : [category.name]),
    ...mainTags, ...storyTraits, ...customTags
  ].filter((tag) => !auxiliaryTags.includes(tag)));
  const blockedMainTags = new Set([
    ...(category === null ? [] : [category.name]),
    ...auxiliaryTags, ...storyTraits, ...customTags
  ].filter((tag) => !mainTags.includes(tag)));
  const tagRecommendationSignature = `${taxonomy?.version ?? ''}|${categoryKey ?? ''}|${[...auxiliaryTags].sort().join('|')}`;
  useEffect(() => {
    if (taxonomy === null || category === null || automaticTagSignature.current === tagRecommendationSignature) return;
    if (editing && automaticTagSignature.current === '') {
      automaticTagSignature.current = tagRecommendationSignature;
      automaticTagCategory.current = category.key;
      return;
    }
    if (automaticTagCategory.current !== category.key) {
      dismissedAutomaticTags.current.clear();
      automaticTagCategory.current = category.key;
    }
    automaticTagSignature.current = tagRecommendationSignature;
    const nextAutomaticTags = recommendedTagOptions
      .filter((tag) => !dismissedAutomaticTags.current.has(tag))
      .slice(0, 8);
    setMainTags((current) => {
      const manualTags = current.filter((tag) => !automaticTagValues.current.includes(tag));
      return [...new Set([...manualTags, ...nextAutomaticTags])];
    });
    automaticTagValues.current = nextAutomaticTags;
  }, [taxonomy, category, tagRecommendationSignature, editing]);
  const customMustFollow = mustFollowText.split(/[；;\n\r]+/u).map((item) => item.trim()).filter(Boolean);
  const mustFollow = [...new Set([...selectedMustFollow, ...customMustFollow])];
  const directionRequirements = [
    ...(taxonomy === null ? ['分类目录'] : []),
    ...(title.trim().length === 0 ? ['书名'] : []),
    ...(bookTitleCharacterCount(title) > BOOK_TITLE_MAX_CHARACTERS ? ['书名最多15字'] : []),
    ...(channel === null ? ['创作频道'] : []),
    ...(category === null ? ['作品分类'] : []),
    ...(storyDirection.trim().length < 20 ? ['故事方向至少20字'] : [])
  ];
  const protagonistRequirements = protagonists.flatMap((item, index) => [
    ...(item.name.trim().length === 0 ? [`角色${index + 1}姓名`] : []),
    ...(item.age.trim().length === 0 ? [`角色${index + 1}年龄`] : []),
    ...(item.familyBackground.trim().length === 0 ? [`角色${index + 1}家庭背景`] : []),
    ...(item.personalities.length === 0 ? [`角色${index + 1}至少1个性格`] : [])
  ]);
  const preferenceRequirements = [
    ...(mainTags.length < 2 ? ['至少2个主要标签'] : []),
    ...(mustFollow.length === 0 ? ['必须遵守'] : []),
    ...(mustFollow.length > 15 ? ['必须遵守最多15条'] : [])
  ];
  const missingByStep: Record<1 | 2 | 3 | 4, string[]> = {
    1: [], 2: directionRequirements, 3: protagonistRequirements, 4: preferenceRequirements
  };
  const missingRequirements = [...directionRequirements, ...protagonistRequirements, ...preferenceRequirements];
  const valid = missingRequirements.length === 0;
  const namingProtagonist = namingProtagonistIndex === null ? null : protagonists[namingProtagonistIndex] ?? null;
  const namingContext: NamingContext = {
    channel,
    category: category?.name ?? null,
    subjects: auxiliaryTags,
    tags: [...mainTags, ...customTags],
    storyDirection
  };
  const toggleTag = (tag: string, current: string[], setter: (value: string[]) => void, max?: number): void => {
    if (current.includes(tag)) setter(current.filter((item) => item !== tag));
    else if (max === undefined || current.length < max) setter([...current, tag]);
  };
  const toggleMainTag = (tag: string): void => {
    if (mainTags.includes(tag)) {
      if (automaticTagValues.current.includes(tag)) dismissedAutomaticTags.current.add(tag);
      setMainTags(mainTags.filter((item) => item !== tag));
      return;
    }
    dismissedAutomaticTags.current.delete(tag);
    setMainTags([...mainTags, tag]);
  };
  const updateProtagonist = (index: number, patch: Partial<OpeningProtagonistDraft>): void => {
    setProtagonists((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const toggleProtagonistPersonality = (index: number, personality: string): void => {
    const current = protagonists[index];
    if (current === undefined) return;
    const next = current.personalities.includes(personality)
      ? current.personalities.filter((item) => item !== personality)
      : current.personalities.length >= 12 ? current.personalities : [...current.personalities, personality];
    updateProtagonist(index, { personalities: next });
  };
  const addCustomTag = (): void => {
    const value = customTag.trim().replace(/^#+/u, '');
    if (value.length === 0 || customTags.includes(value) || customTags.length >= 13) return;
    // 与正式标签或分类名同名的词不重复添加。
    if (mainTags.includes(value) || auxiliaryTags.includes(value) || storyTraits.includes(value) || value === category?.name) return;
    setCustomTags([...customTags, value]); setCustomTag('');
  };
  const toggleMustFollow = (item: string): void => {
    if (selectedMustFollow.includes(item)) {
      setSelectedMustFollow(selectedMustFollow.filter((value) => value !== item));
      return;
    }
    if (item === '无额外限制') {
      setSelectedMustFollow(['无额外限制']);
      setMustFollowText('');
      return;
    }
    if (mustFollow.length >= 15) return;
    setSelectedMustFollow([...selectedMustFollow.filter((value) => value !== '无额外限制'), item]);
  };
  const focusMissingStep = (targetStep: 2 | 3 | 4): void => {
    window.requestAnimationFrame(() => {
      const protagonistTarget = protagonists.flatMap((item, index) => [
        ...(item.name.trim().length === 0 ? [index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`] : []),
        ...(item.age.trim().length === 0 ? [index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`] : []),
        ...(item.familyBackground.trim().length === 0 ? [index === 0 ? 'opening-protagonist-family-background' : `protagonist-family-background-${index}`] : [])
      ]).map((id) => document.getElementById(id)).find((element) => element !== null);
      const target = targetStep === 2
        ? taxonomy === null ? validationSummaryRef.current
          : title.trim().length === 0 ? document.getElementById('complete-book-title')
            : channel === null ? document.querySelector<HTMLInputElement>('input[name="complete-book-channel"]')
              : category === null ? document.getElementById('opening-category-section')
                : document.getElementById('opening-story-direction')
        : targetStep === 3
          ? protagonistTarget ?? document.getElementById('opening-protagonist-section')
          : mainTags.length < 2 ? document.getElementById('opening-tag-search') : document.getElementById('must-follow');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    });
  };
  const moveToStep = (nextStep: 1 | 2 | 3 | 4): void => {
    if (nextStep > step && missingByStep[step].length > 0) {
      setSubmitAttempted(true);
      if (step > 1) focusMissingStep(step as 2 | 3 | 4);
      return;
    }
    setSubmitAttempted(false);
    setSubmitError(null);
    setStep(nextStep);
    if (typeof bodyRef.current?.scrollTo === 'function') bodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    else if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
  };
  const resetDraft = (): void => {
    const empty = emptyOpeningWizardDraft();
    setStep(empty.step);
    setCreationMode(empty.creationMode);
    setTitle(empty.title);
    setChannel(empty.channel);
    setCategoryKey(empty.categoryKey);
    setMainTags(empty.mainTags);
    setAuxiliaryTags(empty.auxiliaryTags);
    setStoryTraits(empty.storyTraits);
    setProtagonists(empty.protagonists);
    setStoryDirection(empty.storyDirection);
    setTargetAudience(empty.targetAudience);
    setWorldBackground(empty.worldBackground);
    setOpeningBackground(empty.openingBackground);
    setStageOne(empty.stageOne);
    setFullBookOutline(empty.fullBookOutline);
    setInitialMap(empty.initialMap);
    setCustomTags(empty.customTags);
    setSelectedMustFollow(empty.selectedMustFollow);
    setMustFollowText(empty.mustFollowText);
    setAllSubjectsOpen(empty.allSubjectsOpen);
    setActiveTagGroupKey(empty.activeTagGroupKey);
    setSubmitAttempted(false);
    setSubmitError(null);
    setRestoredNotice(false);
    setDraftSaveMessage(null);
    automaticTagSignature.current = '';
    automaticTagValues.current = [];
    automaticTagCategory.current = null;
    dismissedAutomaticTags.current.clear();
    clearOpeningWizardDraft(accountId);
    void clearOpeningDraftOnServer().catch(() => undefined);
  };
  const submit = async (): Promise<void> => {
    if (submitting || busy) return;
    if (!valid || taxonomy === null || channel === null || category === null) {
      const firstMissingStep: 2 | 3 | 4 = directionRequirements.length > 0 ? 2
        : protagonistRequirements.length > 0 ? 3 : 4;
      setSubmitAttempted(true);
      setStep(firstMissingStep);
      focusMissingStep(firstMissingStep);
      return;
    }
    const openingBlueprint: OpeningBlueprintData = {
      creationMode,
      taxonomyVersion: taxonomy.version,
      channel,
      categoryKey: category.key,
      ...(initialProfile?.openingBlueprint.auxiliaryCategoryKeys === undefined
        ? {}
        : { auxiliaryCategoryKeys: initialProfile.openingBlueprint.auxiliaryCategoryKeys }),
      targetAudience: targetAudience.trim(),
      protagonists: protagonists.map((item) => ({
        ...item,
        name: item.name.trim(),
        age: item.age.trim(),
        background: item.background.trim(),
        familyBackground: item.familyBackground.trim(),
        careerBackground: item.careerBackground.trim(),
        goldenFinger: item.goldenFinger.trim()
      })),
      storyDirection: storyDirection.trim(),
      worldBackground: worldBackground.trim(),
      openingBackground: openingBackground.trim(),
      stageOne: { start: stageOne.start.trim(), development: stageOne.development.trim(), end: stageOne.end.trim() },
      fullBookOutline: fullBookOutline.trim(),
      mainTags, auxiliaryTags, storyTraits, customTags, mustFollow,
      styleIntent: initialProfile?.openingBlueprint.styleIntent
        ?? { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
      initialMap: initialMap.trim()
    };
    setSubmitting(true);
    setSubmitError(null);
    try {
      let saved = false;
      if (editing) {
        if (initialProfile === undefined || onUpdate === undefined) throw new Error('缺少开书资料修改处理程序。');
        saved = await onUpdate({
          expectedVersion: initialProfile.version,
          title: title.trim(),
          openingBlueprint
        });
      } else {
        if (onCreate === undefined) throw new Error('缺少创建新书处理程序。');
        saved = await onCreate({
          title: title.trim(), text: storyDirection.trim(), category: category.name,
          classification: channel === 'male' ? '男频' : '女频',
          targetAudience: targetAudience.trim(),
          tags: [category.name, ...mainTags, ...auxiliaryTags, ...storyTraits, ...customTags, ...mustFollow.map((item) => `必须遵守：${item}`)],
          openingBlueprint
        });
      }
      if (saved && !editing) {
        clearOpeningWizardDraft(accountId);
        void clearOpeningDraftOnServer().catch(() => undefined);
      }
      else if (!saved) setSubmitError(editing ? '修改没有保存，请检查提示后重试。' : '创建没有完成，已保留全部草稿，可以检查提示后重试。');
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : editing ? '修改没有保存。' : '创建没有完成，已保留全部草稿。');
    } finally {
      setSubmitting(false);
    }
  };

  // 关闭前立即保存一次，避免 250ms 防抖窗口内最后的输入丢失。
  const handleCancel = (): void => {
    if (!editing) {
      const snapshot: Omit<OpeningWizardDraft, 'schemaVersion' | 'updatedAt'> = {
        step, creationMode, title, channel, categoryKey, mainTags, auxiliaryTags, storyTraits,
        protagonists, storyDirection, targetAudience, worldBackground, openingBackground, stageOne,
        fullBookOutline, initialMap, customTags, selectedMustFollow, mustFollowText,
        allSubjectsOpen, activeTagGroupKey
      };
      try {
        if (hasMeaningfulOpeningDraft(snapshot)) {
          const saved = saveOpeningWizardDraft(accountId, snapshot);
          void saveOpeningDraftToServer(saved as unknown as Record<string, unknown>).catch(() => undefined);
        }
      } catch { /* 本地缓存失败时仍尝试服务器保存 */ }
    }
    onCancel();
  };

  const wizardSteps = [
    { number: 1 as const, title: '选择起点' },
    { number: 2 as const, title: '作品方向' },
    { number: 3 as const, title: '初始角色' },
    { number: 4 as const, title: '题材与边界' }
  ];
  const currentStep = wizardSteps[step - 1]!;

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleCancel(); }}>
    <section className="dialog create-book-dialog complete-create-book-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-create-book-title">
      <div className="dialog-heading create-book-header"><div><span className="dialog-eyebrow">第{step}步 · {currentStep.title}</span><h2 id="complete-create-book-title">{editing ? '修改开书资料' : '创建一本新书'}</h2></div><button className="icon-button" type="button" aria-label={editing ? '关闭开书资料修改' : '关闭创建新书'} onClick={handleCancel}><XIcon /></button></div>
      <nav className="opening-wizard-steps" aria-label="开书步骤">{wizardSteps.map((item) => <button key={item.number} type="button" aria-label={`第${item.number}步：${item.title}`} aria-current={step === item.number ? 'step' : undefined} className={step === item.number ? 'active' : item.number < step ? 'complete' : ''} onClick={() => moveToStep(item.number)}><span>{item.number}</span><strong>{item.title}</strong></button>)}</nav>
      <div className="complete-create-book-body" ref={bodyRef}>
        {restoredNotice && <aside className="opening-draft-notice" role="status"><div><strong>已恢复上次没填完的资料</strong></div><button type="button" className="text-button" onClick={resetDraft}>清空重填</button></aside>}
        {draftSaveMessage !== null && !restoredNotice && <p className="opening-draft-save-state" role="status">{draftSaveMessage}</p>}
        {submitError !== null && <div className="create-book-validation-summary" role="alert"><strong>创建没有完成</strong><span>{submitError}</span></div>}
        {submitAttempted && missingByStep[step].length > 0 && <div className="create-book-validation-summary" role="alert" aria-live="assertive" tabIndex={-1} ref={validationSummaryRef}>
          <strong>请先补充以下内容</strong>
          <span>{missingByStep[step].join('、')}</span>
        </div>}
        {step === 1 && <section className="opening-form-section creation-mode-section">
          <div className="section-heading"><div><span>00</span><h3>创作方式</h3></div></div>
          <div className="creation-mode-options">
            <button className={creationMode === 'new' ? 'creation-mode-option selected' : 'creation-mode-option'} type="button" disabled={editing} aria-pressed={creationMode === 'new'} onClick={() => setCreationMode('new')}>
              <strong>从零创作</strong>
            </button>
            <button className={creationMode === 'continuation' ? 'creation-mode-option selected' : 'creation-mode-option'} type="button" disabled={editing} aria-pressed={creationMode === 'continuation'} onClick={() => setCreationMode('continuation')}>
              <strong>已有正文续写</strong>
            </button>
          </div>
          {editing && <p className="opening-edit-scope-note">创作方式不可修改。</p>}
        </section>}
        <div className="opening-primary-stack">
          {step === 2 && <section className="opening-form-section" id="opening-category-section" tabIndex={-1}>
          <div className="section-heading"><div><span>01</span><h3>书籍与分类</h3></div><small>全部必填</small></div>
          <label htmlFor="complete-book-title">书名</label>
          <div className="book-title-field"><input id="complete-book-title" aria-label="书名" value={title} onChange={(event) => setTitle(limitBookTitle(event.target.value))} placeholder="例如：长安簪影" autoFocus /><small aria-live="polite">最多{BOOK_TITLE_MAX_CHARACTERS}字 · {bookTitleCharacterCount(title)}/{BOOK_TITLE_MAX_CHARACTERS}</small></div>
          <fieldset className="channel-fieldset"><legend>创作频道</legend><div className="channel-options" role="radiogroup">{OPENING_CHANNELS.map((item) => {
            const selected = channel === item.id;
            return <button type="button" role="radio" aria-checked={selected} aria-label={item.label}
              className={selected ? 'channel-option selected' : 'channel-option'} key={item.id} onClick={() => {
                setChannel(item.id); setCategoryKey(null);
                if (protagonists.length === 1 && protagonists[0]?.name.trim().length === 0) {
                  updateProtagonist(0, { role: item.id === 'male' ? 'male_lead' : 'female_lead' });
                }
              }}><span><strong>{item.label}</strong></span></button>;
          })}</div></fieldset>
          <div className="taxonomy-heading"><strong>作品分类（单选）</strong></div>
          {taxonomyError !== null && <p className="inline-error" role="alert">{taxonomyError}</p>}
          <div className="category-options">{categories.map((item) => {
            const selected = categoryKey === item.key;
            return <button className={selected ? 'category-choice selected primary' : 'category-choice'} type="button" aria-pressed={selected} aria-label={selected ? `当前作品分类：${item.name}` : `选择作品分类：${item.name}`} key={item.key} onClick={() => {
              setCategoryKey(item.key);
              setActiveTagGroupKey('recommended');
            }}><strong>{item.name}</strong><small>{selected ? '当前分类' : item.description}</small></button>;
          })}</div>
          </section>}
          {step === 3 && <section className="opening-form-section" id="opening-protagonist-section" tabIndex={-1}>
            <div className="section-heading"><div><span>02</span><h3>初始角色</h3></div><button className="text-button" type="button" disabled={protagonists.length >= 8} onClick={() => setProtagonists([...protagonists, { role: 'co_lead', name: '', age: '', background: '', familyBackground: '', careerBackground: '', goldenFinger: '', personalities: [] }])}>+ 增加角色（{protagonists.length}/8）</button></div>
            {protagonists.map((protagonist, index) => <article className="protagonist-form-card" key={index}>
              <header><strong>角色 {index + 1}</strong>{protagonists.length > 1 && <button type="button" aria-label={`删除角色${index + 1}`} onClick={() => setProtagonists(protagonists.filter((_, itemIndex) => itemIndex !== index))}>删除</button>}</header>
              <div className="form-row two">
                <label htmlFor={`protagonist-role-${index}`}>角色身份<select id={`protagonist-role-${index}`} value={protagonist.role} onChange={(event) => updateProtagonist(index, { role: event.target.value as ProtagonistRole })}>{PROTAGONIST_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <div className="protagonist-name-field">
                  <div><label htmlFor={index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`}>姓名</label><button type="button" aria-label={`为角色${index + 1}取名`} onClick={() => setNamingProtagonistIndex(index)}><MagicWandIcon aria-hidden="true" />取名助手</button></div>
                  <input id={index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`} value={protagonist.name} onChange={(event) => updateProtagonist(index, { name: event.target.value })} placeholder="例如：林舟" maxLength={80} />
                </div>
              </div>
              <label htmlFor={index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`}>年龄<input id={index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`} type="number" min={0} max={99999} inputMode="numeric" value={protagonist.age} onChange={(event) => updateProtagonist(index, { age: event.target.value })} placeholder="例如：18" /></label>
              <label htmlFor={index === 0 ? 'opening-protagonist-family-background' : `protagonist-family-background-${index}`}>家庭背景<textarea id={index === 0 ? 'opening-protagonist-family-background' : `protagonist-family-background-${index}`} value={protagonist.familyBackground} onChange={(event) => updateProtagonist(index, { familyBackground: event.target.value })} placeholder="例如：出身边城小吏之家，父母早亡，与妹妹相依为命" rows={2} maxLength={2000} /></label>
              <label htmlFor={index === 0 ? 'opening-protagonist-career-background' : `protagonist-career-background-${index}`}>职业背景<textarea id={index === 0 ? 'opening-protagonist-career-background' : `protagonist-career-background-${index}`} value={protagonist.careerBackground} onChange={(event) => updateProtagonist(index, { careerBackground: event.target.value })} placeholder="例如：县衙书吏，管户籍档案；修仙文可写宗门身份" rows={2} maxLength={2000} /></label>
              <label htmlFor={index === 0 ? 'opening-protagonist-golden-finger' : `protagonist-golden-finger-${index}`}>金手指<textarea id={index === 0 ? 'opening-protagonist-golden-finger' : `protagonist-golden-finger-${index}`} value={protagonist.goldenFinger} onChange={(event) => updateProtagonist(index, { goldenFinger: event.target.value })} placeholder="主角独有的依仗或优势，没有可留空" rows={2} maxLength={2000} /></label>
              <PersonalityPicker
                groups={taxonomy?.personalityGroups ?? [{ key: 'all', name: '性格特点', description: '选择最能影响角色行动的特点。', options: taxonomy?.personalityOptions ?? [] }]}
                selected={protagonist.personalities}
                onToggle={(item) => toggleProtagonistPersonality(index, item)}
              />
            </article>)}
          </section>}
        </div>

        {step === 2 && <section className="opening-form-section story-direction-section">
          <div className="section-heading"><div><span>03</span><h3>故事方向</h3></div><small>必填 · 20至800字</small></div>
          <label htmlFor="opening-story-direction">故事方向<textarea id="opening-story-direction" aria-label="故事方向" value={storyDirection} onChange={(event) => setStoryDirection(event.target.value)} placeholder="例如：林舟收到一封来自未来的失踪通知，被迫调查城市记忆被改写的原因。她要找回姐姐，同时阻止下一次改写吞掉整座旧城。" rows={5} maxLength={800} /></label>
          <div className="story-direction-meta"><strong>{storyDirection.length}/800</strong></div>
        </section>}

        {step === 4 && <section className="opening-form-section tag-direction-section">
          <div className="section-heading"><div><span>04</span><h3>题材与标签</h3></div></div>
          <section className="subject-library">
            <StringTagPicker title="融合题材（多选）" hint={`建议2至5个，最多8个 · 已选 ${auxiliaryTags.length} 个`} kind="题材" options={subjectOptions.map((item) => item.name)} selected={auxiliaryTags} onToggle={(item) => toggleTag(item, auxiliaryTags, setAuxiliaryTags, 8)} blocked={blockedSubjectTags} />
            <button className="subject-toggle" type="button" aria-expanded={allSubjectsOpen} onClick={() => setAllSubjectsOpen(!allSubjectsOpen)}>{allSubjectsOpen ? '只看当前分类推荐' : '展开全部题材'}</button>
          </section>
          <details className="full-tag-library opening-more-options"><summary><span><strong>查看和调整主要标签</strong></span><b>{mainTags.length} 个已选</b></summary><div className="opening-more-options-body">
            <header className="tag-library-heading"><div><strong>完整标签库</strong></div><span>{taxonomy?.mainTags.length ?? 0} 个标签</span></header>
            <label htmlFor="opening-tag-search">搜索全部标签<input id="opening-tag-search" aria-label="搜索全部标签" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="高武、群像、探案……" /></label>
            <nav aria-label="标签库分组">
              <button className={activeTagGroupKey === 'recommended' ? 'selected' : ''} type="button" onClick={() => setActiveTagGroupKey('recommended')}>智能推荐</button>
              {availableTagGroups.map((group) => <button className={activeTagGroupKey === group.key ? 'selected' : ''} type="button" key={group.key} onClick={() => setActiveTagGroupKey(group.key)}>{group.name}</button>)}
            </nav>
            <StringTagPicker title={activeTagGroup?.name ?? '智能推荐标签'} hint={`已选 ${mainTags.length} 个，可增删`} kind="主要标签" options={matchingTags(normalizedTagQuery.length > 0 ? (taxonomy?.mainTags ?? []) : displayedTagOptions)} selected={mainTags} onToggle={toggleMainTag} blocked={blockedMainTags} />
          </div></details>
          <div className="custom-tag-row"><label htmlFor="complete-custom-tag">自定义标签</label><div><input id="complete-custom-tag" aria-label="自定义标签" maxLength={40} value={customTag} onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); } }} /><button type="button" aria-label="添加自定义标签" onClick={addCustomTag}><PlusIcon />添加</button></div></div>
          {customTags.length > 0 && <div className="selected-tag-strip">{customTags.map((item) => <button type="button" aria-label={`移除自定义标签：${item}`} key={item} onClick={() => setCustomTags(customTags.filter((tag) => tag !== item))}>{item}<XIcon /></button>)}</div>}
          <details className="boundary-panel" open>
            <summary><span><ShieldCheckIcon /><strong>必须遵守</strong></span><small>{mustFollow.length}/15 条</small></summary>
            <p>只写绝对不能接受的内容；没有额外要求就选"无额外限制"。</p>
            <section><header><strong>快速选择</strong></header><div className="tag-options"><button className={selectedMustFollow.includes('无额外限制') ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selectedMustFollow.includes('无额外限制')} aria-label={`${selectedMustFollow.includes('无额外限制') ? '取消' : '选择'}必须遵守：无额外限制`} onClick={() => toggleMustFollow('无额外限制')}>无额外限制</button></div></section>
            {(taxonomy?.boundaryGroups ?? []).map((group) => <section key={group.name}><header><strong>{group.name}</strong></header><div className="tag-options">{group.options.map((item) => {
              const selected = selectedMustFollow.includes(item);
              return <button className={selected ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selected} aria-label={`${selected ? '取消' : '选择'}必须遵守：${item}`} key={item} onClick={() => toggleMustFollow(item)}>{selected && <CheckCircleIcon />}{item}</button>;
            })}</div></section>)}
            <section className="boundary-custom-field"><label htmlFor="must-follow">自定义必须遵守<textarea id="must-follow" aria-label="自定义必须遵守" maxLength={6000} rows={3} value={mustFollowText} onChange={(event) => { setMustFollowText(event.target.value); if (event.target.value.trim().length > 0) setSelectedMustFollow((items) => items.filter((item) => item !== '无额外限制')); }} placeholder="每行一条；例如：不靠巧合解决核心冲突" /></label>{mustFollow.length > 15 && <small className="inline-error" role="alert">必须遵守最多15条，请减少{mustFollow.length - 15}条。</small>}</section>
          </details>
        </section>}
      </div>
      <footer className="create-book-footer"><div><strong>{title.trim() || '未命名新书'}</strong><span>第{step}/4步 · {currentStep.title}</span>{missingByStep[step].length > 0 && <small className="create-book-requirements">{submitAttempted ? '请先补充' : '本步还需填写'}：{missingByStep[step].join('、')}</small>}</div><div><button className="secondary-button" type="button" onClick={handleCancel}>取消</button>{step > 1 && <button className="secondary-button" type="button" onClick={() => moveToStep((step - 1) as 1 | 2 | 3)}>上一步</button>}{step < 4 ? <button className="primary-button" type="button" onClick={() => moveToStep((step + 1) as 2 | 3 | 4)}>下一步</button> : <button className="primary-button" type="button" disabled={busy || submitting} onClick={() => void submit()}>{busy || submitting ? (editing ? '正在保存' : '正在创建') : editing ? '保存修改' : '创建书籍'}</button>}</div></footer>
      {namingProtagonistIndex !== null && namingProtagonist !== null && <div className="naming-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNamingProtagonistIndex(null); }}>
        <section className="naming-dialog" role="dialog" aria-modal="true" aria-label={`角色${namingProtagonistIndex + 1}取名助手`}>
          <button className="icon-button naming-dialog-close" type="button" aria-label="关闭取名助手" onClick={() => setNamingProtagonistIndex(null)}><XIcon /></button>
          <NamingAssistantPanel
            compact
            action="fill"
            context={namingContext}
            initialTargetId={recommendCharacterTarget(namingProtagonist.role)}
            exclude={protagonists.filter((_, index) => index !== namingProtagonistIndex).map((item) => item.name).filter(Boolean)}
            onSelect={(name) => updateProtagonist(namingProtagonistIndex, { name })}
          />
          <footer><button className="primary-button" type="button" onClick={() => setNamingProtagonistIndex(null)}>完成</button></footer>
        </section>
      </div>}
    </section>
  </div>;
}

function openingProfileDraft(profile: BookProfileViewData): OpeningWizardDraft {
  const blueprint = profile.openingBlueprint;
  return {
    ...emptyOpeningWizardDraft(),
    step: 2,
    creationMode: blueprint.creationMode,
    title: profile.title,
    channel: blueprint.channel,
    categoryKey: blueprint.categoryKey,
    mainTags: [...blueprint.mainTags],
    auxiliaryTags: [...blueprint.auxiliaryTags],
    storyTraits: [...blueprint.storyTraits],
    protagonists: blueprint.protagonists.map((item) => ({
      role: item.role,
      name: item.name,
      age: item.age,
      background: '',
      familyBackground: item.familyBackground ?? item.background ?? '',
      careerBackground: item.careerBackground ?? '',
      goldenFinger: item.goldenFinger ?? '',
      personalities: [...item.personalities]
    })),
    storyDirection: blueprint.storyDirection,
    targetAudience: blueprint.targetAudience,
    worldBackground: blueprint.worldBackground,
    openingBackground: blueprint.openingBackground,
    stageOne: { ...blueprint.stageOne },
    fullBookOutline: blueprint.fullBookOutline,
    initialMap: blueprint.initialMap,
    customTags: [...blueprint.customTags],
    selectedMustFollow: blueprint.mustFollow.includes('无额外限制') ? ['无额外限制'] : [],
    mustFollowText: blueprint.mustFollow.filter((item) => item !== '无额外限制').join('\n')
  };
}

function StringTagPicker({ title, hint, kind, options, selected, onToggle, blocked }: {
  title: string; hint: string; kind: string; options: string[]; selected: string[]; onToggle: (name: string) => void;
  blocked?: ReadonlySet<string>;
}): React.JSX.Element {
  return <section className="tag-picker"><header><strong>{title}</strong><small>{hint}</small></header><div className="tag-options">{options.map((name) => {
    const active = selected.includes(name);
    const isBlocked = !active && (blocked?.has(name) ?? false);
    return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={isBlocked ? `${kind}：${name}（已在其他分组使用）` : `${active ? '取消' : '选择'}${kind}：${name}`} title={isBlocked ? '已在其他分组使用' : undefined} disabled={isBlocked} key={name} onClick={() => onToggle(name)}>{active && <CheckCircleIcon />}{name}</button>;
  })}</div></section>;
}

function PersonalityPicker({ groups, selected, onToggle }: {
  groups: OpeningTaxonomyData['personalityGroups'];
  selected: string[];
  onToggle: (name: string) => void;
}): React.JSX.Element {
  const [custom, setCustom] = useState('');
  const addCustom = (): void => {
    const value = custom.trim();
    if (value.length === 0 || value.length > 40 || selected.includes(value) || selected.length >= 12) return;
    onToggle(value);
    setCustom('');
  };
  const known = new Set(groups.flatMap((group) => group.options));
  const customSelected = selected.filter((item) => !known.has(item));
  return <section className="personality-picker">
    <header>
      <div><strong>角色性格</strong><small>选 1—12 个，挑最能影响这个角色做决定的</small></div>
      <span>{selected.length}/12</span>
    </header>
    <div className="personality-group-grid">{groups.map((group) => <details key={group.key} open={group.key === 'surface' || group.key === 'decision'}>
      <summary><span><strong>{group.name}</strong><small>{group.description}</small></span><b>{group.options.filter((item) => selected.includes(item)).length || '展开'}</b></summary>
      <div className="tag-options">{group.options.map((name) => {
        const active = selected.includes(name);
        return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={`${active ? '取消' : '选择'}角色性格：${name}`} key={name} onClick={() => onToggle(name)} disabled={!active && selected.length >= 12}>{active && <CheckCircleIcon />}{name}</button>;
      })}</div>
    </details>)}</div>
    <div className="personality-custom-row">
      <label htmlFor="opening-custom-personality">自定义性格</label>
      <div><input id="opening-custom-personality" value={custom} maxLength={40} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} placeholder="例如：越害怕越爱说反话" /><button type="button" disabled={selected.length >= 12 || custom.trim().length === 0} onClick={addCustom}><PlusIcon />添加</button></div>
    </div>
    {customSelected.length > 0 && <div className="selected-tag-strip">{customSelected.map((item) => <button type="button" key={item} onClick={() => onToggle(item)}>{item}<XIcon /></button>)}</div>}
  </section>;
}

