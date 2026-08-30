import { CaretDownIcon, CheckCircleIcon, MagicWandIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { CharacterNamingDialog, characterNamingContext } from './CharacterNamingDialog';
import { ImeInput, ImeTextarea } from './ImeSafeField';
import type { OpeningPackage, OpeningProtagonist, OpeningTaxonomy } from './opening-api';
import { parseVisualTags, serializeVisualTags, VISUAL_IDENTITY_TAG_GROUPS, type VisualTagGroup } from './visual-identity-tags';

const ROLE_OPTIONS = ['男主', '女主', '共同主角', '群像主角', '非人主角'] as const;
const LONG_LIMIT = 800;

export function emptyOpeningPackage(): OpeningPackage {
  return {
    title: '',
    positioning: {
      publishingPlatform: 'fanqie', channel: 'male', category: '', genres: [], tags: [], coreAppeal: '', expectedTotalWords: 0
    },
    backgrounds: { eraAndWorld: '', openingSituation: '' },
    protagonists: [emptyManualProtagonist('male')],
    opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
    longTermDirection: { centralConflict: '', progression: '', relationshipDirection: '', storyPotential: '' },
    possibleEnding: { direction: '', price: '', openness: '' },
    authorNotes: [],
    mustFollow: []
  };
}

function boundaryOptionLabel(option: string): string {
  return option === '不写后宫' ? '不要后宫' : option;
}

export interface ManualOpeningValidation {
  stepOne: string[];
  stepTwo: string[];
  all: string[];
}

export function validateManualOpening(
  value: OpeningPackage,
  taxonomy: OpeningTaxonomy | null
): ManualOpeningValidation {
  const channel = value.positioning.channel;
  const categoryValid = channel !== 'general' && taxonomy?.categories.some((item) => (
    item.channel === channel && item.name === value.positioning.category
  ));
  const stepOne = [
    ...(Array.from(value.title.trim()).length < 2 ? ['书名至少2字'] : []),
    ...(Array.from(value.title.trim()).length > 15 ? ['书名最多15字'] : []),
    ...(channel === 'general' ? ['创作频道'] : []),
    ...(taxonomy === null ? ['分类目录'] : []),
    ...(!categoryValid ? ['作品分类'] : []),
    ...(value.positioning.expectedTotalWords < 100_000 || value.positioning.expectedTotalWords > 10_000_000 ? ['预计总字数'] : [])
  ];
  const protagonists = value.protagonists.flatMap((item, index) => [
    ...(item.name.trim().length === 0 ? [`角色${index + 1}姓名`] : []),
    ...(item.age.trim().length === 0 ? [`角色${index + 1}年龄`] : []),
    ...(item.background.trim().length === 0 ? [`角色${index + 1}角色背景`] : []),
    ...(item.personality.length === 0 ? [`角色${index + 1}至少1个性格`] : [])
  ]);
  const mustFollow = value.mustFollow ?? [];
  const stepTwo = [
    ...(value.protagonists.length < 1 || value.protagonists.length > 2 ? ['角色需要1至2位'] : []),
    ...protagonists,
    ...(mustFollow.length === 0 ? ['必须遵守'] : []),
    ...(mustFollow.length > 15 ? ['必须遵守最多15条'] : []),
    ...(value.possibleEnding.direction.trim().length === 1 ? ['结局至少2字'] : [])
  ];
  return { stepOne, stepTwo, all: [...stepOne, ...stepTwo] };
}

function emptyManualProtagonist(channel: OpeningPackage['positioning']['channel']): OpeningProtagonist {
  return {
    name: '', age: '', identity: channel === 'female' ? '女主' : '男主', background: '',
    familyBackground: '', careerBackground: '', goldenFinger: '', goal: '', dilemma: '',
    visualIdentity: { appearance: '', build: '', signatureFeature: '' },
    personality: [], boundary: ''
  };
}

function TextAreaField({ id, label, value, onChange, placeholder, rows = 3 }: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}): React.JSX.Element {
  return <OpeningFieldDisclosure label={label} value={value}>
    <label className="manual-field" htmlFor={id}><span>{label}</span><ImeTextarea id={id} aria-label={label} value={value} onChange={onChange} maxChars={LONG_LIMIT} rows={rows} placeholder={placeholder} /><small>{Array.from(value).length}/{LONG_LIMIT}</small></label>
  </OpeningFieldDisclosure>;
}

