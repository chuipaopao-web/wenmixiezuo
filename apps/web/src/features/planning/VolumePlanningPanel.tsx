import { useCallback, useEffect, useMemo, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { CheckCircleIcon } from '@phosphor-icons/react';
import type {
  PlanningTemplateInstance,
  VolumeDirectionFragmentKey,
  VolumeRouteSelection,
  VolumePlanContent
} from '@wenmi/contracts';
import {
  actOnVolumePlanGeneration,
  addVolumePlanVersion,
  confirmVolumePlanVersion,
  createVolumePlan,
  fetchAuthorPlanningInputs,
  fetchCreationWorkflow,
  fetchOpeningTaxonomy,
  fetchSettingQualityReport,
  fetchVolumeDirections,
  fetchVolumePlanGeneration,
  fetchVolumePlans,
  fetchVolumePlanVersions,
  previewVolumePlanImpact,
  saveVolumeRouteSelection,
  settleVolumePlan,
  startVolumePlanGeneration,
  type VolumePlanData,
  type VolumeDirectionVersionData,
  type VolumePlanGenerationData,
  type VolumePlanImpactData,
  type VolumePlanVersionData,
  type SettingQualityReportView
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';
import { SettlementFollowUpCard } from './SettlementFollowUpCard';
import { useMembershipGate } from '../shared/membership-gate';
import { SettingGapPanel } from './SettingGapPanel';
import { AgentAvatar } from '../shared/AgentAvatar';
import { ImeInput } from '../shared/ImeSafeField';

interface VolumePlanningSnapshot {
  workflow: Awaited<ReturnType<typeof fetchCreationWorkflow>>;
  plans: VolumePlanData[];
}

const settingPrerequisiteStages = new Set([
  'book_profile_draft',
  'book_profile_confirmed',
  'setting_in_progress'
]);

export function VolumePlanningPanel({ bookId, onOpenSettings }: {
  bookId: string;
  onOpenSettings?: () => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<VolumePlanningSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VolumePlanVersionData[]>([]);
  const [directions, setDirections] = useState<VolumeDirectionVersionData[]>([]);
  const [fragmentChoices, setFragmentChoices] = useState<Partial<Record<VolumeDirectionFragmentKey,string>>>({});
  const [generation, setGeneration] = useState<VolumePlanGenerationData | null>(null);
  const [draft, setDraft] = useState<VolumePlanContent>(() => emptyVolumePlan(1));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<VolumePlanImpactData | null>(null);
  const [styleTones, setStyleTones] = useState<string[]>([]);
  const [settingQuality, setSettingQuality] = useState<SettingQualityReportView | null>(null);
  const { guardAi } = useMembershipGate();

  useEffect(() => {
    const controller = new AbortController();
    void fetchOpeningTaxonomy(controller.signal).then((value) => {
      if (!controller.signal.aborted) setStyleTones(value.styleTones ?? []);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const [workflow, plans] = await Promise.all([
      fetchCreationWorkflow(bookId, signal),
      fetchVolumePlans(bookId, signal)
    ]);
    setSnapshot({ workflow, plans });
    setSelectedPlanId((current) => {
      if (current !== null && plans.some((plan) => plan.volumePlanId === current)) return current;
      return plans.at(-1)?.volumePlanId ?? null;
    });
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void load(controller.signal).catch((reason) => {
      if (!controller.signal.aborted) setError(messageOf(reason));
    });
    return () => controller.abort();
  }, [load]);

  const selectedPlan = useMemo(
    () => snapshot?.plans.find((plan) => plan.volumePlanId === selectedPlanId) ?? null,
    [selectedPlanId, snapshot]
  );

  const settingPrerequisiteBlocked = snapshot !== null
    && snapshot.plans.length === 0
    && settingPrerequisiteStages.has(snapshot.workflow.stage);

  useEffect(() => {
    if (!settingPrerequisiteBlocked) {
      setSettingQuality(null);
      return;
    }
    const controller = new AbortController();
    setSettingQuality(null);
    void fetchSettingQualityReport(bookId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setSettingQuality(next);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [bookId, settingPrerequisiteBlocked]);

  useEffect(() => {
    if (selectedPlan === null) {
      setVersions([]);
      setDirections([]);
      setFragmentChoices({});
      setGeneration(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId, controller.signal),
      fetchVolumeDirections(bookId, selectedPlan.volumePlanId, controller.signal),
      fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId, controller.signal)
    ]).then(([nextVersions, nextDirections, nextGeneration]) => {
      setVersions(nextVersions);
      setDirections(nextDirections);
      setGeneration(nextGeneration);
    }).catch((reason) => { if (!controller.signal.aborted) setError(messageOf(reason)); });
    const inheritedTone = snapshot?.plans
      .filter((plan) => plan.planNumber < selectedPlan.planNumber)
      .at(-1)?.activeVersion?.content ?? null;
    setDraft(selectedPlan.activeVersion?.content ?? emptyVolumePlan(selectedPlan.planNumber, inheritedTone));
    setEditing(selectedPlan.activeVersion === null);
    setImpact(null);
    return () => controller.abort();
  }, [bookId, selectedPlan?.volumePlanId, selectedPlan?.activeVersionId]);

  useEffect(() => {
    if (selectedPlan === null || generation === null || !generation.isRunning) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void Promise.all([
        fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId, controller.signal),
        fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId, controller.signal),
        fetchVolumeDirections(bookId, selectedPlan.volumePlanId, controller.signal)
      ]).then(([nextGeneration, nextVersions, nextDirections]) => {
        setGeneration(nextGeneration);
        setVersions(nextVersions);
        setDirections(nextDirections);
        if (nextGeneration !== null && !nextGeneration.isRunning) void load();
      }).catch((reason) => {
        if (!controller.signal.aborted) setError(messageOf(reason));
      });
    }, 1_250);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [bookId, generation?.isRunning, generation?.updatedAt, load, selectedPlan?.volumePlanId]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null);
    try { await work(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };

  const createCurrentVolume = (): void => {
    if (snapshot === null) return;
    const planNumber = (snapshot.plans.at(-1)?.planNumber ?? 0) + 1;
    void run(async () => {
      const created = await createVolumePlan(bookId, {
        expectedWorkflowVersion: snapshot.workflow.planningVersion,
        planNumber,
        idempotencyKey: key(`volume-plan-${planNumber}`)
      });
      await load();
      setSelectedPlanId(created.volumePlanId);
      setDraft(emptyVolumePlan(planNumber, snapshot.plans.at(-1)?.activeVersion?.content ?? null));
      setEditing(true);
    });
  };

  const saveAuthorDraft = (): void => {
    if (selectedPlan === null) return;
    void run(async () => {
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, {
        surface: 'volume_plan', subjectType: 'volume_plan', subjectId: selectedPlan.volumePlanId
      });
      const saved = await addVolumePlanVersion(bookId, selectedPlan.volumePlanId, {
        expectedPlanRevision: selectedPlan.revision,
        candidateKind: 'author_edit',
        parentVersionId: selectedPlan.activeVersionId,
        authorInputRefs: authorIdeas
          .filter((idea) => !['withdrawn', 'superseded'].includes(idea.status))
          .map((idea) => idea.authorInputId),
        template: freePlanningReference(),
        content: draft,
        idempotencyKey: key(`volume-author-${selectedPlan.volumePlanId}`)
      });
      setVersions(await fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId));
      setEditing(false);
      setImpact(await previewVolumePlanImpact(bookId, selectedPlan.volumePlanId, saved.volumePlanVersionId));
    });
  };

  const startTeamGeneration = (): void => {
    if (selectedPlan === null || snapshot === null) return;
    if (!guardAi()) return;
    void run(async () => {
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, {
        surface: 'volume_plan', subjectType: 'volume_plan', subjectId: selectedPlan.volumePlanId
      });
      const nextGeneration = await startVolumePlanGeneration(bookId, selectedPlan.volumePlanId, {
        expectedPlanRevision: selectedPlan.revision,
        expectedActiveVersionId: selectedPlan.activeVersionId,
        expectedWorkflowVersion: snapshot.workflow.planningVersion,
        template: freePlanningReference(),
        authorInputRefs: authorIdeas
          .filter((idea) => !['withdrawn', 'superseded'].includes(idea.status))
          .map((idea) => idea.authorInputId),
        idempotencyKey: key(`volume-team-${selectedPlan.volumePlanId}`)
      });
      setGeneration(nextGeneration);
    });
  };

  const adoptWholeDirection = (direction: VolumeDirectionVersionData): void => {
    if (selectedPlan === null || direction.legacyVolumePlanVersionId === null) return;
    void run(async () => {
      const selection: VolumeRouteSelection = {
        selectionMode: 'whole',
        selectedProposalId: direction.proposalId,
        selectedVersionId: direction.volumeDirectionVersionId,
        fragments: [],
        authorNotes: null
      };
      await saveVolumeRouteSelection(
        bookId, selectedPlan.volumePlanId, selection,
        key('volume-route-whole-' + direction.proposalId)
      );
      setImpact(await previewVolumePlanImpact(
        bookId, selectedPlan.volumePlanId, direction.legacyVolumePlanVersionId!
      ));
    });
  };

  const requestSelectedFusion = (): void => {
    if (selectedPlan === null || snapshot === null || !guardAi()) return;
    const fragments = Object.entries(fragmentChoices).flatMap(([field, versionId]) => {
      const direction = directions.find((item) => item.volumeDirectionVersionId === versionId);
      return direction === undefined ? [] : [{
        fragmentId: direction.proposalId + ':' + field,
        field: field as VolumeDirectionFragmentKey,
        sourceProposalId: direction.proposalId,
        sourceVersionId: direction.volumeDirectionVersionId
      }];
    });
    if (fragments.length === 0) {
      setError('请先从方案一或方案二中至少选择一部分。');
      return;
    }
    const selection: VolumeRouteSelection = {
      selectionMode: 'fragments', fragments,
      authorNotes: '只融合作者在页面中明确勾选的部分'
    };
    void run(async () => {
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, {
        surface: 'volume_plan', subjectType: 'volume_plan', subjectId: selectedPlan.volumePlanId
      });
      setGeneration(await startVolumePlanGeneration(bookId, selectedPlan.volumePlanId, {
        expectedPlanRevision: selectedPlan.revision,
        expectedActiveVersionId: selectedPlan.activeVersionId,
        expectedWorkflowVersion: snapshot.workflow.planningVersion,
        template: freePlanningReference(),
        authorInputRefs: authorIdeas.filter((idea) =>
          !['withdrawn', 'superseded'].includes(idea.status)
        ).map((idea) => idea.authorInputId),
        selection,
        idempotencyKey: key('volume-fusion-' + selectedPlan.volumePlanId)
      }));
    });
  };

  const cancelGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await actOnVolumePlanGeneration(bookId, selectedPlan.volumePlanId, 'cancel');
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const retryGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await actOnVolumePlanGeneration(bookId, selectedPlan.volumePlanId, 'retry');
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const resumeGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await actOnVolumePlanGeneration(bookId, selectedPlan.volumePlanId, 'resume');
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const previewCandidate = (versionId: string): void => {
    if (selectedPlan === null) return;
    void run(async () => setImpact(await previewVolumePlanImpact(bookId, selectedPlan.volumePlanId, versionId)));
  };

  const confirmCandidate = (): void => {
    if (selectedPlan === null || impact === null || snapshot === null) return;
    void run(async () => {
      await confirmVolumePlanVersion(bookId, selectedPlan.volumePlanId, {
        volumePlanVersionId: impact.candidateVersionId,
        expectedPlanRevision: selectedPlan.revision,
        expectedActiveVersionId: selectedPlan.activeVersionId,
        expectedWorkflowVersion: snapshot.workflow.planningVersion
      });
      setImpact(null);
      await load();
    });
  };

  const settleCurrentVolume = (): void => {
    if (selectedPlan === null || snapshot === null) return;
    void run(async () => { await settleVolumePlan(bookId, selectedPlan.volumePlanId, snapshot.workflow.planningVersion); await load(); });
  };

  if (snapshot === null) {
    return <section className="volume-planning-panel"><p>{error ?? '正在读取当前卷规划…'}</p></section>;
  }

  return <section className="volume-planning-panel" aria-labelledby="volume-planning-title">
    <div className="volume-planning-toolbar">
      <h3 id="volume-planning-title" className="sr-only">分卷</h3>
      {snapshot.plans.length === 0
        ? !settingPrerequisiteBlocked && <button className="primary-button" type="button" disabled={busy} onClick={createCurrentVolume}>开始规划第一卷</button>
        : <select aria-label="选择卷规划" value={selectedPlanId ?? ''} onChange={(event) => setSelectedPlanId(event.target.value)}>
          {snapshot.plans.map((plan) => <option key={plan.volumePlanId} value={plan.volumePlanId}>第{plan.planNumber}卷 · {plan.activeVersion?.content.title ?? '规划中'}</option>)}
        </select>}
    </div>

    <ol className="volume-workflow-strip" aria-label="当前卷流程">
      <li className={selectedPlan !== null ? 'done' : 'current'}><b>1</b><span>建立当前卷</span></li>
      <li className={versions.length > 0 ? 'done' : selectedPlan !== null ? 'current' : ''}><b>2</b><span>比较方案</span></li>
      <li className={selectedPlan?.activeVersion ? 'done' : versions.length > 0 ? 'current' : ''}><b>3</b><span>确认卷规划</span></li>
      <li className={selectedPlan?.activeVersion ? 'current' : ''}><b>4</b><span>继续拆事件</span></li>
    </ol>

    {error !== null && <p className="inline-error" role="alert">{error}</p>}
    {settingPrerequisiteBlocked && <SettingPrerequisiteCard
      quality={settingQuality}
      onOpenSettings={onOpenSettings}
    />}
    <SettingGapPanel bookId={bookId}/>
{snapshot.workflow.stage === 'volume_settlement_in_progress' && selectedPlan !== null && <section className="writing-launch-card volume-settlement-card">
      <div><small>本卷事件已全部完成</small><h4>核对实际后果，完成本卷</h4><p>卷结算只汇总已结算事件和已确认内容；原卷规划单独用于差异对照。完成后才会解锁下一卷规划。</p></div>
      <div className="writing-launch-action"><button className="primary-button" type="button" disabled={busy} onClick={settleCurrentVolume}>完成本卷，规划下一卷</button></div>
    </section>}

    {selectedPlan !== null && <>
      <section className="volume-plan-status-card">
        <div><small>第{selectedPlan.planNumber}卷</small><strong>{selectedPlan.activeVersion?.content.title ?? '尚未确认卷规划'}</strong></div>
        <div><small>当前状态</small><strong>{selectedPlan.activeVersion === null ? '比较方案中' : `已确认第${selectedPlan.activeVersion.version}稿`}</strong></div>
        <div><small>上游依据</small><strong>{selectedPlan.planNumber === 1 ? '开书资料 + 设定基线' : '上卷结算 + 当前设定'}</strong></div>
        <div><small>本卷基调</small><strong>{[selectedPlan.activeVersion?.content.stylePrimary, selectedPlan.activeVersion?.content.styleSecondary].filter(Boolean).join('＋') || '未选择'}</strong></div>
        <div><small>本卷重点表达</small><strong>{selectedPlan.activeVersion?.content.focusExpression ?? '沿用全书调子'}</strong></div>
        <button type="button" disabled={busy} onClick={() => {
          const inheritedTone = snapshot.plans
            .filter((plan) => plan.planNumber < selectedPlan.planNumber)
            .at(-1)?.activeVersion?.content ?? null;
          setDraft(selectedPlan.activeVersion?.content ?? emptyVolumePlan(selectedPlan.planNumber, inheritedTone));
          setEditing((value) => !value);
        }}>{editing ? '收起编辑' : selectedPlan.activeVersion === null ? '填写我的方案' : '在确认稿上修改'}</button>
      </section>

      {selectedPlan.status === 'completed' && <SettlementFollowUpCard
        bookId={bookId}
        stageKind="volume"
        stageObjectId={selectedPlan.volumePlanId}
      />}


      <AuthorIdeaComposer
        bookId={bookId}
        surface="volume_plan"
        subjectType="volume_plan"
        subjectId={selectedPlan.volumePlanId}
        title="补充你对这一卷的想法"
      />

      <VolumeGenerationCard
        generation={generation}
        busy={busy}
        onStart={startTeamGeneration}
        onCancel={cancelGeneration}
        onRetry={retryGeneration}
        onResume={resumeGeneration}
      />

      {directions.some((item) => ['candidate_a', 'candidate_b'].includes(item.candidateKind)) &&
        <VolumeDirectionChoicePanel
          directions={directions.filter((item) => ['candidate_a', 'candidate_b'].includes(item.candidateKind))}
          choices={fragmentChoices}
          busy={busy || (generation !== null && generation.isRunning)}
          onChoose={(field, directionId) => setFragmentChoices((current) => {
            const next = { ...current };
            if (current[field] === directionId) delete next[field];
            else next[field] = directionId;
            return next;
          })}
          onAdoptWhole={adoptWholeDirection}
          onFuse={requestSelectedFusion}
        />}

      {editing && <VolumePlanEditor value={draft} onChange={setDraft} onSave={saveAuthorDraft} busy={busy} styleTones={styleTones} />}

      {versions.length > 0 && <section className="volume-version-section">
        <header><div><h4>方案与历史稿</h4><p>各份稿件互不覆盖；确认新稿前会先显示影响范围。</p></div><span>{versions.length} 份稿件</span></header>
        <div className="volume-version-grid">{versions.map((version) => <VolumeVersionCard
          key={version.volumePlanVersionId}
          version={version}
          active={selectedPlan.activeVersionId === version.volumePlanVersionId}
          busy={busy}
          onPreview={() => previewCandidate(version.volumePlanVersionId)}
        />)}</div>
      </section>}

      {impact !== null && <aside className="volume-impact-card" aria-label="改动影响预览">
        <div><strong>确认前影响预览</strong><p>{impact.note}</p></div>
        <dl><div><dt>改变的部分</dt><dd>{impact.changedFields.map(fieldLabel).join('、') || '无'}</dd></div><div><dt>需要复核的下游</dt><dd>{impact.downstreamDependencyCount} 项</dd></div></dl>
        <div className="button-row"><button type="button" onClick={() => setImpact(null)}>先不确认</button><button className="primary-button" type="button" disabled={busy} onClick={confirmCandidate}>确认这份稿</button></div>
      </aside>}
    </>}
  </section>;
}

