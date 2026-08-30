import { ArrowLeftIcon, CheckIcon, DownloadSimpleIcon, MagicWandIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ManualOpeningForm } from './ManualOpeningForm';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { publicFailureCopy, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import {
  designBookTitles,
  designBookCover,
  adoptBookCover,
  apiAssetUrl,
  fetchBookCoverStudio,
  fetchBookTitleStudio,
  fetchOpeningTaxonomy,
  newActionKey,
  type BookProfile,
  type BookCoverStudioView,
  type BookTitleStudioView,
  type OpeningPackage,
  type OpeningTaxonomy
} from './opening-api';

export function BookProfileEditDialog({ profile, onClose, onSave }: {
  profile: BookProfile;
  onClose: () => void;
  onSave: (title: string, openingBlueprint: BookProfile['openingBlueprint']) => Promise<void>;
}): React.JSX.Element {
  const [taxonomy, setTaxonomy] = useState<OpeningTaxonomy | null>(null);
  const [value, setValue] = useState<OpeningPackage>(() => profileToPackage(profile));
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchOpeningTaxonomy(controller.signal).then(setTaxonomy).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '分类资料暂时没有准备好');
    });
    return () => controller.abort();
  }, []);
  const errors = useMemo(() => profileEditErrors(value, taxonomy), [taxonomy, value]);
  const save = async (): Promise<void> => {
    if (taxonomy === null || errors.length > 0) return;
    setBusy(true); setError(null);
    try { await onSave(value.title.trim(), packageToBlueprint(profile, value, taxonomy)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '开书资料没有保存成功'); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="setting-dialog-backdrop profile-dialog-backdrop" role="presentation">
    <section className="setting-dialog profile-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
      <header><div><p className="eyebrow">开书资料</p><h3 id="profile-edit-title">修改当前资料</h3></div><button type="button" aria-label="关闭" onClick={onClose}><XIcon /></button></header>
      {profile.openingBlueprint.openingIdea?.trim() && <details className="original-opening-idea"><summary>查看最初的开书想法</summary><p>{profile.openingBlueprint.openingIdea.trim()}</p><small>这是作者最初的原话，只作为设计依据保留，不会被编辑部改写。</small></details>}
      {taxonomy === null && error === null ? <div className="profile-loading">正在准备原有开书表单…</div> : <ManualOpeningForm value={value} taxonomy={taxonomy} onChange={setValue} step={step} onStepChange={setStep} />}
      {errors.length > 0 && taxonomy !== null && <div className="profile-edit-errors" role="status">还需要确认：{errors.join('、')}</div>}
      {error && <div className="error-notice" role="alert">{error}</div>}
      <footer>{step === 2 && <button type="button" onClick={() => setStep(1)}><ArrowLeftIcon />上一步</button>}{step === 1 ? <button type="button" className="primary-action" disabled={taxonomy === null || errors.some((entry) => ['书名', '创作频道', '作品分类'].some((name) => entry.includes(name)))} onClick={() => setStep(2)}>下一步</button> : <button type="button" className="primary-action" disabled={busy || taxonomy === null || errors.length > 0} onClick={() => void save()}><CheckIcon />{busy ? '正在保存…' : '保存修改'}</button>}</footer>
    </section>
  </div>, document.body);
}