function OpeningFieldDisclosure({ label, value, children }: {
  label: string;
  value: string | string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const text = (Array.isArray(value) ? value.join('、') : value).trim();
  return <details className="opening-field-disclosure">
    <summary>
      <span><strong>{label}</strong><small>{text.length > 0 ? text : '未填写'}</small></span>
      <b>{text.length > 0 ? '修改' : '填写'}</b>
    </summary>
    <div className="opening-field-editor">{children}</div>
  </details>;
}

function PersonalityPicker({ index, taxonomy, selected, onChange }: {
  index: number;
  taxonomy: OpeningTaxonomy | null;
  selected: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  const [custom, setCustom] = useState('');
  const groups = taxonomy?.personalityGroups ?? [{ key: 'common', name: '性格特点', description: '', options: ['谨慎', '果断', '重情义', '理性', '敏锐', '坚韧'] }];
  const known = new Set(groups.flatMap((group) => group.options));
  const addCustom = () => {
    const next = custom.trim();
    if (next.length === 0 || selected.includes(next) || selected.length >= 12) return;
    onChange([...selected, next]);
    setCustom('');
  };
  return <section className="manual-personality">
    <header><strong>角色性格</strong><small>至少1项 · {selected.length}/12</small></header>
    {groups.map((group) => <details key={group.key} open={group.key === 'surface' || group.key === 'decision' || groups.length === 1}>
      <summary>{group.name}</summary>
      <div className="manual-chip-grid">{group.options.map((name) => {
        const active = selected.includes(name);
        return <button className={active ? 'selected' : ''} type="button" key={name} disabled={!active && selected.length >= 12} onClick={() => onChange(active ? selected.filter((item) => item !== name) : [...selected, name])}>{active && <CheckCircleIcon />}{name}</button>;
      })}</div>
    </details>)}
    <div className="manual-custom-row"><ImeInput aria-label={`角色${index + 1}自定义性格`} maxChars={40} value={custom} onChange={setCustom} placeholder="自定义性格" /><button type="button" disabled={custom.trim().length === 0 || selected.length >= 12} onClick={addCustom}><PlusIcon />添加</button></div>
    {selected.some((item) => !known.has(item)) && <div className="manual-chip-grid compact">{selected.filter((item) => !known.has(item)).map((item) => <button className="selected" type="button" key={item} onClick={() => onChange(selected.filter((value) => value !== item))}>{item} ×</button>)}</div>}
  </section>;
}

function VisualTagPicker({ id, label, hint, groups, value, maximum, onChange }: {
  id: string;
  label: string;
  hint: string;
  groups: VisualTagGroup[];
  value: string;
  maximum: number;
  onChange: (next: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const selected = useMemo(() => parseVisualTags(value), [value]);
  const normalizedQuery = query.trim();
  const visibleGroups = groups.map((group) => ({
    ...group,
    options: group.options.filter((option) => normalizedQuery.length === 0 || option.includes(normalizedQuery))
  })).filter((group) => group.options.length > 0);
  const resultCount = visibleGroups.reduce((total, group) => total + group.options.length, 0);
  const setSelected = (next: string[]) => onChange(serializeVisualTags(next));
  const toggle = (option: string) => {
    if (selected.includes(option)) setSelected(selected.filter((item) => item !== option));
    else if (selected.length < maximum) setSelected([...selected, option]);
  };
  const addCustom = () => {
    const next = custom.trim();
    if (next.length === 0 || selected.includes(next) || selected.length >= maximum) return;
    setSelected([...selected, next]);
    setCustom('');
  };
  return <details className="manual-visual-tag-picker">
    <summary><span><strong>{label}</strong><small>{hint}</small></span><b>{selected.length > 0 ? `${selected.length}/${maximum}` : '选择'}</b></summary>
    <div className="manual-visual-tag-content">
      {selected.length > 0 && <div className="manual-chip-grid compact selected-visual-tags">{selected.map((item) => <button className="selected" type="button" key={item} onClick={() => toggle(item)}>{item} ×</button>)}</div>}
      <div className="manual-tag-search"><ImeInput aria-label={`搜索${label}标签`} maxChars={30} value={query} onChange={setQuery} placeholder={`搜索${label}标签`} />{normalizedQuery.length > 0 && <button type="button" onClick={() => setQuery('')}>清空</button>}</div>
      {normalizedQuery.length > 0 && <p className="manual-search-result" role="status">{resultCount > 0 ? `找到 ${resultCount} 个标签` : '没有找到，可以在下方自己添加。'}</p>}
      <div className="manual-visual-tag-groups">{visibleGroups.map((group) => <details key={group.key} open={normalizedQuery.length > 0 ? true : undefined}><summary>{group.name}</summary><div className="manual-chip-grid">{group.options.map((option) => {
        const active = selected.includes(option);
        return <button className={active ? 'selected' : ''} aria-pressed={active} type="button" key={option} disabled={!active && selected.length >= maximum} onClick={() => toggle(option)}>{active && <CheckCircleIcon />}{option}</button>;
      })}</div></details>)}</div>
      <div className="manual-custom-row"><ImeInput id={`${id}-custom`} aria-label={`${label}自定义特征`} maxChars={40} value={custom} onChange={setCustom} placeholder={`补充自己的${label}特征`} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} /><button type="button" disabled={custom.trim().length === 0 || selected.length >= maximum} onClick={addCustom}><PlusIcon />添加</button></div>
    </div>
  </details>;
}

export function ManualOpeningForm({ value, taxonomy, onChange, step, onStepChange }: {
  value: OpeningPackage;
  taxonomy: OpeningTaxonomy | null;
  onChange: (next: OpeningPackage) => void;
  step: 1 | 2;
  onStepChange: (next: 1 | 2) => void;
}): React.JSX.Element {
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [tagLibraryOpen, setTagLibraryOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [namingIndex, setNamingIndex] = useState<number | null>(null);
  const channel = value.positioning.channel === 'general' ? 'male' : value.positioning.channel;
  const category = taxonomy?.categories.find((item) => item.channel === channel && item.name === value.positioning.category) ?? null;
  const categories = taxonomy?.categories.filter((item) => item.channel === channel) ?? [];
  const subjects = taxonomy?.subjects ?? [];
  const visibleSubjects = subjectsOpen ? subjects : subjects.filter((item) => item.packKeys.some((pack) => pack === 'common' || category?.tagPackKeys.includes(pack)));
  const activePacks = new Set([...(category?.tagPackKeys ?? []), ...subjects.filter((item) => value.positioning.genres.includes(item.name)).flatMap((item) => item.packKeys)]);
  const relevantGroups = (taxonomy?.tagGroups ?? []).filter((group) => group.key === 'common' || group.packKeys.some((pack) => activePacks.has(pack)));
  const recommendedTags = useMemo(() => [...new Set([
    ...(category?.recommendedMainTags ?? []),
    ...relevantGroups.flatMap((group) => [...group.mainTags, ...group.auxiliaryTags, ...group.storyTraits])
  ])].filter((tag) => !value.positioning.tags.includes(tag)).slice(0, 16), [category, relevantGroups, value.positioning.tags]);
  const tagGroups = (taxonomy?.tagGroups ?? []).map((group) => ({
    ...group,
    options: [...new Set([...group.mainTags, ...group.auxiliaryTags, ...group.storyTraits])]
      .filter((tag) => tagQuery.trim().length === 0 || tag.includes(tagQuery.trim()))
  })).filter((group) => group.options.length > 0);
  const tagResultCount = tagGroups.reduce((total, group) => total + group.options.length, 0);
  const validation = validateManualOpening(value, taxonomy);

  const updatePositioning = (patch: Partial<OpeningPackage['positioning']>) => onChange({ ...value, positioning: { ...value.positioning, ...patch } });
  const toggleList = (item: string, current: string[], maximum: number, setter: (next: string[]) => void) => {
    if (current.includes(item)) setter(current.filter((candidate) => candidate !== item));
    else if (current.length < maximum) setter([...current, item]);
  };
  const updateProtagonist = (index: number, patch: Partial<OpeningProtagonist>) => onChange({
    ...value,
    protagonists: value.protagonists.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
  });
  const boundaryOptions = taxonomy?.boundaryGroups?.flatMap((group) => group.options) ?? [];
  const customBoundaries = (value.mustFollow ?? []).filter((item) => item !== '无额外限制' && !boundaryOptions.includes(item));
  const setMustFollow = (mustFollow: string[]) => onChange({ ...value, mustFollow: [...new Set(mustFollow)].slice(0, 15) });

  return <div className="manual-manual-opening">
    <nav className="manual-opening-steps" aria-label="自己设计步骤">
      <button className={step === 1 ? 'active' : 'complete'} type="button" onClick={() => onStepChange(1)}><span>1</span>写什么题材</button>
      <button className={step === 2 ? 'active' : ''} type="button" disabled={validation.stepOne.length > 0} onClick={() => onStepChange(2)}><span>2</span>边界与角色</button>
    </nav>

    {step === 1 && <>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>01</span><h3>书籍与分类</h3></div>
        <OpeningFieldDisclosure label="书名" value={value.title}><label className="manual-field" htmlFor="manual-book-title"><span>书名</span><ImeInput id="manual-book-title" aria-label="书名" maxChars={15} value={value.title} onChange={(title) => onChange({ ...value, title })} placeholder="例如：长安簪影" /><small>{Array.from(value.title).length}/15</small></label></OpeningFieldDisclosure>
        <OpeningFieldDisclosure label="创作频道" value={channel === 'female' ? '女频' : '男频'}><fieldset className="manual-choice"><legend>创作频道</legend><div className="manual-segmented">{(['male', 'female'] as const).map((item) => <button className={channel === item ? 'selected' : ''} type="button" key={item} onClick={() => {
          const protagonists = value.protagonists.map((protagonist, index) => index === 0 && ['男主', '女主'].includes(protagonist.identity) ? { ...protagonist, identity: item === 'male' ? '男主' : '女主' } : protagonist);
          onChange({ ...value, protagonists, positioning: { ...value.positioning, channel: item, category: '' } });
        }}>{item === 'male' ? '男频' : '女频'}</button>)}</div></fieldset></OpeningFieldDisclosure>
        <OpeningFieldDisclosure label="作品分类" value={value.positioning.category}><fieldset className="manual-choice"><legend>作品分类（单选）</legend><div className="manual-category-grid">{categories.map((item) => <button title={item.description} className={value.positioning.category === item.name ? 'selected' : ''} type="button" key={item.key} onClick={() => updatePositioning({ category: item.name })}><strong>{item.name}</strong><small>{item.description}</small></button>)}</div></fieldset></OpeningFieldDisclosure>
      </section>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>02</span><h3>融合题材</h3><small>选填 · 最多5个</small></div>
        <OpeningFieldDisclosure label="融合题材" value={value.positioning.genres}><div className="manual-chip-grid">{visibleSubjects.map((item) => <button className={value.positioning.genres.includes(item.name) ? 'selected' : ''} type="button" key={item.name} onClick={() => toggleList(item.name, value.positioning.genres, 5, (genres) => updatePositioning({ genres }))}>{item.name}</button>)}</div>
        <button className="manual-text-button" type="button" onClick={() => setSubjectsOpen((current) => !current)}>{subjectsOpen ? '只看当前分类推荐' : '展开全部题材'} <CaretDownIcon /></button></OpeningFieldDisclosure>
      </section>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>03</span><h3>本书标签</h3><small>选填 · {value.positioning.tags.length}/12</small></div>
        <OpeningFieldDisclosure label="本书标签" value={value.positioning.tags}>{value.positioning.tags.length > 0 && <div className="manual-chip-grid">{value.positioning.tags.map((tag) => <button className="selected" type="button" key={tag} onClick={() => updatePositioning({ tags: value.positioning.tags.filter((item) => item !== tag) })}><CheckCircleIcon />{tag} ×</button>)}</div>}
        {recommendedTags.length > 0 && <><h4 className="manual-micro-title">根据题材推荐</h4><div className="manual-chip-grid">{recommendedTags.map((tag) => <button type="button" key={tag} disabled={value.positioning.tags.length >= 12} onClick={() => updatePositioning({ tags: [...value.positioning.tags, tag] })}>{tag}</button>)}</div></>}
        <button className="manual-text-button" type="button" onClick={() => setTagLibraryOpen((current) => !current)}>{tagLibraryOpen ? '收起标签库' : '从标签库添加'} <CaretDownIcon /></button>
        {tagLibraryOpen && <div className="manual-tag-library"><div className="manual-tag-search"><ImeInput aria-label="搜索标签" maxChars={30} value={tagQuery} onChange={setTagQuery} placeholder="搜索标签" />{tagQuery.trim().length > 0 && <button type="button" onClick={() => setTagQuery('')}>清空</button>}</div>{tagQuery.trim().length > 0 && <p className="manual-search-result" role="status">{tagResultCount > 0 ? `找到 ${tagResultCount} 个标签` : '没有找到相关标签，换个关键词试试。'}</p>}{tagGroups.map((group) => <details key={group.key} open={tagQuery.trim().length > 0}><summary>{group.name}</summary><div className="manual-chip-grid">{group.options.map((tag) => {
          const active = value.positioning.tags.includes(tag);
          return <button className={active ? 'selected' : ''} type="button" key={tag} disabled={!active && value.positioning.tags.length >= 12} onClick={() => toggleList(tag, value.positioning.tags, 12, (tags) => updatePositioning({ tags }))}>{active && <CheckCircleIcon />}{tag}</button>;
        })}</div></details>)}</div>}</OpeningFieldDisclosure>
      </section>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>04</span><h3>预计篇幅</h3><small>全书路线会按这里规划</small></div>
        <OpeningFieldDisclosure label="预计总字数" value={value.positioning.expectedTotalWords > 0 ? `${Math.round(value.positioning.expectedTotalWords / 10_000)}万字` : ''}>
          <div className="manual-field"><span>预计总字数</span><div className="manual-chip-grid">{[80, 150, 200, 300].map((wan) => <button className={value.positioning.expectedTotalWords === wan * 10_000 ? 'selected' : ''} type="button" key={wan} onClick={() => updatePositioning({ expectedTotalWords: wan * 10_000 })}>{wan}万字</button>)}</div><label htmlFor="manual-total-words"><span>其他字数（万字）</span><ImeInput id="manual-total-words" aria-label="预计总字数（万字）" inputMode="numeric" maxChars={4} value={value.positioning.expectedTotalWords > 0 ? String(Math.round(value.positioning.expectedTotalWords / 10_000)) : ''} onChange={(text) => updatePositioning({ expectedTotalWords: Math.min(1_000, Number(text.replace(/\D+/gu, '')) || 0) * 10_000 })} /></label></div>
        </OpeningFieldDisclosure>
      </section>
    </>}

    {step === 2 && <>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>01</span><h3>必须遵守</h3><small>{(value.mustFollow ?? []).length}/15</small></div>
        <OpeningFieldDisclosure label="必须遵守" value={value.mustFollow ?? []}><div className="manual-chip-grid"><button className={(value.mustFollow ?? []).includes('无额外限制') ? 'selected hard' : 'hard'} type="button" onClick={() => setMustFollow((value.mustFollow ?? []).includes('无额外限制') ? [] : ['无额外限制'])}>无额外限制</button></div>
        {taxonomy?.boundaryGroups?.map((group) => <details className="manual-boundary-group" key={group.name}><summary>{group.name}</summary><div className="manual-chip-grid">{group.options.map((item) => {
          const active = (value.mustFollow ?? []).includes(item);
          return <button className={active ? 'selected hard' : 'hard'} type="button" key={item} onClick={() => setMustFollow(active ? (value.mustFollow ?? []).filter((candidate) => candidate !== item) : [...(value.mustFollow ?? []).filter((candidate) => candidate !== '无额外限制'), item])}>{active && <CheckCircleIcon />}{boundaryOptionLabel(item)}</button>;
        })}</div></details>)}
        <TextAreaField id="manual-must-follow" label="自定义必须遵守" value={customBoundaries.join('\n')} onChange={(text) => {
          const nextCustom = text.split(/[；;\n\r]+/u).map((item) => item.trim()).filter(Boolean);
          const selectedKnown = (value.mustFollow ?? []).filter((item) => item !== '无额外限制' && boundaryOptions.includes(item));
          setMustFollow([...selectedKnown, ...nextCustom]);
        }} placeholder="每行一条；没有额外要求可直接选择“无额外限制”" /></OpeningFieldDisclosure>
      </section>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>02</span><h3>背景与角色</h3></div>
        <TextAreaField id="manual-era-world" label="时代背景（选填）" value={value.backgrounds.eraAndWorld} onChange={(eraAndWorld) => onChange({ ...value, backgrounds: { ...value.backgrounds, eraAndWorld } })} placeholder="例如：东汉末年，尊重真实历史框架，允许有限架空" />
        {value.protagonists.map((protagonist, index) => <article className="manual-protagonist-card" key={index}>
          <header><strong>角色 {index + 1}</strong>{index > 0 && <button type="button" onClick={() => onChange({ ...value, protagonists: value.protagonists.filter((_, itemIndex) => itemIndex !== index) })}><TrashIcon />删除</button>}</header>
          <div className="manual-two-columns">
            <OpeningFieldDisclosure label="角色身份" value={protagonist.identity}><label className="manual-field" htmlFor={`manual-role-${index}`}><span>角色身份</span><select id={`manual-role-${index}`} value={protagonist.identity} onChange={(event) => updateProtagonist(index, { identity: event.target.value })}>{ROLE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label></OpeningFieldDisclosure>
            <OpeningFieldDisclosure label="姓名" value={protagonist.name}><div className="manual-field character-name-control"><div className="character-name-label"><label htmlFor={`manual-name-${index}`}>姓名</label><button className="character-naming-button" type="button" onClick={() => setNamingIndex(index)}><MagicWandIcon />取名助手</button></div><ImeInput id={`manual-name-${index}`} aria-label={`角色${index + 1}姓名`} maxChars={80} value={protagonist.name} onChange={(name) => updateProtagonist(index, { name })} /></div></OpeningFieldDisclosure>
          </div>
          <OpeningFieldDisclosure label="年龄" value={protagonist.age}><label className="manual-field compact-number" htmlFor={`manual-age-${index}`}><span>年龄</span><ImeInput id={`manual-age-${index}`} aria-label={`角色${index + 1}年龄`} inputMode="numeric" maxChars={50} value={protagonist.age} onChange={(age) => updateProtagonist(index, { age })} placeholder="例如：18" /></label></OpeningFieldDisclosure>
          <TextAreaField id={`manual-background-${index}`} label="角色背景" value={protagonist.background} onChange={(background) => updateProtagonist(index, { background })} />
          <details className="manual-optional-character optional-character-visual">
            <summary><span>外貌与形象（选填）</span><small>用标签选择，团队设计的结果也会填在这里</small></summary>
            <div className="manual-visual-tag-stack">
              <VisualTagPicker id={`manual-appearance-${index}`} label="外貌" hint="脸型、肤色、五官、头发和气质" groups={VISUAL_IDENTITY_TAG_GROUPS.appearance} maximum={16} value={protagonist.visualIdentity?.appearance ?? ''} onChange={(appearance) => updateProtagonist(index, { visualIdentity: { appearance, build: protagonist.visualIdentity?.build ?? '', signatureFeature: protagonist.visualIdentity?.signatureFeature ?? '' } })} />
              <VisualTagPicker id={`manual-build-${index}`} label="身形" hint="身高、体型、比例、姿态和身体状态" groups={VISUAL_IDENTITY_TAG_GROUPS.build} maximum={12} value={protagonist.visualIdentity?.build ?? ''} onChange={(build) => updateProtagonist(index, { visualIdentity: { appearance: protagonist.visualIdentity?.appearance ?? '', build, signatureFeature: protagonist.visualIdentity?.signatureFeature ?? '' } })} />
              <VisualTagPicker id={`manual-signature-${index}`} label="辨识特征" hint="标记、特殊特征、饰物、服饰和习惯" groups={VISUAL_IDENTITY_TAG_GROUPS.signatureFeature} maximum={12} value={protagonist.visualIdentity?.signatureFeature ?? ''} onChange={(signatureFeature) => updateProtagonist(index, { visualIdentity: { appearance: protagonist.visualIdentity?.appearance ?? '', build: protagonist.visualIdentity?.build ?? '', signatureFeature } })} />
            </div>
          </details>
          <TextAreaField id={`manual-family-${index}`} label="家庭背景（选填）" value={protagonist.familyBackground ?? ''} onChange={(familyBackground) => updateProtagonist(index, { familyBackground })} />
          <TextAreaField id={`manual-career-${index}`} label="职业背景（选填）" value={protagonist.careerBackground ?? ''} onChange={(careerBackground) => updateProtagonist(index, { careerBackground })} />
          <TextAreaField id={`manual-golden-${index}`} label="金手指（选填）" value={protagonist.goldenFinger ?? ''} onChange={(goldenFinger) => updateProtagonist(index, { goldenFinger })} placeholder="没有可留空" />
          <OpeningFieldDisclosure label="角色性格" value={protagonist.personality}><PersonalityPicker index={index} taxonomy={taxonomy} selected={protagonist.personality} onChange={(personality) => updateProtagonist(index, { personality })} /></OpeningFieldDisclosure>
        </article>)}
        {value.protagonists.length < 2 && <button className="manual-add-role" type="button" onClick={() => onChange({ ...value, protagonists: [...value.protagonists, emptyManualProtagonist(channel)] })}><PlusIcon />增加角色（{value.protagonists.length}/2）</button>}
      </section>
      <section className="manual-opening-section">
        <div className="manual-section-title"><span>03</span><h3>故事方向</h3><small>可留空</small></div>
        <TextAreaField id="manual-story-direction" label="故事方向（选填）" value={value.longTermDirection.centralConflict} onChange={(centralConflict) => onChange({ ...value, longTermDirection: { ...value.longTermDirection, centralConflict } })} />
        <TextAreaField id="manual-ending" label="结局方向（选填）" value={value.possibleEnding.direction} onChange={(direction) => onChange({ ...value, possibleEnding: { ...value.possibleEnding, direction } })} />
      </section>
    </>}
    {namingIndex !== null && value.protagonists[namingIndex] !== undefined && <CharacterNamingDialog
      context={characterNamingContext({
        channel: value.positioning.channel,
        category: value.positioning.category,
        genres: value.positioning.genres,
        tags: value.positioning.tags,
        storyDirection: value.longTermDirection.centralConflict
      })}
      identity={value.protagonists[namingIndex]!.identity}
      exclude={value.protagonists.map((item) => item.name).filter(Boolean)}
      onSelect={(name) => updateProtagonist(namingIndex, { name })}
      onClose={() => setNamingIndex(null)}
    />}
  </div>;
}