function SettingPrerequisiteCard({ quality, onOpenSettings }: {
  quality: SettingQualityReportView | null;
  onOpenSettings: (() => void) | undefined;
}): React.JSX.Element {
  const hardIssueCount = quality?.fresh === true
    ? quality.report?.issues.filter((issue) => issue.severity === 'hard').length ?? 0
    : 0;
  const detail = hardIssueCount > 0
    ? `主编已经完成检查，还有 ${hardIssueCount} 个问题需要你决定怎么处理。回到设定页逐条修改，或确认保留后再完成设定定稿。`
    : quality?.taskStatus === 'working' || quality?.taskStatus === 'queued'
      ? '设定检查正在进行。回到设定页可以查看进度，检查完成并确认定稿后会立即解锁第一卷。'
      : '请先回到设定页确认整份设定。系统会在确认前完成检查，设定定稿后会立即解锁第一卷。';
  return <section className="volume-prerequisite-card" aria-label="第一卷规划前置条件">
    <div>
      <small>规划第一卷前</small>
      <h4>设定还差最后确认</h4>
      <p>{detail}</p>
    </div>
    <button className="primary-button" type="button" onClick={onOpenSettings}>回到设定处理</button>
  </section>;
}

const directionChoiceFields: ReadonlyArray<{
  key: Exclude<VolumeDirectionFragmentKey, 'firstVolumeLaunch'>;
  label: string;
}> = [
  { key: 'openingSituation', label: '开卷局面' },
  { key: 'protagonistDrive', label: '主角为什么行动' },
  { key: 'volumeGoal', label: '本卷要解决什么' },
  { key: 'centralOpposition', label: '主要对立力量' },
  { key: 'escalationPath', label: '事情怎样一步步升级' },
  { key: 'majorChoices', label: '关键选择' },
  { key: 'relationshipMovement', label: '人物关系怎样变化' },
  { key: 'expressionFocus', label: '本卷重点表达' },
  { key: 'climaxResponsibility', label: '高潮要兑现什么' },
  { key: 'costAndConsequence', label: '主角付出什么代价' },
  { key: 'closingState', label: '卷末进入什么局面' },
  { key: 'openSpaces', label: '留给后续设计的空间' }
];

