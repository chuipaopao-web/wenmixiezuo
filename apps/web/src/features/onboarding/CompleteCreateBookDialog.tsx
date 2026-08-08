import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  MagicWandIcon,
  PlusIcon,
  ShieldCheckIcon,
  TagIcon,
  XIcon
} from '@phosphor-icons/react';
import {
  createBook,
  fetchOpeningTaxonomy,
  type OpeningBlueprintData,
  type OpeningChannel,
  type OpeningTaxonomyData,
  type ProtagonistRole
} from '../../lib/api/client';
import { NamingAssistantPanel } from '../../app/NamingAssistantPanel';
import { recommendCharacterTarget, type NamingContext } from '../../app/naming-assistant';
import { OPENING_CHANNELS, PROTAGONIST_ROLES } from './opening-options';

interface OpeningProtagonistDraft {
  role: ProtagonistRole;
  name: string;
  age: string;
  background: string;
  personalities: string[];
}

export function CompleteCreateBookDialog({ busy, onCancel, onCreate }: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: Parameters<typeof createBook>[0]) => Promise<void>;
}): React.JSX.Element {
  const [taxonomy, setTaxonomy] = useState<OpeningTaxonomyData | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creationMode, setCreationMode] = useState<'new' | 'continuation'>('new');
  const [channel, setChannel] = useState<OpeningChannel | null>(null);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [mainTags, setMainTags] = useState<string[]>([]);
  const [auxiliaryTags, setAuxiliaryTags] = useState<string[]>([]);
  const [storyTraits] = useState<string[]>([]);
  const [protagonists, setProtagonists] = useState<OpeningProtagonistDraft[]>([
    { role: 'co_lead', name: '', age: '', background: '', personalities: [] }
  ]);
  const [namingProtagonistIndex, setNamingProtagonistIndex] = useState<number | null>(null);
  const [storyDirection, setStoryDirection] = useState('');
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [allSubjectsOpen, setAllSubjectsOpen] = useState(false);
  const [activeTagGroupKey, setActiveTagGroupKey] = useState('recommended');
  const [selectedMustFollow, setSelectedMustFollow] = useState<string[]>([]);
  const [mustFollowText, setMustFollowText] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
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
  const tagRecommendationSignature = `${taxonomy?.version ?? ''}|${categoryKey ?? ''}|${[...auxiliaryTags].sort().join('|')}`;
  useEffect(() => {
    if (taxonomy === null || category === null || automaticTagSignature.current === tagRecommendationSignature) return;
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
  }, [taxonomy, category, tagRecommendationSignature]);
  const customMustFollow = mustFollowText.split(/[；;\n\r]+/u).map((item) => item.trim()).filter(Boolean);
  const mustFollow = [...new Set([...selectedMustFollow, ...customMustFollow])];
  const missingRequirements = [
    ...(taxonomy === null ? ['分类目录'] : []),
    ...(title.trim().length === 0 ? ['书名'] : []),
    ...(channel === null ? ['创作频道'] : []),
    ...(category === null ? ['作品分类'] : []),
    ...(mainTags.length < 2 ? ['至少2个主要标签'] : []),
    ...protagonists.flatMap((item, index) => [
      ...(item.name.trim().length === 0 ? [`主角${index + 1}姓名`] : []),
      ...(item.age.trim().length === 0 ? [`主角${index + 1}年龄或生命阶段`] : []),
      ...(item.background.trim().length === 0 ? [`主角${index + 1}人物背景`] : []),
      ...(item.personalities.length === 0 ? [`主角${index + 1}至少1个性格`] : [])
    ]),
    ...(storyDirection.trim().length < 20 ? ['故事方向至少20字'] : []),
    ...(mustFollow.length === 0 ? ['必须遵守'] : []),
    ...(mustFollow.length > 15 ? ['必须遵守最多15条'] : [])
  ];
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
      : current.personalities.length >= 6 ? current.personalities : [...current.personalities, personality];
    updateProtagonist(index, { personalities: next });
  };
  const addCustomTag = (): void => {
    const value = customTag.trim().replace(/^#+/u, '');
    if (value.length === 0 || customTags.includes(value) || customTags.length >= 13) return;
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
  const submit = (): void => {
    if (!valid || taxonomy === null || channel === null || category === null) {
      setSubmitAttempted(true);
      window.requestAnimationFrame(() => {
        const firstMissingTarget = taxonomy === null
          ? null
          : title.trim().length === 0
            ? document.getElementById('complete-book-title')
            : channel === null
              ? document.querySelector<HTMLInputElement>('input[name="complete-book-channel"]')
              : category === null
                ? document.getElementById('opening-category-section')
                : mainTags.length < 2
                  ? document.getElementById('opening-tag-search')
                  : protagonists.flatMap((item, index) => [
                      ...(item.name.trim().length === 0 ? [index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`] : []),
                      ...(item.age.trim().length === 0 ? [index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`] : []),
                      ...(item.background.trim().length === 0 ? [index === 0 ? 'opening-protagonist-background' : `protagonist-background-${index}`] : [])
                    ]).map((id) => document.getElementById(id)).find((element) => element !== null)
                    ?? (protagonists.some((item) => item.personalities.length === 0) ? document.getElementById('opening-protagonist-section') : null)
                    ?? (storyDirection.trim().length < 20 ? document.getElementById('opening-story-direction') : null)
                    ?? document.getElementById('must-follow');
        const target = firstMissingTarget ?? validationSummaryRef.current;
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      });
      return;
    }
    const openingBlueprint: OpeningBlueprintData = {
      creationMode,
      taxonomyVersion: taxonomy.version,
      channel,
      categoryKey: category.key,
      targetAudience: '',
      protagonists: protagonists.map((item) => ({
        ...item,
        name: item.name.trim(),
        age: item.age.trim(),
        background: item.background.trim()
      })),
      storyDirection: storyDirection.trim(),
      worldBackground: '',
      openingBackground: '',
      stageOne: { start: '', development: '', end: '' },
      fullBookOutline: '',
      mainTags, auxiliaryTags, storyTraits, customTags, mustFollow,
      styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
      initialMap: ''
    };
    void onCreate({
      title: title.trim(), text: storyDirection.trim(), category: category.name,
      classification: channel === 'male' ? '男频' : '女频',
      targetAudience: '',
      tags: [category.name, ...mainTags, ...auxiliaryTags, ...storyTraits, ...customTags, ...mustFollow.map((item) => `必须遵守：${item}`)],
      openingBlueprint
    });
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog create-book-dialog complete-create-book-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-create-book-title">
      <div className="dialog-heading create-book-header"><div><span className="dialog-eyebrow">第一步 · 基本信息</span><h2 id="complete-create-book-title">创建一本新书</h2><p>{creationMode === 'continuation' ? '先建立书籍档案，建书后直接导入已有正文，再按章拆解已有内容。' : '这里只确定作品定位。建书后由主编先引导完善设定大纲，再讨论剧情。'}</p></div><button className="icon-button" type="button" aria-label="关闭创建新书" onClick={onCancel}><XIcon /></button></div>
      <div className="complete-create-book-body">
        {submitAttempted && missingRequirements.length > 0 && <div className="create-book-validation-summary" role="alert" aria-live="assertive" tabIndex={-1} ref={validationSummaryRef}>
          <strong>还不能创建，请先补充以下开书资料</strong>
          <span>{missingRequirements.join('、')}</span>
        </div>}
        <section className="opening-form-section creation-mode-section">
          <div className="section-heading"><div><span>00</span><h3>创作方式</h3></div><small>请选择一种</small></div>
          <div className="creation-mode-options">
            <button className={creationMode === 'new' ? 'creation-mode-option selected' : 'creation-mode-option'} type="button" aria-pressed={creationMode === 'new'} onClick={() => setCreationMode('new')}>
              <strong>从零创作</strong><span>先完善设定大纲，再规划阶段剧情和正文。</span>
            </button>
            <button className={creationMode === 'continuation' ? 'creation-mode-option selected' : 'creation-mode-option'} type="button" aria-pressed={creationMode === 'continuation'} onClick={() => setCreationMode('continuation')}>
              <strong>已有正文续写</strong><span>建书后直接进入正文，导入并逐章拆解已有内容。</span>
            </button>
          </div>
        </section>
        <div className="opening-primary-stack">
          <section className="opening-form-section" id="opening-category-section" tabIndex={-1}>
          <div className="section-heading"><div><span>01</span><h3>书籍与分类</h3></div><small>全部必填</small></div>
          <label htmlFor="complete-book-title">书名</label>
          <input id="complete-book-title" aria-label="书名" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：长安簪影" autoFocus />
          <fieldset className="channel-fieldset"><legend>创作频道</legend><div className="channel-options">{OPENING_CHANNELS.map((item) => <label className={channel === item.id ? 'channel-option selected' : 'channel-option'} key={item.id}><input type="radio" name="complete-book-channel" aria-label={item.label} checked={channel === item.id} onChange={() => {
            setChannel(item.id); setCategoryKey(null);
            if (protagonists.length === 1 && protagonists[0]?.name.trim().length === 0) {
              updateProtagonist(0, { role: item.id === 'male' ? 'male_lead' : 'female_lead' });
            }
          }} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div></fieldset>
          <div className="taxonomy-heading"><strong>作品分类（单选）</strong><small>一本书只确定一个主分类</small></div>
          {taxonomyError !== null && <p className="inline-error" role="alert">{taxonomyError}</p>}
          <div className="category-options">{categories.map((item) => {
            const selected = categoryKey === item.key;
            return <button className={selected ? 'category-choice selected primary' : 'category-choice'} type="button" aria-pressed={selected} aria-label={selected ? `当前作品分类：${item.name}` : `选择作品分类：${item.name}`} key={item.key} onClick={() => {
              setCategoryKey(item.key);
              setActiveTagGroupKey('recommended');
            }}><strong>{item.name}</strong><small>{selected ? '当前分类' : item.description}</small></button>;
          })}</div>
          {taxonomy !== null && <p className="taxonomy-notice">目录版本 {taxonomy.version} · {taxonomy.notice}</p>}
          </section>
          <section className="opening-form-section" id="opening-protagonist-section" tabIndex={-1}>
            <div className="section-heading"><div><span>02</span><h3>初始主角</h3></div><button className="text-button" type="button" disabled={protagonists.length >= 8} onClick={() => setProtagonists([...protagonists, { role: 'co_lead', name: '', age: '', background: '', personalities: [] }])}>+ 增加角色（{protagonists.length}/8）</button></div>
            {protagonists.map((protagonist, index) => <article className="protagonist-form-card" key={index}>
              <header><strong>角色 {index + 1}</strong>{protagonists.length > 1 && <button type="button" aria-label={`删除角色${index + 1}`} onClick={() => setProtagonists(protagonists.filter((_, itemIndex) => itemIndex !== index))}>删除</button>}</header>
              <div className="form-row two">
                <label htmlFor={`protagonist-role-${index}`}>主角身份<select id={`protagonist-role-${index}`} value={protagonist.role} onChange={(event) => updateProtagonist(index, { role: event.target.value as ProtagonistRole })}>{PROTAGONIST_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <div className="protagonist-name-field">
                  <div><label htmlFor={index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`}>姓名</label><button type="button" aria-label={`为角色${index + 1}取名`} onClick={() => setNamingProtagonistIndex(index)}><MagicWandIcon aria-hidden="true" />取名助手</button></div>
                  <input id={index === 0 ? 'opening-protagonist-name' : `protagonist-name-${index}`} value={protagonist.name} onChange={(event) => updateProtagonist(index, { name: event.target.value })} placeholder="例如：林舟" maxLength={80} />
                </div>
              </div>
              <label htmlFor={index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`}>年龄或生命阶段<input id={index === 0 ? 'opening-protagonist-age' : `protagonist-age-${index}`} value={protagonist.age} onChange={(event) => updateProtagonist(index, { age: event.target.value })} placeholder="例如：十八岁、成年、初入职场" maxLength={80} /></label>
              <label htmlFor={index === 0 ? 'opening-protagonist-background' : `protagonist-background-${index}`}>人物背景<textarea id={index === 0 ? 'opening-protagonist-background' : `protagonist-background-${index}`} value={protagonist.background} onChange={(event) => updateProtagonist(index, { background: event.target.value })} placeholder="写清开篇身份、处境、已有资源与主要困境" rows={3} maxLength={2000} /></label>
              <StringTagPicker title="角色性格" hint="至少1个，最多6个" kind="角色性格" options={taxonomy?.personalityOptions ?? []} selected={protagonist.personalities} onToggle={(item) => toggleProtagonistPersonality(index, item)} />
            </article>)}
          </section>
        </div>

        <section className="opening-form-section story-direction-section">
          <div className="section-heading"><div><span>03</span><h3>故事方向</h3></div><small>必填 · 20至800字</small></div>
          <p className="story-direction-intro">不用先写完整大纲。简要写清主角开篇处境、启动事件、想达成什么、主要阻力和大致走向，主编会据此引导完善设定与剧情。</p>
          <label htmlFor="opening-story-direction">故事方向<textarea id="opening-story-direction" aria-label="故事方向" value={storyDirection} onChange={(event) => setStoryDirection(event.target.value)} placeholder="例如：林舟收到一封来自未来的失踪通知，被迫调查城市记忆被改写的原因。她要找回姐姐，同时阻止下一次改写吞掉整座旧城。" rows={5} maxLength={800} /></label>
          <div className="story-direction-meta"><span>这只是可以继续修改的故事方向，不是剧情总纲，也不代表故事已经发生。</span><strong>{storyDirection.length}/800</strong></div>
        </section>

        <section className="opening-form-section tag-direction-section">
          <div className="section-heading"><div><span>04</span><h3>题材与标签</h3></div><small>一个主分类 + 多个题材</small></div>
          <div className="creative-freedom-note"><TagIcon /><div><strong>主要选择 + 其他自由发挥</strong><p>标签只确定主要方向；分类和题材也不是每章必须执行的清单，未选择的元素可以随剧情自然加入。</p></div></div>
          <section className="subject-library">
            <StringTagPicker title="融合题材（多选）" hint={`来自起点二级分类与番茄作品题材；建议2至5个，最多8个；当前已选 ${auxiliaryTags.length} 个`} kind="题材" options={subjectOptions.map((item) => item.name)} selected={auxiliaryTags} onToggle={(item) => toggleTag(item, auxiliaryTags, setAuxiliaryTags, 8)} />
            <button className="subject-toggle" type="button" aria-expanded={allSubjectsOpen} onClick={() => setAllSubjectsOpen(!allSubjectsOpen)}>{allSubjectsOpen ? '只看当前分类推荐' : '展开全部题材'}</button>
          </section>
          <section className="full-tag-library">
            <header className="tag-library-heading"><div><strong>完整标签库</strong><small>根据主分类和题材优先推荐，也可切换分组或搜索全部词条</small></div><span>{taxonomy?.mainTags.length ?? 0} 个标签</span></header>
            <label htmlFor="opening-tag-search">搜索全部标签<input id="opening-tag-search" aria-label="搜索全部标签" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="高武、群像、探案……" /></label>
            <nav aria-label="标签库分组">
              <button className={activeTagGroupKey === 'recommended' ? 'selected' : ''} type="button" onClick={() => setActiveTagGroupKey('recommended')}>智能推荐</button>
              {availableTagGroups.map((group) => <button className={activeTagGroupKey === group.key ? 'selected' : ''} type="button" key={group.key} onClick={() => setActiveTagGroupKey(group.key)}>{group.name}</button>)}
            </nav>
            <p className="tag-context-note">当前依据：{category?.name ?? '未选分类'}{auxiliaryTags.length > 0 ? ` · ${auxiliaryTags.join(' · ')}` : ' · 尚未选择题材'}</p>
            <StringTagPicker title={activeTagGroup?.name ?? '智能推荐标签'} hint={`已自动推荐8个；当前共选 ${mainTags.length} 个，不限数量，可继续增删`} kind="主要标签" options={matchingTags(normalizedTagQuery.length > 0 ? (taxonomy?.mainTags ?? []) : displayedTagOptions)} selected={mainTags} onToggle={toggleMainTag} />
          </section>
          <div className="custom-tag-row"><label htmlFor="complete-custom-tag">自定义标签</label><div><input id="complete-custom-tag" aria-label="自定义标签" maxLength={40} value={customTag} onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); } }} /><button type="button" aria-label="添加自定义标签" onClick={addCustomTag}><PlusIcon />添加</button></div></div>
          {customTags.length > 0 && <div className="selected-tag-strip">{customTags.map((item) => <button type="button" aria-label={`移除自定义标签：${item}`} key={item} onClick={() => setCustomTags(customTags.filter((tag) => tag !== item))}>{item}<XIcon /></button>)}</div>}
          <details className="boundary-panel" open>
            <summary><span><ShieldCheckIcon /><strong>必须遵守</strong></span><small>{mustFollow.length}/15 条</small></summary>
            <p>这里只填写你明确不能接受、以后也不能改变的内容。没有额外要求可直接选择“无额外限制”。</p>
            <section><header><strong>快速选择</strong><small>与下方自定义内容合计最多15条</small></header><div className="tag-options"><button className={selectedMustFollow.includes('无额外限制') ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selectedMustFollow.includes('无额外限制')} aria-label={`${selectedMustFollow.includes('无额外限制') ? '取消' : '选择'}必须遵守：无额外限制`} onClick={() => toggleMustFollow('无额外限制')}>无额外限制</button></div></section>
            {(taxonomy?.boundaryGroups ?? []).map((group) => <section key={group.name}><header><strong>{group.name}</strong><small>{group.description}</small></header><div className="tag-options">{group.options.map((item) => {
              const selected = selectedMustFollow.includes(item);
              return <button className={selected ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selected} aria-label={`${selected ? '取消' : '选择'}必须遵守：${item}`} key={item} onClick={() => toggleMustFollow(item)}>{selected && <CheckCircleIcon />}{item}</button>;
            })}</div></section>)}
            <section className="boundary-custom-field"><label htmlFor="must-follow">自定义必须遵守<textarea id="must-follow" aria-label="自定义必须遵守" maxLength={6000} rows={3} value={mustFollowText} onChange={(event) => { setMustFollowText(event.target.value); if (event.target.value.trim().length > 0) setSelectedMustFollow((items) => items.filter((item) => item !== '无额外限制')); }} placeholder="每行一条；例如：不靠巧合解决核心冲突" /></label>{mustFollow.length > 15 && <small className="inline-error" role="alert">必须遵守最多15条，请减少{mustFollow.length - 15}条。</small>}</section>
          </details>
        </section>
      </div>
      <footer className="create-book-footer"><div><strong>{title.trim() || '未命名新书'}</strong><span>{channel === null ? '请选择频道' : channel === 'male' ? '男频' : '女频'} · {category?.name ?? '未选分类'} · {creationMode === 'continuation' ? '建书后直接导入已有正文' : '建书后由主编接待并进入设定大纲'}</span>{missingRequirements.length > 0 && <small className="create-book-requirements">{submitAttempted ? '请先补充' : '还需填写'}：{missingRequirements.join('、')}</small>}</div><div><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={busy} onClick={submit}>{busy ? '正在创建' : creationMode === 'continuation' ? '创建并导入正文' : '创建并进入设定'}</button></div></footer>
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
          <footer><span>选中的名字只会填入姓名框，您仍可修改。</span><button className="primary-button" type="button" onClick={() => setNamingProtagonistIndex(null)}>完成</button></footer>
        </section>
      </div>}
    </section>
  </div>;
}

function StringTagPicker({ title, hint, kind, options, selected, onToggle }: {
  title: string; hint: string; kind: string; options: string[]; selected: string[]; onToggle: (name: string) => void;
}): React.JSX.Element {
  return <section className="tag-picker"><header><strong>{title}</strong><small>{hint}</small></header><div className="tag-options">{options.map((name) => {
    const active = selected.includes(name);
    return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={`${active ? '取消' : '选择'}${kind}：${name}`} key={name} onClick={() => onToggle(name)}>{active && <CheckCircleIcon />}{name}</button>;
  })}</div></section>;
}