export function BookTitleDesignDialog({ bookId, currentTitle, onClose, onApply }: {
  bookId: string;
  currentTitle: string;
  onClose: () => void;
  onApply: (title: string) => Promise<void>;
}): React.JSX.Element {
  const [studio, setStudio] = useState<BookTitleStudioView | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [platformStyle, setPlatformStyle] = useState<'qidian' | 'fanqie' | 'mainstream'>('mainstream');
  const [titleFlavor, setTitleFlavor] = useState<'high-concept' | 'strong-conflict' | 'identity-gap' | 'suspense' | 'epic'>('high-concept');
  const [authorDirection, setAuthorDirection] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchBookTitleStudio(bookId, controller.signal).then(setStudio).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '书名工作台暂时没有准备好');
    });
    return () => controller.abort();
  }, [bookId]);
  const working = studio?.designs.find((item) => item.status === 'working') ?? null;
  const result = studio?.designs.find((item) => item.status === 'succeeded') ?? null;
  const failed = studio?.designs.filter((item) => item.status === 'failed') ?? [];
  useEffect(() => {
    if (!busy && working === null) return;
    const timer = window.setInterval(() => {
      void fetchBookTitleStudio(bookId).then(setStudio).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [bookId, busy, working]);
  useEffect(() => {
    if (working !== null) setNotice('工单已经保存，主编正在加急设计；您可以关闭页面，稍后到任务里查看。');
  }, [working]);
  const run = (): void => {
    setBusy(true); setError(null); setNotice('正在向主编提交书名工单…');
    void designBookTitles(bookId, { idempotencyKey: newActionKey('title-design'), platformStyle, titleFlavor, authorDirection }).then((created) => {
      setStudio((current) => ({ designs: [created, ...(current?.designs ?? []).filter((item) => item.designId !== created.designId)] }));
      setNotice(created.status === 'succeeded' ? '书名已经设计好，请挑选喜欢的一项。' : publicStatusCopy(created.statusText, '书名工单已经保存，主编正在处理。'));
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '主编这次没有完成书名设计');
      void fetchBookTitleStudio(bookId).then(setStudio).catch(() => undefined);
    }).finally(() => setBusy(false));
  };
  const apply = async (title: string): Promise<void> => {
    setApplying(title); setError(null);
    try { await onApply(title); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '书名没有保存成功'); setApplying(null); }
  };
  return createPortal(<div className="setting-dialog-backdrop" role="presentation">
    <section className="setting-dialog title-design-dialog" role="dialog" aria-modal="true" aria-labelledby="title-design-title">
      <header><div><p className="eyebrow">当前书名：{currentTitle}</p><h3 id="title-design-title">请主编设计书名</h3></div><button type="button" aria-label="关闭" onClick={onClose}><XIcon /></button></header>
      <DesignChoice label="平台倾向" value={platformStyle} onChange={(value) => setPlatformStyle(value as typeof platformStyle)} options={[['mainstream', '主流通用'], ['qidian', '起点风'], ['fanqie', '番茄风']]}/>
      <DesignChoice label="吸睛方式" value={titleFlavor} onChange={(value) => setTitleFlavor(value as typeof titleFlavor)} options={[['high-concept', '脑洞卖点'], ['strong-conflict', '强冲突'], ['identity-gap', '身份反差'], ['suspense', '悬念感'], ['epic', '史诗感']]}/>
      <label className="design-direction"><span>我的想法（可不填）</span><textarea maxLength={800} value={authorDirection} onChange={(event) => setAuthorDirection(event.target.value)} placeholder="例如：想突出主角穿越后从边军小卒逆袭，但不要太俗。"/><small>{Array.from(authorDirection).length}/800</small></label>
      {notice && <div className="design-order-notice" role="status">{notice}</div>}
      {busy || working !== null ? <div className="title-design-loading"><MagicWandIcon /><strong>老板耐心等待，主编正在加急设计…</strong><span>任务已经保存，离开后不会丢失</span></div> : result !== null ? <div className="title-option-list">{result.options.map((option) => <article key={option.text}><div><strong>{option.text}</strong><p>{option.note}</p></div><button type="button" disabled={applying !== null} onClick={() => void apply(option.text)}>{applying === option.text ? '正在采用…' : '采用这个书名'}</button></article>)}</div> : <div className="design-ready-note">选好方向后，请主编给您设计一组。</div>}
      {failed.length > 0 && <details className="design-history"><summary>历史未完成记录（{failed.length}）</summary>{failed.map((item) => <p key={item.designId}>{publicFailureCopy(item.statusText)}</p>)}</details>}
      {error && <div className="error-notice" role="alert">{error}</div>}
      <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="primary-action" disabled={busy || working !== null || applying !== null} onClick={run}><MagicWandIcon />{busy || working !== null ? '主编正在设计…' : result === null ? '开始设计书名' : '重新设计一组'}</button></footer>
    </section>
  </div>, document.body);
}