function VolumeDirectionChoicePanel({ directions, choices, busy, onChoose, onAdoptWhole, onFuse }: {
  directions: VolumeDirectionVersionData[];
  choices: Partial<Record<VolumeDirectionFragmentKey, string>>;
  busy: boolean;
  onChoose: (field: VolumeDirectionFragmentKey, directionId: string) => void;
  onAdoptWhole: (direction: VolumeDirectionVersionData) => void;
  onFuse: () => void;
}): React.JSX.Element {
  const selectedCount = Object.keys(choices).length;
  return <section className="volume-direction-choice" aria-label="选择本卷故事路线">
    <header>
      <div><h4>这卷故事可以这样走</h4><p>可以整份采用，也可以从两份路线里分别挑选；主编只会整理你明确选中的部分。</p></div>
      <span>{selectedCount > 0 ? `已选 ${selectedCount} 部分` : '尚未分段选择'}</span>
    </header>
    <div className="volume-direction-grid">
      {directions.map((direction) => <article className="volume-direction-card" key={direction.volumeDirectionVersionId}>
        <header><div><small>{direction.candidateKind === 'candidate_a' ? '方案一' : '方案二'}</small><h5>{direction.content.title}</h5></div><button type="button" disabled={busy || direction.legacyVolumePlanVersionId === null} onClick={() => onAdoptWhole(direction)}>整份采用</button></header>
        <div className="volume-direction-parts">
          {directionChoiceFields.map((item) => {
            const selected = choices[item.key] === direction.volumeDirectionVersionId;
            return <section className={selected ? 'direction-choice-row selected' : 'direction-choice-row'} key={item.key}>
              <div><strong>{item.label}</strong><p>{directionValueText(direction, item.key)}</p></div>
              <button type="button" aria-pressed={selected} disabled={busy} onClick={() => onChoose(item.key, direction.volumeDirectionVersionId)}>{selected ? '已选这部分' : '选这部分'}</button>
            </section>;
          })}
          {direction.content.firstVolumeLaunch !== undefined && <section className={choices.firstVolumeLaunch === direction.volumeDirectionVersionId ? 'direction-choice-row first-volume-route selected' : 'direction-choice-row first-volume-route'}>
            <div><strong>第一卷强启动</strong><p>前500字：{direction.content.firstVolumeLaunch.first500Interest.readerQuestion}；前三章完成第一次回报；重大高潮不晚于累计10万有效字。</p></div>
            <button type="button" aria-pressed={choices.firstVolumeLaunch === direction.volumeDirectionVersionId} disabled={busy} onClick={() => onChoose('firstVolumeLaunch', direction.volumeDirectionVersionId)}>{choices.firstVolumeLaunch === direction.volumeDirectionVersionId ? '已选这部分' : '选这部分'}</button>
          </section>}
        </div>
        <details><summary>这条路线好看在哪里、要注意什么</summary><div className="volume-direction-notes"><section><b>好看之处</b><ul>{direction.content.benefits.map((item) => <li key={item}>{item}</li>)}</ul></section><section><b>需要注意</b><ul>{direction.content.risks.map((item) => <li key={item}>{item}</li>)}</ul></section></div></details>
      </article>)}
    </div>
    <footer><p>{selectedCount === 0 ? '想混合两条路线时，先在上面挑选需要的部分。' : '主编不会补入未选择的候选内容；整理后仍可继续修改。'}</p><button className="primary-button" type="button" disabled={busy || selectedCount === 0} onClick={onFuse}>请主编只融合已选部分</button></footer>
  </section>;
}

