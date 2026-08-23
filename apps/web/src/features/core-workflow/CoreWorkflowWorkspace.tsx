import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircleIcon, LockKeyIcon, MapTrifoldIcon, PencilLineIcon } from '@phosphor-icons/react';
import type { CharacterCardContent, CharacterCardView, CoreWorkflowStage, CoreWorkflowV6View } from '@wenmi/contracts';
import { bookDisplayTitle } from '../../app/display-labels';
import {
  fetchBookProfile,
  fetchPlanningState,
  updateBookProfile,
  type BookProfileViewData,
  type PlanningStateData,
  type WorkspaceData
} from '../../lib/api/client';
import { CompleteCreateBookDialog } from '../onboarding/CompleteCreateBookDialog';
import { SettingCatalog } from '../planning/SettingCatalog';
import { VolumePlanningPanel } from '../planning/VolumePlanningPanel';
import { EventPlanningPanel } from '../planning/EventPlanningPanel';
import { EventChapterPlanningPanel } from '../planning/EventChapterPlanningPanel';
import { V6Dialog, V6Drawer, V6EmptyState, V6PageHeader } from './V6Shared';
import { fetchCoreWorkflow, setCoreWorkflowStage, updateCharacterCard } from './v6-api';
import { StorylineWorkspace } from './StorylineWorkspace';
import { VolumeLineOrchestration } from './VolumeLineOrchestration';
import { EventRoleWorkspace } from './EventRoleWorkspace';
import { VolumeExpressionWorkspace } from './VolumeExpressionWorkspace';

const WORKFLOW_STAGE_ORDER: CoreWorkflowStage[] = ['setting', 'storyline', 'volume', 'event', 'chapter'];