export function BookCoverDesignDialog({ bookId, currentTitle, onClose }: {
  bookId: string;
  currentTitle: string;
  onClose: () => void;
}): React.JSX.Element {
  const [studio, setStudio] = useState<BookCoverStudioView | null>(null);
  const [busy, setBusy] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [platformStyle, setPlatformStyle] = useState<'qidian' | 'fanqie' | 'mainstream'>('mainstream');
  const [visualStyle, setVisualStyle] = useState<'vivid' | 'realistic' | 'abstract' | 'guofeng' | 'cinematic' | 'warm' | 'illustration' | 'anime' | 'ink' | 'retro' | 'scifi' | 'suspense' | 'romance'>('vivid');
  const [compositionStyle, setCompositionStyle] = useState<'character-closeup' | 'character-scene' | 'duality' | 'ensemble' | 'grand-scene' | 'symbolic'>('character-scene');
  const [paletteStyle, setPaletteStyle] = useState<'high-contrast' | 'warm' | 'cool' | 'dark' | 'golden' | 'pastel'>('high-contrast');
  const [atmosphereStyle, setAtmosphereStyle] = useState<'intense' | 'epic' | 'suspense' | 'romantic' | 'healing' | 'lonely'>('intense');
  const [elements, setElements] = useState<string[]>([]);
  const [avoidElements, setAvoidElements] = useState<string[]>([]);
  const [authorDirection, setAuthorDirection] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchBookCoverStudio(bookId, controller.signal).then(setStudio).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '封面工作台暂时没有准备好');
    });
    return () => controller.abort();
  }, [bookId]);
  const hasWorkingDesign = studio?.designs.some((item) => item.status === 'working') ?? false;
  useEffect(() => {
    if (!busy && !hasWorkingDesign) return;
    const timer = window.setInterval(() => {
      void fetchBookCoverStudio(bookId).then(setStudio).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [bookId, busy, hasWorkingDesign]);
  useEffect(() => {
    if (hasWorkingDesign) setNotice('封面工单已经保存，主编和视觉编剧正在制作；您可以关闭页面，稍后到任务里查看。');
  }, [hasWorkingDesign]);
  const design = (): void => {
    setBusy(true); setError(null); setNotice('正在向封面编辑部提交工单…');
    void designBookCover(bookId, { idempotencyKey: newActionKey('cover-design'), platformStyle, visualStyle, compositionStyle, paletteStyle, atmosphereStyle, elements, avoidElements, authorDirection }).then((created) => {
      setStudio((current) => current === null ? current : {
        ...current,
        designs: [created, ...current.designs.filter((item) => item.designId !== created.designId)]
      });
      setNotice(created.status === 'succeeded' ? '封面已经制作完成，请查看并决定是否采用。' : publicStatusCopy(created.statusText, '封面工单已经保存，编辑部正在制作。'));
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '封面制作没有完成');
      void fetchBookCoverStudio(bookId).then(setStudio).catch(() => undefined);
    }).finally(() => setBusy(false));
  };
  const currentDesign = studio?.designs.find((item) => item.status === 'working') ?? null;
  const completedDesigns = studio?.designs.filter((item) => item.status === 'succeeded') ?? [];
  const failedDesigns = studio?.designs.filter((item) => item.status === 'failed') ?? [];
  const adopt = (designId: string): void => {
    setAdopting(designId); setError(null);
    void adoptBookCover(bookId, designId).then((updated) => {
      setStudio((current) => current === null ? current : {
        ...current,
        designs: current.designs.map((item) => item.designId === updated.designId
          ? updated
          : { ...item, adopted: false })
      });
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '封面没有采用成功');
    }).finally(() => setAdopting(null));
  };
  return createPortal(<div className="setting-dialog-backdrop" role="presentation">
    <section className="setting-dialog cover-design-dialog" role="dialog" aria-modal="true" aria-labelledby="cover-design-title">
      <header><div><p className="eyebrow">封面编辑部</p><h3 id="cover-design-title">设计封面</h3></div><button type="button" aria-label="关闭" onClick={onClose}><XIcon /></button></header>
      {studio === null && error === null ? <div className="profile-loading">正在打开封面工作台…</div> : studio !== null ? <>
        <div className="visual-member-list">{uniqueByMemberKey(studio.visualMembers).map((member) => <div className={`visual-member-strip ${member.status}`} key={member.memberKey}>
          <span className="visual-agent-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true"/>
          <div><strong>{memberDisplayName(member.memberKey, member.displayName)} · {publicRoleLabel(member.roleName)}</strong><span>{member.status === 'on_leave' ? '暂时无法接单' : publicStatusCopy(member.statusText, '当前空闲，可以接单')}</span></div>
        </div>)}</div>
        <DesignChoice label="平台倾向" value={platformStyle} onChange={(value) => setPlatformStyle(value as typeof platformStyle)} options={[['mainstream', '主流通用'], ['qidian', '起点风'], ['fanqie', '番茄风']]}/>
        <DesignChoice label="画面风格" value={visualStyle} onChange={(value) => setVisualStyle(value as typeof visualStyle)} options={[['vivid', '鲜艳醒目'], ['realistic', '现实质感'], ['illustration', '商业插画'], ['anime', '动漫风'], ['guofeng', '国风绘卷'], ['ink', '水墨留白'], ['cinematic', '电影感'], ['abstract', '抽象创意'], ['retro', '复古质感'], ['scifi', '科幻未来'], ['suspense', '悬疑暗调'], ['romance', '浪漫唯美'], ['warm', '温暖治愈']]}/>
        <DesignChoice label="构图方式" value={compositionStyle} onChange={(value) => setCompositionStyle(value as typeof compositionStyle)} options={[['character-closeup', '人物近景'], ['character-scene', '人物与场景'], ['duality', '双人对照'], ['ensemble', '群像'], ['grand-scene', '宏大场景'], ['symbolic', '意象主体']]}/>
        <DesignChoice label="色彩方向" value={paletteStyle} onChange={(value) => setPaletteStyle(value as typeof paletteStyle)} options={[['high-contrast', '高对比醒目'], ['warm', '暖色热烈'], ['cool', '冷色克制'], ['dark', '深色压迫'], ['golden', '金色史诗'], ['pastel', '柔和彩色']]}/>
        <DesignChoice label="画面氛围" value={atmosphereStyle} onChange={(value) => setAtmosphereStyle(value as typeof atmosphereStyle)} options={[['intense', '热血紧张'], ['epic', '史诗恢宏'], ['suspense', '神秘悬疑'], ['romantic', '浪漫暧昧'], ['healing', '轻松治愈'], ['lonely', '孤独苍凉']]}/>
        <MultiDesignChoice label="希望出现" value={elements} onChange={setElements} maximum={6} options={['主角', '双主角', '重要配角', '兵器', '城市', '山河', '宗门', '战场', '星空', '科技装置', '象征物', '动物']}/>
        <MultiDesignChoice label="不要出现" value={avoidElements} onChange={setAvoidElements} maximum={6} options={['多人挤满', '血腥画面', '现代服装', '华丽特效', '阴暗底色', '人物正脸', '感情元素', '战斗元素', '文字水印', '平台标志']}/>
        <label className="design-direction"><span>我的画面想法（可不填）</span><textarea maxLength={800} value={authorDirection} onChange={(event) => setAuthorDirection(event.target.value)} placeholder="例如：主角站在城墙上，远处烽火，颜色要鲜艳有冲击力。"/><small>{Array.from(authorDirection).length}/800</small></label>
        {notice && <div className="design-order-notice" role="status">{notice}</div>}
        {currentDesign !== null && <article className="cover-task-card working"><div className="cover-task-status"><MagicWandIcon /><strong>封面正在制作</strong><p>{publicStatusCopy(currentDesign.statusText, '主编和视觉编剧正在制作。')}</p><small>您可以先关闭，回来后会继续显示真实进度。</small></div></article>}
        {completedDesigns.length === 0 && currentDesign === null ? <div className="empty-cover-design"><MagicWandIcon /><strong>还没有封面方案</strong><span>选好方向后，主编会下制作单，由视觉编剧直接出图。</span></div> : completedDesigns.length > 0 && <div className="cover-design-grid">{completedDesigns.map((item) => item.imageUrl !== null && item.downloadUrl !== null && item.workOrder !== null && <article className={item.adopted ? 'adopted' : ''} key={item.designId}>
            <div className="cover-preview"><img src={apiAssetUrl(item.imageUrl)} alt={`${currentTitle}封面候选`} />{item.adopted && <em>当前封面</em>}</div>
            <div className="cover-design-meta"><p><strong>{item.chiefName}</strong>下工单 · <strong>{uniqueByMemberKey(item.visualMembers).map((member) => memberDisplayName(member.memberKey, member.displayName)).join('、')}</strong>协作</p>
              <details><summary>查看制作工单</summary><dl><div><dt>构图</dt><dd>{item.workOrder.composition}</dd></div><div><dt>视觉重点</dt><dd>{item.workOrder.visualFocus}</dd></div><div><dt>氛围</dt><dd>{item.workOrder.atmosphere}</dd></div><div><dt>色彩</dt><dd>{item.workOrder.palette}</dd></div><div><dt>检查结果</dt><dd>{item.workOrder.plannerReview}</dd></div></dl></details>
              <div className="cover-result-actions"><a href={apiAssetUrl(item.downloadUrl)} download><DownloadSimpleIcon />下载封面</a><button type="button" disabled={item.adopted || adopting !== null} onClick={() => adopt(item.designId)}>{item.adopted ? '已经采用' : adopting === item.designId ? '正在采用…' : '采用这张封面'}</button></div>
            </div>
          </article>)}</div>}
        {failedDesigns.length > 0 && <details className="design-history"><summary>历史未完成记录（{failedDesigns.length}）</summary>{failedDesigns.map((item) => <article className="cover-task-card failed" key={item.designId}><div className="cover-task-status"><strong>这次没有制作完成</strong><p>{publicFailureCopy(item.statusText)}</p><small>{item.chiefName}已经安排工作交接，可以重新设计一张。</small></div></article>)}</details>}
      </> : null}
      {error && <div className="error-notice" role="alert">{error}</div>}
      <footer><button type="button" onClick={onClose}>关闭</button><button type="button" className="primary-action" disabled={studio === null || busy || hasWorkingDesign || adopting !== null || studio.visualMembers.some((member) => member.status !== 'on_duty')} onClick={design}><MagicWandIcon />{busy || hasWorkingDesign ? '亲爱的，正在加急制作…' : studio?.designs.some((item) => item.status === 'succeeded') ? '再设计一张' : '开始设计封面'}</button></footer>
    </section>
  </div>, document.body);
}

