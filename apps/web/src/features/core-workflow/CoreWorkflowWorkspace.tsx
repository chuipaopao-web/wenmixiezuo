import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircleIcon, LockKeyIcon, MapTrifoldIcon, PencilLineIcon } from '@phosphor-icons/react';
import type { CoreWorkflowStage } from '@wenmi/contracts';
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
import { V6Drawer, V6EmptyState, V6PageHeader, V6_STAGES } from './V6Shared';
import { fetchCoreWorkflow, setCoreWorkflowStage } from './v6-api';
import { StorylineWorkspace } from './StorylineWorkspace';
import { VolumeLineOrchestration } from './VolumeLineOrchestration';
import { EventRoleWorkspace } from './EventRoleWorkspace';
import { VolumeExpressionWorkspace } from './VolumeExpressionWorkspace';

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
  const unlockedIndex = workflowGate === null ? V6_STAGES.length - 1 : V6_STAGES.findIndex((item) => item.key === workflowGate.stage);
  const requestedIndex = V6_STAGES.findIndex((item) => item.key === stage);
  return <section className={`v6-workspace v6-stage-${stage}`}>
    {requestedIndex > unlockedIndex ? <section className="v6-page"><V6EmptyState title="这一步尚未开放" description="先完成并确认上一步，系统会保留当前资料并自动开放这里。" action={<button type="button" className="v6-primary-button" onClick={() => onStageChange(workflowGate?.stage ?? 'setting')}>回到当前步骤</button>} /></section>
    :
    stage === 'setting' ? <SettingStage bookId={bookId} workspace={workspace} onChanged={onChanged} onNext={() => void advanceTo('storyline')} />
      : stage === 'storyline' ? <StorylineWorkspace bookId={bookId} bookTitle={bookDisplayTitle(workspace?.book.title ?? '当前书籍')} onChanged={onChanged} onNext={() => void advanceTo('volume')} />
      : stage === 'volume' ? <section className="v6-page v6-volume-page">
        <div className="v6-phase-line" aria-label="分卷阶段"><b>线路编排</b><i /><span>团队设计</span><i /><span>选择路线</span><i /><span>表达方案</span><i /><span>主编整理</span><i /><span>确认</span></div>
        <V6PageHeader eyebrow="第三步 · 本卷方向" title="分卷" description="先安排本卷推进哪些线，再从团队路线中选出完整方向与表达方案。" mapAction={() => setMapOpen(true)} />
        <VolumeLineOrchestration bookId={bookId} bookTitle={bookDisplayTitle(workspace?.book.title ?? '当前书籍')} />
        <div className="v6-embedded-panel"><VolumePlanningPanel bookId={bookId} onOpenSettings={() => onStageChange('setting')} /></div>
        <VolumeExpressionWorkspace bookId={bookId} onConfirmed={() => void advanceTo('event')} />
      </section>
      : stage === 'event' ? <section className="v6-page v6-event-page">
        <div className="v6-phase-line" aria-label="事件阶段"><b>事件骨架</b><i /><span>角色安排</span><i /><span>事件链确认</span><i /><span>当前事件</span></div>
        <V6PageHeader eyebrow="第四步 · 因果单元" title="事件" description="先确认事件骨架与角色功能，再逐个设计当前事件。" mapAction={() => setMapOpen(true)} />
        <div className="v6-embedded-panel"><EventPlanningPanel bookId={bookId} rolesRevision={eventRevision}
          onChainChanged={() => setEventRevision((value) => value + 1)} onEventConfirmed={() => void advanceTo('chapter')} /></div>
        <EventRoleWorkspace key={`${bookId}:${eventRevision}`} bookId={bookId} onChanged={() => setEventRevision((value) => value + 1)} />
      </section>
      : <section className="v6-page v6-chapter-page">
        <div className="v6-phase-line" aria-label="章节阶段"><b>章链</b><i /><span>本章章纲</span><i /><span>正文</span><i /><span>三席审查</span><i /><span>结算</span></div>
        <V6PageHeader eyebrow="第五步 · 写作与结算" title="章节" description="章纲与正文保持独立版本，在一个页面中连续推进。" mapAction={() => setMapOpen(true)} />
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const loadProfile = useCallback(async (signal?: AbortSignal) => setProfile(await fetchBookProfile(bookId, signal)), [bookId]);
  const loadPlanningState = useCallback(async (signal?: AbortSignal) => setPlanningState(await fetchPlanningState(bookId, signal)), [bookId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([loadProfile(controller.signal), loadPlanningState(controller.signal)]).catch(() => undefined);
    return () => controller.abort();
  }, [loadPlanningState, loadProfile]);
  return <section className="v6-page v6-setting-page">

    <div className="v6-phase-line" aria-label="设定阶段"><b>开书资料</b><i /><span>设定库</span><i /><span>逐项设计</span><i /><span>主编审查</span><i /><span>完成</span></div>
    {profile !== null && <details className="v6-opening-profile">
      <summary><span><CheckCircleIcon weight="fill" /><strong>开书资料</strong><small>{profile.channel} · {profile.category} · {profile.subjects.join('、') || '未填写题材'}</small></span><em>展开 / 收起</em></summary>
      <div><header><div><h3>{bookDisplayTitle(profile.title)}</h3><p>{profile.synopsis || '尚未填写书籍简介。'}</p></div><button type="button" className="v6-quiet-button" onClick={() => setProfileOpen(true)}><PencilLineIcon />修改开书资料</button></header>
        <dl><div><dt>题材</dt><dd>{[...profile.subjects, ...profile.mainTags].join('、') || '待补充'}</dd></div>
          <div><dt>主角信息</dt><dd>{profile.protagonists.map((item) => `${item.name}${item.background ? `（${item.background}）` : ''}`).join('、') || '待补充'}</dd></div>
          <div><dt>核心驱动力</dt><dd>{profile.storyDirection || profile.openingBlueprint.fullBookOutline || '待补充'}</dd></div>
          <div><dt>开局状态</dt><dd>{profile.openingStart || profile.openingBlueprint.openingBackground || '待补充'}</dd></div>
          <div><dt>特殊机制</dt><dd>{profile.protagonists.map((item) => item.goldenFinger).filter(Boolean).join('、') || '待补充'}</dd></div>
          <div><dt>作者已有方向</dt><dd>{profile.openingBlueprint.fullBookOutline || profile.storyDirection || '待补充'}</dd></div>
          <div><dt>禁区</dt><dd>{profile.mustFollow.join('、') || '无额外禁区'}</dd></div></dl>
      </div>
    </details>}
    <section className="v6-setting-library-heading"><div><span>完整设定库</span><h2>选择本书真正需要的设定</h2><p>推荐项不会替您勾选；核心必要项与可选宏观项分开呈现。</p></div><span><LockKeyIcon />确认前只进入临时资料包，不写入正史</span></section>
    <div className="v6-embedded-panel"><SettingCatalog bookId={bookId} workspace={workspace} planningState={planningState}
      onPlanningStateChanged={async () => { await loadPlanningState(); await onChanged(); }} onOpenVolumes={onNext} /></div>
    {profileOpen && profile !== null && <CompleteCreateBookDialog initialProfile={profile} busy={profileSaving} onCancel={() => setProfileOpen(false)}
      onUpdate={async (input) => {
        setProfileSaving(true);
        try { const updated = await updateBookProfile(bookId, input); setProfile(updated); setProfileOpen(false); await onChanged(); return true; }
        finally { setProfileSaving(false); }
      }} />}
  </section>;
}