function directionValueText(
  direction: VolumeDirectionVersionData,
  field: Exclude<VolumeDirectionFragmentKey, 'firstVolumeLaunch'>
): string {
  const value = direction.content[field];
  return Array.isArray(value) ? value.join('；') : value;
}

function VolumeGenerationCard({ generation, busy, onStart, onCancel, onRetry, onResume }: {
  generation: VolumePlanGenerationData | null;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onResume: () => void;
}): React.JSX.Element {
  const active = generation !== null && generation.isRunning;
  const canRetry = generation?.canRetry ?? false;
  return <section className={`volume-generation-card ${active ? 'working' : ''}`} aria-label="卷规划团队设计">
    <header>
      <div><h4>团队设计</h4><p>两位编剧会按不同思路各写一条具体路线；你不需要先选或理解任何写作方法。</p></div>
      <button className="primary-button" type="button" disabled={busy || active} onClick={onStart}>
        {generation?.isCompleted === true ? '再设计一组方案' : '让团队开始设计'}
      </button>
    </header>

    {generation !== null && <>
      <p className="volume-generation-progress" role="status">{generation.stateText} · {generation.phaseText}</p>
      <div className="volume-generation-members">
        {generation.members.map((member) => <article key={member.roleKey}>
          <div><AgentAvatar roleKey={member.roleKey} roleName={member.displayName} /><strong>{member.displayName}</strong></div>
          <p>{generationMemberState(generation, member.roleKey)}</p>
        </article>)}
      </div>
      {generation.errorMessage !== null && <p className="inline-error">{authorErrorFromUnknown(generation.errorMessage, '生成没有完成，可以重试。')}</p>}
      <footer className="button-row">
        {generation.canCancel && <button type="button" disabled={busy} onClick={onCancel}>停止本轮</button>}
        {generation.canResume && <button type="button" disabled={busy} onClick={onResume}>继续本轮</button>}
        {canRetry && <button type="button" disabled={busy} onClick={onRetry}>继续完成</button>}
      </footer>
    </>}
  </section>;
}