function DesignChoice({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }): React.JSX.Element {
  return <fieldset className="design-choice"><legend>{label}</legend><div>{options.map(([key, text]) => <button type="button" className={value === key ? 'selected' : ''} aria-pressed={value === key} key={key} onClick={() => onChange(key)}>{text}</button>)}</div></fieldset>;
}

function MultiDesignChoice({ label, value, options, maximum, onChange }: { label: string; value: string[]; options: string[]; maximum: number; onChange: (value: string[]) => void }): React.JSX.Element {
  return <fieldset className="design-choice"><legend>{label}<small>可选 · 最多{maximum}项</small></legend><div>{options.map((item) => {
    const selected = value.includes(item);
    return <button type="button" className={selected ? 'selected' : ''} aria-pressed={selected} disabled={!selected && value.length >= maximum} key={item} onClick={() => onChange(selected ? value.filter((entry) => entry !== item) : [...value, item])}>{item}</button>;
  })}</div></fieldset>;
}

function profileToPackage(profile: BookProfile): OpeningPackage {
  const blueprint = profile.openingBlueprint;
  const protagonists = blueprint.protagonists ?? profile.protagonists;
  return {
    title: profile.title,
    positioning: {
      publishingPlatform: blueprint.planningProfile?.publishingPlatform ?? 'fanqie',
      channel: blueprint.channel ?? (profile.channel === '女频' ? 'female' : 'male'),
      category: profile.category,
      genres: [...profile.subjects],
      tags: unique([...profile.mainTags, ...(profile.customTags ?? [])]),
      coreAppeal: (blueprint.storyTraits ?? []).join('、'),
      expectedTotalWords: blueprint.planningProfile?.expectedTotalWords ?? 0,
      ...(blueprint.planningProfile?.commercialAudience === undefined ? {} : { targetReaders: blueprint.planningProfile.commercialAudience }),
      ...(blueprint.planningProfile?.volumePlan === undefined ? {} : { volumePlan: blueprint.planningProfile.volumePlan }),
      ...(blueprint.planningProfile?.retentionPositioning === undefined ? {} : { retentionPositioning: blueprint.planningProfile.retentionPositioning })
    },
    backgrounds: { eraAndWorld: blueprint.worldBackground, openingSituation: '' },
    protagonists: protagonists.map((item) => ({
      name: item.name, age: item.age, identity: roleLabel(item.role), background: item.background?.trim() || item.familyBackground?.trim() || '',
      familyBackground: item.background?.trim() ? (item.familyBackground ?? '') : '', careerBackground: item.careerBackground ?? '',
      goldenFinger: item.goldenFinger ?? '', visualIdentity: item.visualIdentity ?? { appearance: '', build: '', signatureFeature: '' },
      goal: '', dilemma: '', personality: [...item.personalities], boundary: ''
    })),
    opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
    longTermDirection: { centralConflict: blueprint.storyDirection ?? profile.storyDirection, progression: '', relationshipDirection: '', storyPotential: '' },
    possibleEnding: { direction: blueprint.storyEnding ?? profile.storyEnding, price: '', openness: '' },
    authorNotes: [], mustFollow: [...(blueprint.mustFollow ?? profile.mustFollow ?? [])]
  };
}