export function CoreWorkflowWorkspace({ stage, onStageChange, workspace, manuscript, onChanged, onAvailabilityChange }: {
  stage: CoreWorkflowStage;
  onStageChange: (stage: CoreWorkflowStage) => void;
  workspace: WorkspaceData | null;
  manuscript: ReactNode;
  onChanged: () => Promise<void> | void;
  onAvailabilityChange?: (stage: CoreWorkflowStage) => void;
}): React.JSX.Element {
  const bookId = workspace?.book.bookId ?? null;
  const [mapOpen, setMapOpen] = useState(false);
  const [workflowGate, setWorkflowGate] = useState<{ stage: CoreWorkflowStage; stateVersion: number } | null>(null);
  const [chapterStep, setChapterStep] = useState<'chain' | 'outline' | 'manuscript' | 'review' | 'settlement'>('manuscript');
  const [eventRevision, setEventRevision] = useState(0);
  useEffect(() => {
    if (bookId === null) { setWorkflowGate(null); return; }
    const controller = new AbortController();
    void fetchCoreWorkflow(bookId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const next = { stage: value.stage, stateVersion: value.stateVersion };
      setWorkflowGate(next); onAvailabilityChange?.(next.stage);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [bookId, onAvailabilityChange]);
  const advanceTo = useCallback(async (nextStage: CoreWorkflowStage): Promise<void> => {
    if (bookId === null) return;
    try {
      const base = workflowGate ?? await fetchCoreWorkflow(bookId);
      const result = await setCoreWorkflowStage(bookId, nextStage, base.stateVersion);
      setWorkflowGate({ stage: nextStage, stateVersion: result.stateVersion });
      onAvailabilityChange?.(nextStage); onStageChange(nextStage);
    } catch {
      const latest = await fetchCoreWorkflow(bookId);
      setWorkflowGate({ stage: latest.stage, stateVersion: latest.stateVersion });
      onAvailabilityChange?.(latest.stage);
    }
  }, [bookId, onAvailabilityChange, onStageChange, workflowGate]);
  if (bookId === null) return <section className="v6-page"><p>书籍资料正在加载。</p></section>;
  const unlockedIndex = workflowGate === null ? WORKFLOW_STAGE_ORDER.length - 1 : WORKFLOW_STAGE_ORDER.findIndex((item) => item === workflowGate.stage);
  const requestedIndex = WORKFLOW_STAGE_ORDER.findIndex((item) => item === stage);
  return <section className={`v6-workspace v6-stage-${stage}`}>
    {requestedIndex > unlockedIndex ? <section className="v6-page"><V6EmptyState title="这一步尚未开放" description="先完成并确认上一步，系统会保留当前资料并自动开放这里。" action={<button type="button" className="v6-primary-button" onClick={() => onStageChange(workflowGate?.stage ?? 'setting')}>回到当前步骤</button>} /></section>
    :
    stage === 'setting' ? <SettingStage bookId={bookId} workspace={workspace} onChanged={onChanged} onNext={() => void advanceTo('storyline')} />
      : stage === 'storyline' ? <StorylineWorkspace bookId={bookId} bookTitle={bookDisplayTitle(workspace?.book.title ?? '当前书籍')} onChanged={onChanged} onNext={() => void advanceTo('volume')} />
      : stage === 'volume' ? <section className="v6-page v6-volume-page">
        <V6PageHeader eyebrow="本卷方向" title="分卷" description="先安排本卷推进哪些线，再从团队路线中选出完整方向与表达方案。" mapAction={() => setMapOpen(true)} />
        <VolumeLineOrchestration bookId={bookId} bookTitle={bookDisplayTitle(workspace?.book.title ?? '当前书籍')} />
        <div className="v6-embedded-panel"><VolumePlanningPanel bookId={bookId} onOpenSettings={() => onStageChange('setting')} /></div>
        <VolumeExpressionWorkspace bookId={bookId} onConfirmed={() => void advanceTo('event')} />
      </section>
      : stage === 'event' ? <section className="v6-page v6-event-page">
        <V6PageHeader eyebrow="因果单元" title="事件" description="先确认事件骨架与角色功能，再逐个设计当前事件。" mapAction={() => setMapOpen(true)} />
        <div className="v6-embedded-panel"><EventPlanningPanel bookId={bookId} rolesRevision={eventRevision}
          onChainChanged={() => setEventRevision((value) => value + 1)} onEventConfirmed={() => void advanceTo('chapter')} /></div>
        <EventRoleWorkspace key={`${bookId}:${eventRevision}`} bookId={bookId} onChanged={() => setEventRevision((value) => value + 1)} />
      </section>
      : <section className="v6-page v6-chapter-page">
        <V6PageHeader eyebrow="写作与结算" title="章节" description="章纲与正文保持独立版本，在一个页面中连续推进。" mapAction={() => setMapOpen(true)} />
        <div className="v6-chapter-steps" role="tablist" aria-label="章节阶段">{([
          ['chain', '章链'], ['outline', '本章章纲'], ['manuscript', '正文'], ['review', '三席审查'], ['settlement', '结算']
        ] as const).map(([key, label], index) => <button type="button" role="tab" key={key} aria-selected={chapterStep === key}
          className={chapterStep === key ? 'active' : ''} onClick={() => setChapterStep(key)}><span>{index + 1}</span>{label}</button>)}</div>
        <div className="v6-embedded-panel">{chapterStep === 'chain' || chapterStep === 'outline'
          ? <EventChapterPlanningPanel bookId={bookId} onOpenManuscript={() => setChapterStep('manuscript')} onChanged={onChanged} />
          : manuscript}</div>
      </section>}
    {mapOpen && <V6Drawer title="故事地图" onClose={() => setMapOpen(false)}><div className="v6-map-placeholder"><MapTrifoldIcon /><h4>从故事线查看完整地图</h4><p>这里提供当前页面的轻量入口；线路、推进和伏笔轨道都在故事线页统一查看。</p><button type="button" className="v6-primary-button" onClick={() => { setMapOpen(false); onStageChange('storyline'); }}>打开故事地图</button></div></V6Drawer>}
  </section>;
}

function SettingStage({ bookId, workspace, onChanged, onNext }: {
  bookId: string;
  workspace: WorkspaceData | null;
  onChanged: () => Promise<void> | void;
  onNext: () => void;
}): React.JSX.Element {
  const [profile, setProfile] = useState<BookProfileViewData | null>(null);
  const [planningState, setPlanningState] = useState<PlanningStateData | null>(null);
  const [core, setCore] = useState<CoreWorkflowV6View | null>(null);
  const [characterEditor, setCharacterEditor] = useState<CharacterCardView | null>(null);
  const [characterSaving, setCharacterSaving] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const loadProfile = useCallback(async (signal?: AbortSignal) => setProfile(await fetchBookProfile(bookId, signal)), [bookId]);
  const loadPlanningState = useCallback(async (signal?: AbortSignal) => setPlanningState(await fetchPlanningState(bookId, signal)), [bookId]);
  const loadCore = useCallback(async (signal?: AbortSignal) => setCore(await fetchCoreWorkflow(bookId, signal)), [bookId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([loadProfile(controller.signal), loadPlanningState(controller.signal), loadCore(controller.signal)]).catch(() => undefined);
    return () => controller.abort();
  }, [loadCore, loadPlanningState, loadProfile]);
  const protagonistCards = core?.characters.filter((item) => item.characterKind === 'protagonist' && item.content !== null) ?? [];
  const visiblePersonality = protagonistCards[0]?.content?.personalityTraits?.slice(0, 3).join('、')
    ?? profile?.protagonists[0]?.personalities.slice(0, 3).join('、') ?? '';
  return <section className="v6-page v6-setting-page">
    {profile !== null && <details className="v6-opening-profile">
      <summary><span><CheckCircleIcon weight="fill" /><strong>开书资料</strong><small>{profile.channel} · {profile.category} · {profile.subjects.join('、') || '未填写题材'}{visiblePersonality ? ` · 主角性格：${visiblePersonality}` : ''}</small></span><em>展开 / 收起</em></summary>
      <div><header><div><h3>{bookDisplayTitle(profile.title)}</h3><p>{profile.synopsis || '尚未填写书籍简介。'}</p></div><button type="button" className="v6-quiet-button" onClick={() => setProfileOpen(true)}><PencilLineIcon />修改开书资料</button></header>
        <dl><div><dt>题材</dt><dd>{[...profile.subjects, ...profile.mainTags].join('、') || '待补充'}</dd></div>
          <div><dt>主角信息</dt><dd>{protagonistCards.length > 0
            ? protagonistCards.map((item) => `${item.content!.name}${item.content!.roleSummary ? `（${item.content!.roleSummary}）` : ''}`).join('、')
            : profile.protagonists.map((item) => `${item.name}${item.background ? `（${item.background}）` : ''}`).join('、') || '待补充'}</dd></div>
          <div><dt>主角性格</dt><dd><span>{protagonistCards.length > 0
            ? protagonistCards.map((item) => `${item.content!.name}：${item.content!.personalityTraits?.join('、') || '待补充'}`).join('；')
            : profile.protagonists.map((item) => `${item.name}：${item.personalities.join('、') || '待补充'}`).join('；') || '待补充'}</span>
            {protagonistCards.map((item) => <button type="button" className="v6-inline-text-button" key={item.characterId}
              onClick={() => setCharacterEditor(item)}>编辑{item.content?.name ?? '主角'}</button>)}</dd></div>
          <div><dt>核心目标</dt><dd>{protagonistCards.map((item) => `${item.content!.name}：${item.content!.desire}`).join('；') || profile.storyDirection || '跟随正文逐步确认'}</dd></div>
          <div><dt>当前处境</dt><dd>{protagonistCards.map((item) => `${item.content!.name}：${item.content!.currentState}`).join('；') || profile.openingStart || profile.openingBlueprint.openingBackground || '待补充'}</dd></div>
          <div><dt>核心驱动力</dt><dd>{profile.storyDirection || profile.openingBlueprint.fullBookOutline || '待补充'}</dd></div>
          <div><dt>开局状态</dt><dd>{profile.openingStart || profile.openingBlueprint.openingBackground || '待补充'}</dd></div>
          <div><dt>特殊机制</dt><dd>{profile.protagonists.map((item) => item.goldenFinger).filter(Boolean).join('、') || '待补充'}</dd></div>
          <div><dt>作者已有方向</dt><dd>{profile.openingBlueprint.fullBookOutline || profile.storyDirection || '尚未决定，可以边写边整理'}</dd></div>
          <div><dt>禁区</dt><dd>{profile.mustFollow.join('、') || '无额外禁区'}</dd></div></dl>
        {protagonistCards.length > 0 && <p className="v6-profile-authority-note">当前创作以版本化人物卡为准；修改开书资料不会静默覆盖已确认人物卡。</p>}
      </div>
    </details>}
    <section className="v6-setting-library-heading"><div><span>完整设定库</span><h2>选择本书真正需要的设定</h2><p>推荐项不会替您勾选；核心必要项与可选宏观项分开呈现。</p></div><span><LockKeyIcon />确认前只进入临时资料包，不写入正史</span></section>
    <div className="v6-embedded-panel"><SettingCatalog bookId={bookId} workspace={workspace} planningState={planningState}
      onPlanningStateChanged={async () => { await loadPlanningState(); await onChanged(); }} onOpenVolumes={onNext} /></div>
    {characterEditor !== null && characterEditor.content !== null && <ProtagonistCardEditor card={characterEditor} busy={characterSaving}
      onClose={() => setCharacterEditor(null)} onSave={async (content) => {
        if (characterEditor.activeVersionId === null) return;
        setCharacterSaving(true);
        try {
          await updateCharacterCard(bookId, characterEditor.characterId, { content,
            expectedActiveVersionId: characterEditor.activeVersionId, sourceOpeningVersion: characterEditor.content?.sourceOpeningVersion ?? null });
          await loadCore(); setCharacterEditor(null); await onChanged();
        } finally { setCharacterSaving(false); }
      }} />}    {profileOpen && profile !== null && <CompleteCreateBookDialog initialProfile={profile} busy={profileSaving} onCancel={() => setProfileOpen(false)}
      onUpdate={async (input) => {
        setProfileSaving(true);
        try { const updated = await updateBookProfile(bookId, input); setProfile(updated); setProfileOpen(false); await onChanged(); return true; }
        finally { setProfileSaving(false); }
      }} />}
  </section>;
}

function ProtagonistCardEditor({ card, busy, onClose, onSave }: {
  card: CharacterCardView; busy: boolean; onClose: () => void; onSave: (content: CharacterCardContent) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState(card.content!);
  const [traits, setTraits] = useState((card.content?.personalityTraits ?? []).join('、'));
  const [boundaries, setBoundaries] = useState(card.content?.boundaries.join('\n') ?? '');
  const split = (value: string): string[] => value.split(/[、,，;；\n\r]+/u).map((item) => item.trim()).filter(Boolean);
  return <V6Dialog title={`编辑${content.name}的人物卡`} onClose={onClose}>
    <div className="v6-field-grid v6-protagonist-card-form">
      <label><span>姓名</span><input value={content.name} onChange={(event) => setContent({ ...content, name: event.target.value })} /></label>
      <label><span>身份</span><input value={content.roleSummary} onChange={(event) => setContent({ ...content, roleSummary: event.target.value })} /></label>
      <label className="wide"><span>核心目标</span><textarea rows={2} value={content.desire} onChange={(event) => setContent({ ...content, desire: event.target.value })} /></label>
      <label className="wide"><span>当前处境</span><textarea rows={2} value={content.currentState} onChange={(event) => setContent({ ...content, currentState: event.target.value })} /></label>
      <label className="wide"><span>主角性格（用顿号分隔）</span><textarea rows={2} value={traits} onChange={(event) => setTraits(event.target.value)} /></label>
      <label className="wide"><span>人物边界（每行一条）</span><textarea rows={3} value={boundaries} onChange={(event) => setBoundaries(event.target.value)} /></label>
    </div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button"
      disabled={busy || content.name.trim() === '' || content.roleSummary.trim() === '' || content.desire.trim() === '' || content.currentState.trim() === ''}
      onClick={() => void onSave({ ...content, personalityTraits: split(traits), boundaries: split(boundaries) })}>{busy ? '正在保存…' : '保存人物卡新版本'}</button></footer>
  </V6Dialog>;
}