function VolumePlanEditor({ value, onChange, onSave, busy, styleTones }: {
  value: VolumePlanContent;
  onChange: (value: VolumePlanContent) => void;
  onSave: () => void;
  busy: boolean;
  styleTones: string[];
}): React.JSX.Element {
  const routeCard = value.routeCard ?? null;
  const storySpine = value.storySpine ?? null;
  const firstVolumeLaunch = value.firstVolumeLaunch ?? null;
  const setText = (field: keyof VolumePlanContent, next: string): void => onChange({ ...value, [field]: next });
  const setList = (field: keyof VolumePlanContent, next: string): void => onChange({
    ...value, [field]: lines(next)
  });
  const pickPrimaryTone = (tone: string): void => {
    const next = value.stylePrimary === tone ? null : tone;
    onChange({
      ...value,
      stylePrimary: next,
      styleSecondary: next !== null && value.styleSecondary === next ? null : value.styleSecondary ?? null
    });
  };
  const pickSecondaryTone = (tone: string): void => {
    onChange({ ...value, styleSecondary: value.styleSecondary === tone ? null : tone });
  };
  return <section className="volume-plan-editor">
    <header><div><h4>我的卷规划草案</h4><p>先写清“为什么发生”和“发生后改变什么”。章节数只是预估，不会锁死。</p></div><button className="primary-button" type="button" disabled={busy} onClick={onSave}>保存为新候选版</button></header>
    {styleTones.length > 0 && <section className="volume-tone-picker" aria-label="本卷基调">
      <header><div><strong>本卷基调</strong><small>这一卷整体的阅读感觉；写正文时团队会按此把握味道，不是硬性打卡。</small></div></header>
      <section className="tag-picker"><header><strong>主基调</strong><small>选 1 个</small></header><div className="tag-options">{styleTones.map((tone) => {
        const active = value.stylePrimary === tone;
        return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={`${active ? '取消' : '选择'}主基调：${tone}`} key={tone} onClick={() => pickPrimaryTone(tone)}>{active && <CheckCircleIcon />}{tone}</button>;
      })}</div></section>
      <section className="tag-picker"><header><strong>副基调</strong><small>可选，不与主基调重复</small></header><div className="tag-options">{styleTones.map((tone) => {
        const active = value.styleSecondary === tone;
        const blockedTone = !active && value.stylePrimary === tone;
        return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={blockedTone ? `副基调：${tone}（已选为主基调）` : `${active ? '取消' : '选择'}副基调：${tone}`} title={blockedTone ? '已选为主基调' : undefined} disabled={blockedTone} key={tone} onClick={() => pickSecondaryTone(tone)}>{active && <CheckCircleIcon />}{tone}</button>;
      })}</div></section>
    </section>}
    <section className="volume-focus-editor" aria-label="本卷重点表达">
      <header><div><strong>本卷重点表达</strong><small>这一卷想重点写给读者看什么，比如“权谋智斗＋智商在线＋热血爽”。只调当卷侧重，不改全书调子；留空就沿用全书调子。</small></div></header>
      <ImeInput
        value={value.focusExpression ?? ''}
        maxChars={40}
        placeholder="例如：权谋智斗＋智商在线＋热血爽"
        aria-label="本卷重点表达"
        onChange={(next) => onChange({ ...value, focusExpression: next.trim().length === 0 ? null : next })}
      />
    </section>
    {routeCard !== null && <details className="volume-layer-editor" open>
      <summary><span>具体故事路线</span><small>AI给的是可修改的故事过程，不是固定公式。</small></summary>
      <div className="volume-editor-grid">
        <label><span>主角从哪里出发</span><textarea rows={2} value={routeCard.protagonistStart} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, protagonistStart: event.target.value } })} /></label>
        <label><span>为什么主动往前走</span><textarea rows={2} value={routeCard.drivingMotivation} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, drivingMotivation: event.target.value } })} /></label>
        <label><span>升级过程（每行一段）</span><textarea rows={4} value={routeCard.escalationPath.join('\n')} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, escalationPath: lines(event.target.value) } })} /></label>
        <label><span>关键选择与代价</span><textarea rows={3} value={routeCard.keyChoiceAndCost} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, keyChoiceAndCost: event.target.value } })} /></label>
        <label><span>高潮怎样解决</span><textarea rows={3} value={routeCard.climaxResolution} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, climaxResolution: event.target.value } })} /></label>
        <label><span>卷末发生什么变化</span><textarea rows={3} value={routeCard.endingChange} onChange={(event) => onChange({ ...value, routeCard: { ...routeCard, endingChange: event.target.value } })} /></label>
      </div>
    </details>}
    {(storySpine !== null || firstVolumeLaunch !== null) && <details className="volume-layer-editor first-volume-editor">
      <summary><span>第一卷开局与全书故事总线</span><small>默认收起；只有需要调整时再展开。</small></summary>
      <div className="volume-first-editor-body">
        {storySpine !== null && <section><h5>全书软方向</h5><div className="volume-editor-grid">
          <label><span>长期给读者什么满足</span><textarea rows={2} value={storySpine.longTermPromise} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, longTermPromise: event.target.value } })} /></label>
          <label><span>主角跨卷怎样变化</span><textarea rows={2} value={storySpine.protagonistLongArc} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, protagonistLongArc: event.target.value } })} /></label>
          <label><span>贯穿全书的中心问题</span><textarea rows={2} value={storySpine.centralQuestion} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, centralQuestion: event.target.value } })} /></label>
          <label><span>跨卷升级阶梯（每行一层）</span><textarea rows={3} value={storySpine.escalationLadder.join('\n')} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, escalationLadder: lines(event.target.value) } })} /></label>
          <label><span>可选结局方向</span><textarea rows={2} value={storySpine.endingDirection ?? ''} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, endingDirection: event.target.value.trim() || null } })} /></label>
          <label><span>暂时保留的未知空间（每行一条）</span><textarea rows={3} value={storySpine.protectedOpenSpace.join('\n')} onChange={(event) => onChange({ ...value, storySpine: { ...storySpine, protectedOpenSpace: lines(event.target.value) } })} /></label>
        </div></section>}
        {firstVolumeLaunch !== null && <section><h5>爆款开局职责</h5>
          <div className="volume-editor-grid">
            <label><span>前500字让读者追问什么</span><textarea rows={2} value={firstVolumeLaunch.first500.readerQuestion} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, first500: { ...firstVolumeLaunch.first500, readerQuestion: event.target.value } } })} /></label>
            <label><span>前500字正在发生什么</span><textarea rows={2} value={firstVolumeLaunch.first500.immediateSituation} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, first500: { ...firstVolumeLaunch.first500, immediateSituation: event.target.value } } })} /></label>
            <label><span>前500字的情绪抓力</span><textarea rows={2} value={firstVolumeLaunch.first500.emotionalGrip} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, first500: { ...firstVolumeLaunch.first500, emotionalGrip: event.target.value } } })} /></label>
            <label><span>前500字承诺什么变化</span><textarea rows={2} value={firstVolumeLaunch.first500.changePromise} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, first500: { ...firstVolumeLaunch.first500, changePromise: event.target.value } } })} /></label>
          </div>
          <div className="golden-three-editor">{firstVolumeLaunch.goldenThree.map((chapter) => <article key={chapter.chapterNumber}><h6>第{chapter.chapterNumber}章</h6>
            <label><span>本章唯一职责</span><textarea rows={2} value={chapter.responsibility} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, goldenThree: firstVolumeLaunch.goldenThree.map((candidate) => candidate.chapterNumber === chapter.chapterNumber ? { ...candidate, responsibility: event.target.value } : candidate) } })} /></label>
            <label><span>主角行动</span><textarea rows={2} value={chapter.action} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, goldenThree: firstVolumeLaunch.goldenThree.map((candidate) => candidate.chapterNumber === chapter.chapterNumber ? { ...candidate, action: event.target.value } : candidate) } })} /></label>
            <label><span>压力与阻力</span><textarea rows={2} value={chapter.pressure} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, goldenThree: firstVolumeLaunch.goldenThree.map((candidate) => candidate.chapterNumber === chapter.chapterNumber ? { ...candidate, pressure: event.target.value } : candidate) } })} /></label>
            <label><span>当章有效回报</span><textarea rows={2} value={chapter.payoff} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, goldenThree: firstVolumeLaunch.goldenThree.map((candidate) => candidate.chapterNumber === chapter.chapterNumber ? { ...candidate, payoff: event.target.value } : candidate) } })} /></label>
            <label><span>下一章期待</span><textarea rows={2} value={chapter.nextExpectation} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, goldenThree: firstVolumeLaunch.goldenThree.map((candidate) => candidate.chapterNumber === chapter.chapterNumber ? { ...candidate, nextExpectation: event.target.value } : candidate) } })} /></label>
          </article>)}</div>
          <section className="major-climax-editor"><h6>第一卷重大高潮</h6><div className="volume-editor-grid">
            <label><span>最晚累计有效字</span><input type="number" min={1} max={100000} value={firstVolumeLaunch.majorClimax.latestEffectiveCharacters} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, latestEffectiveCharacters: Math.max(1, Math.min(100000, Number(event.target.value) || 1)) } } })} /></label>
            <label><span>前面怎样准备</span><textarea rows={2} value={firstVolumeLaunch.majorClimax.setup} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, setup: event.target.value } } })} /></label>
            <label><span>主角作什么选择</span><textarea rows={2} value={firstVolumeLaunch.majorClimax.choice} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, choice: event.target.value } } })} /></label>
            <label><span>付出什么代价</span><textarea rows={2} value={firstVolumeLaunch.majorClimax.cost} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, cost: event.target.value } } })} /></label>
            <label><span>造成什么不可逆变化</span><textarea rows={2} value={firstVolumeLaunch.majorClimax.irreversibleChange} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, irreversibleChange: event.target.value } } })} /></label>
            <label><span>打开什么新阶段</span><textarea rows={2} value={firstVolumeLaunch.majorClimax.nextStage} onChange={(event) => onChange({ ...value, firstVolumeLaunch: { ...firstVolumeLaunch, majorClimax: { ...firstVolumeLaunch.majorClimax, nextStage: event.target.value } } })} /></label>
          </div></section>
        </section>}
      </div>
    </details>}
    <div className="volume-editor-grid">
      <label><span>卷标题</span><input value={value.title} onChange={(event) => setText('title', event.target.value)} /></label>
      <label><span>开卷时人物与局面</span><textarea rows={3} value={value.openingState} onChange={(event) => setText('openingState', event.target.value)} /></label>
      <label><span>这一卷必须完成什么</span><textarea rows={3} value={value.coreGoal} onChange={(event) => setText('coreGoal', event.target.value)} /></label>
      <label><span>最主要的对抗</span><textarea rows={3} value={value.coreConflict} onChange={(event) => setText('coreConflict', event.target.value)} /></label>
      <label><span>失败会失去什么</span><textarea rows={3} value={value.failureCost} onChange={(event) => setText('failureCost', event.target.value)} /></label>
      <label><span>人物要发生的变化（每行一条）</span><textarea rows={3} value={value.characterChanges.join('\n')} onChange={(event) => setList('characterChanges', event.target.value)} /></label>
      <label><span>卷末留下什么局面</span><textarea rows={3} value={value.endingState} onChange={(event) => setText('endingState', event.target.value)} /></label>
      <label><span>怎样自然引出下一卷</span><textarea rows={3} value={value.nextVolumeTrigger} onChange={(event) => setText('nextVolumeTrigger', event.target.value)} /></label>
    </div>
    <div className="volume-editor-grid compact">
      <label><span>信息怎样逐步揭示（每行一条）</span><textarea rows={3} value={value.informationPlan.join('\n')} onChange={(event) => setList('informationPlan', event.target.value)} /></label>
      <label><span>压力怎样升级、人物怎样喘息（每行一条）</span><textarea rows={3} value={value.escalationAndRecovery.join('\n')} onChange={(event) => setList('escalationAndRecovery', event.target.value)} /></label>
      <label><span>卷末仍未解决的问题（每行一条）</span><textarea rows={3} value={value.openThreads.join('\n')} onChange={(event) => setList('openThreads', event.target.value)} /></label>
      <label><span>不能违反（每行一条）</span><textarea rows={3} value={value.boundaries.mustNotViolate.join('\n')} onChange={(event) => onChange({ ...value, boundaries: { ...value.boundaries, mustNotViolate: lines(event.target.value) } })} /></label>
      <label><span>允许自由发挥（每行一条）</span><textarea rows={3} value={value.boundaries.creativeFreedom.join('\n')} onChange={(event) => onChange({ ...value, boundaries: { ...value.boundaries, creativeFreedom: lines(event.target.value) } })} /></label>
    </div>
  </section>;
}