function packageToBlueprint(profile: BookProfile, value: OpeningPackage, taxonomy: OpeningTaxonomy): BookProfile['openingBlueprint'] {
  const previous = profile.openingBlueprint;
  const channel = value.positioning.channel === 'female' ? 'female' : 'male';
  const categoryKey = taxonomy.categories.find((entry) => entry.channel === channel && entry.name === value.positioning.category)?.key ?? previous.categoryKey ?? '';
  return {
    ...previous,
    taxonomyVersion: previous.taxonomyVersion ?? taxonomy.version,
    channel,
    categoryKey,
    targetAudience: previous.targetAudience || '',
    planningProfile: {
      publishingPlatform: previous.planningProfile?.publishingPlatform ?? 'fanqie',
      expectedTotalWords: value.positioning.expectedTotalWords,
      ...(previous.planningProfile?.volumePlan === undefined ? {} : { volumePlan: { ...previous.planningProfile.volumePlan } }),
      ...(previous.planningProfile?.commercialAudience === undefined ? {} : { commercialAudience: previous.planningProfile.commercialAudience }),
      ...(previous.planningProfile?.retentionPositioning === undefined ? {} : { retentionPositioning: previous.planningProfile.retentionPositioning })
    },
    protagonists: value.protagonists.map((item) => ({
      role: roleKey(item.identity), name: item.name.trim(), age: item.age.trim(), background: item.background.trim(),
      familyBackground: item.familyBackground?.trim() ?? '', careerBackground: item.careerBackground?.trim() ?? '',
      goldenFinger: item.goldenFinger?.trim() ?? '',
      ...(item.visualIdentity === undefined ? {} : { visualIdentity: {
        appearance: item.visualIdentity.appearance.trim(), build: item.visualIdentity.build.trim(),
        signatureFeature: item.visualIdentity.signatureFeature.trim()
      } }),
      personalities: [...item.personality]
    })),
    storyDirection: value.longTermDirection.centralConflict.trim(),
    openingStart: previous.openingStart ?? profile.openingStart,
    storyEnding: value.possibleEnding.direction.trim(),
    worldBackground: value.backgrounds.eraAndWorld.trim(),
    openingBackground: previous.openingBackground ?? '',
    mainTags: [...value.positioning.tags],
    auxiliaryTags: [...value.positioning.genres],
    customTags: (previous.customTags ?? []).filter((tag) => value.positioning.tags.includes(tag)),
    mustFollow: [...(value.mustFollow ?? [])]
  };
}