function VolumeVersionCard({ version, active, busy, onPreview }: {
  version: VolumePlanVersionData;
  active: boolean;
  busy: boolean;
  onPreview: () => void;
}): React.JSX.Element {
  return <article className={`volume-version-card ${active ? 'active' : ''}`}>
    <header><span>{candidateLabel(version.candidateKind)}</span><small>第{version.version}稿 · {active ? '当前确认稿' : statusLabel(version.status)}</small></header>
    <h5>{version.content.title}</h5>
    <dl><div><dt>本卷基调</dt><dd>{[version.content.stylePrimary, version.content.styleSecondary].filter(Boolean).join('＋') || '未选择'}</dd></div><div><dt>本卷重点表达</dt><dd>{version.content.focusExpression ?? '沿用全书调子'}</dd></div><div><dt>本卷目标</dt><dd>{version.content.coreGoal}</dd></div><div><dt>核心冲突</dt><dd>{version.content.coreConflict}</dd></div><div><dt>卷末状态</dt><dd>{version.content.endingState}</dd></div></dl>
    {version.content.routeCard != null && <section className="volume-concrete-route">
      <dl>
        <div><dt>主角从哪里出发</dt><dd>{version.content.routeCard.protagonistStart}</dd></div>
        <div><dt>为什么主动往前走</dt><dd>{version.content.routeCard.drivingMotivation}</dd></div>
        <div><dt>关键选择与代价</dt><dd>{version.content.routeCard.keyChoiceAndCost}</dd></div>
        <div><dt>高潮怎样解决</dt><dd>{version.content.routeCard.climaxResolution}</dd></div>
        <div><dt>卷末发生什么变化</dt><dd>{version.content.routeCard.endingChange}</dd></div>
      </dl>
      <ol>{version.content.routeCard.escalationPath.map((step) => <li key={step}>{step}</li>)}</ol>
      <details><summary>这条路线的好处与风险</summary><div><b>好处</b><ul>{version.content.routeCard.benefits.map((item) => <li key={item}>{item}</li>)}</ul><b>风险</b><ul>{version.content.routeCard.risks.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
    </section>}
    {(version.content.storySpine != null || version.content.firstVolumeLaunch != null) && <details className="first-volume-design"><summary>第一卷开局与全书故事总线</summary><div>{version.content.storySpine != null && <><b>全书长期承诺</b><p>{version.content.storySpine.longTermPromise}</p><b>主角长期变化</b><p>{version.content.storySpine.protagonistLongArc}</p><b>中心问题</b><p>{version.content.storySpine.centralQuestion}</p></>}{version.content.firstVolumeLaunch != null && <><b>前500字</b><p>{version.content.firstVolumeLaunch.first500.immediateSituation}；{version.content.firstVolumeLaunch.first500.emotionalGrip}；{version.content.firstVolumeLaunch.first500.readerQuestion}</p><b>黄金三章</b><ol>{version.content.firstVolumeLaunch.goldenThree.map((chapter) => <li key={chapter.chapterNumber}>第{chapter.chapterNumber}章：{chapter.responsibility}；回报：{chapter.payoff}</li>)}</ol><b>重大高潮</b><p>最晚在累计 {version.content.firstVolumeLaunch.majorClimax.latestEffectiveCharacters.toLocaleString('zh-CN')} 有效字前：{version.content.firstVolumeLaunch.majorClimax.choice}；代价：{version.content.firstVolumeLaunch.majorClimax.cost}；变化：{version.content.firstVolumeLaunch.majorClimax.irreversibleChange}</p></>}</div></details>}
    {version.content.fusionNotes != null && <div className="fusion-notes">
      <p><strong>爽点怎么兑现</strong>{version.content.fusionNotes.payoffDesign}</p>
      <p><strong>逻辑链怎么闭环</strong>{version.content.fusionNotes.logicChain}</p>
      <p><strong>新鲜感来自哪里</strong>{version.content.fusionNotes.freshness}</p>
    </div>}
    <button type="button" disabled={busy || active} onClick={onPreview}>{active ? '正在使用' : version.status === 'superseded' ? '查看切回影响' : '预览并确认'}</button>
  </article>;
}

function emptyVolumePlan(
  planNumber: number,
  tone?: { stylePrimary?: string | null; styleSecondary?: string | null } | null
): VolumePlanContent {
  return {
    title: `第${planNumber}卷`, openingState: '', coreGoal: '', coreConflict: '', failureCost: '',
    characterChanges: [],
    stylePrimary: tone?.stylePrimary ?? null,
    styleSecondary: tone?.styleSecondary ?? null,
    eventSequence: [],
    informationPlan: [], escalationAndRecovery: [], endingState: '', openThreads: [], nextVolumeTrigger: '',
    boundaries: { mustAchieve: [], mustNotViolate: [], creativeFreedom: [], openQuestions: [] }
  };
}

function freePlanningReference(): PlanningTemplateInstance {
  return {
    selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
    scope: 'volume', beats: [], customDirection: null
  };
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}

function key(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${randomId ?? `${Date.now()}-${Math.random()}`}`;
}



function generationMemberState(generation: VolumePlanGenerationData, roleKey: string): string {
  const storedId = roleKey === 'lead_screenwriter'
    ? generation.candidateVersionIds.candidateA
    : roleKey === 'second_screenwriter'
      ? generation.candidateVersionIds.candidateB
      : generation.candidateVersionIds.fusion;
  if (storedId !== null) return '方案已准备好';
  if (generation.canRetry) return '本轮未完成，可以继续';
  if (generation.canResume) return '已暂停，等待继续';
  if (!generation.isRunning && !generation.isCompleted) return generation.stateText;
  const screenwritersReady = generation.candidateVersionIds.candidateA !== null
    && generation.candidateVersionIds.candidateB !== null;
  if (!['lead_screenwriter', 'second_screenwriter'].includes(roleKey) && screenwritersReady) {
    return '等待你选择整份路线或具体部分';
  }
  if (!['lead_screenwriter', 'second_screenwriter'].includes(roleKey)) return '等待两位编剧完成';
  return '正在构思方案';
}

function messageOf(reason: unknown): string {
  return authorErrorFromUnknown(reason, '当前卷规划操作失败，请稍后重试。');
}

function candidateLabel(kind: VolumePlanVersionData['candidateKind']): string {
  return ({ candidate_a: '方案一', candidate_b: '方案二', author_edit: '我的修改', fusion: '主编整理版', legacy: '旧稿参考' })[kind];
}

function statusLabel(status: VolumePlanVersionData['status']): string {
  return ({ candidate: '待确认', active: '已确认', superseded: '历史确认版', archived: '已归档' })[status];
}

function fieldLabel(field: string): string {
  return ({
    title: '卷标题', openingState: '开卷状态', coreGoal: '本卷目标', coreConflict: '核心冲突',
    failureCost: '失败代价', characterChanges: '人物变化', eventSequence: '事件链',
    informationPlan: '信息推进', escalationAndRecovery: '压力与恢复', endingState: '卷末状态',
    openThreads: '开放线索', nextVolumeTrigger: '下一卷接口', boundaries: '创作边界'
  } as Record<string, string>)[field] ?? field;
}