function profileEditErrors(value: OpeningPackage, taxonomy: OpeningTaxonomy | null): string[] {
  const errors: string[] = [];
  const titleLength = Array.from(value.title.trim()).length;
  if (titleLength < 2 || titleLength > 15) errors.push('书名需要2至15字');
  if (value.positioning.channel === 'general') errors.push('请选择创作频道');
  if (taxonomy !== null && !taxonomy.categories.some((entry) => entry.channel === value.positioning.channel && entry.name === value.positioning.category)) errors.push('请选择作品分类');
  if (value.positioning.expectedTotalWords < 100_000 || value.positioning.expectedTotalWords > 10_000_000) errors.push('预计总字数需要在10万至1000万字之间');
  if (value.protagonists.length < 1 || value.protagonists.length > 2) errors.push('角色需要1至2位');
  value.protagonists.forEach((item, index) => {
    if (item.name.trim().length === 0) errors.push(`角色${index + 1}姓名`);
    if (item.age.trim().length === 0) errors.push(`角色${index + 1}年龄`);
  });
  return errors;
}

function roleLabel(role = ''): string {
  return ({ male_lead: '男主', female_lead: '女主', co_lead: '共同主角', dual_lead: '共同主角', ensemble: '群像主角', ensemble_lead: '群像主角', non_human: '非人主角' } as Record<string, string>)[role] ?? '共同主角';
}
function roleKey(label: string): string {
  return ({ 男主: 'male_lead', 女主: 'female_lead', 共同主角: 'co_lead', 群像主角: 'ensemble', 非人主角: 'non_human' } as Record<string, string>)[label] ?? 'co_lead';
}
function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
