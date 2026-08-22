import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, FlaskIcon, MagicWandIcon } from '@phosphor-icons/react';
import type { VolumeExpressionPlan } from '@wenmi/contracts';
import {
  addVolumePlanVersion,
  confirmVolumePlanVersion,
  fetchCreationWorkflow,
  fetchVolumePlans,
  previewVolumePlanImpact,
  type VolumePlanImpactData
} from '../../lib/api/client';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { AiNodePanel, V6EmptyState } from './V6Shared';

type ExpressionDraft = VolumeExpressionPlan;

export function VolumeExpressionWorkspace({ bookId, onConfirmed }: { bookId: string; onConfirmed: () => void }): React.JSX.Element {
  const [plans, setPlans] = useState<Awaited<ReturnType<typeof fetchVolumePlans>>>([]);
  const [draft, setDraft] = useState<ExpressionDraft | null>(null);
  const [candidateVersionId, setCandidateVersionId] = useState<string | null>(null);
  const [impact, setImpact] = useState<VolumePlanImpactData | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextPlans, workflow] = await Promise.all([fetchVolumePlans(bookId), fetchCreationWorkflow(bookId)]);
    setPlans(nextPlans);
    const confirmed = pickCurrentVolume(nextPlans)?.activeVersion?.content.expressionPlan;
    if (confirmed !== undefined && confirmed !== null) setDraft((current) => current ?? confirmed);
    return { plans: nextPlans, workflowVersion: workflow.planningVersion };
  }, [bookId]);

  useEffect(() => { void load().catch((reason: unknown) => setError(authorErrorFromUnknown(reason, '表达方案加载失败'))); }, [load]);
  const plan = pickCurrentVolume(plans);
  const active = plan?.activeVersion ?? null;
  const source = useMemo(() => active === null ? null : ({
    sourceType: 'volume_direction', sourceId: active.volumePlanVersionId, version: active.version,
    content: JSON.stringify(active.content), reason: '已确认本卷方向与各线路责任', priority: 100,
    truthStatus: 'confirmed' as const, constraintStrength: 'hard_fact' as const,
    scopeType: 'volume' as const, scopeId: plan?.volumePlanId ?? bookId, componentKind: 'VolumeResponsibilityPack' as const
  }), [active, bookId, plan?.volumePlanId]);

  const mergeCandidate = (content: Record<string, unknown>, coordinatedBy: ExpressionDraft['coordinatedBy'] = 'writer'): void => {
    setDraft((current) => ({
      narrativeOrder: String(content.narrativeOrder ?? current?.narrativeOrder ?? ''),
      pointOfView: String(content.pointOfView ?? current?.pointOfView ?? ''),
      emotionalTone: String(content.emotionalTone ?? current?.emotionalTone ?? ''),
      proseStyle: String(content.proseStyle ?? current?.proseStyle ?? ''),
      informationRelease: String(content.informationRelease ?? current?.informationRelease ?? ''),
      transitions: String(content.transitions ?? current?.transitions ?? ''),
      coordinatedBy,
      sampleText: current?.sampleText ?? null,
      sampleDisclaimer: current?.sampleText ? '示意，非正式正文' : null
    }));
    setCandidateVersionId(null); setImpact(null);
  };

  const save = async (): Promise<void> => {
    if (plan === null || active === null || draft === null || !complete(draft)) return;
    setBusy(true); setError(null);
    try {
      const saved = await addVolumePlanVersion(bookId, plan.volumePlanId, {
        expectedPlanRevision: plan.revision, candidateKind: 'author_edit', parentVersionId: active.volumePlanVersionId,
        template: active.template, authorInputRefs: [], content: { ...active.content, expressionPlan: draft },
        idempotencyKey: `volume-expression:${plan.volumePlanId}:${crypto.randomUUID()}`
      });
      setCandidateVersionId(saved.volumePlanVersionId);
      setImpact(await previewVolumePlanImpact(bookId, plan.volumePlanId, saved.volumePlanVersionId));
      await load();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '表达方案保存失败')); }
    finally { setBusy(false); }
  };

  const confirm = async (): Promise<void> => {
    if (plan === null || candidateVersionId === null) return;
    setBusy(true); setError(null);
    try {
      const latest = await load();
      const latestPlan = latest.plans.find((item) => item.volumePlanId === plan.volumePlanId);
      if (latestPlan === undefined) throw new Error('当前卷规划已经变化，请重新打开。');
      await confirmVolumePlanVersion(bookId, plan.volumePlanId, {
        volumePlanVersionId: candidateVersionId, expectedPlanRevision: latestPlan.revision,
        expectedActiveVersionId: latestPlan.activeVersionId, expectedWorkflowVersion: latest.workflowVersion
      });
      setCandidateVersionId(null); setImpact(null); await load(); onConfirmed();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '表达方案确认失败')); }
    finally { setBusy(false); }
  };

  if (plan === null || active === null || source === null) return <V6EmptyState title="先确认本卷方向" description="表达方案建立在已确认的本卷责任上，不会提前替您决定事件。" />;
  const alreadyConfirmed = active.content.expressionPlan !== undefined && active.content.expressionPlan !== null;
  return <section className="v6-expression-workspace">
    <header><div><span>表达方案</span><h3>确定这一卷怎样讲出来</h3><p>先选完整方案；混合维度后必须再交主笔或副编协调。</p></div>
      {alreadyConfirmed && <small><CheckCircleIcon weight="fill" />当前卷已确认表达方案</small>}</header>
    <AiNodePanel bookId={bookId} nodeKind="volume_expression" objectId={plan.volumePlanId} roleKey="writer"
      title="让主笔提供 2—3 套连贯方案" taskDescription="每套都包含叙事顺序、视角、情绪、文字、信息释放和转场。"
      source={source} templateVersion="volume-expression-v1" defaultMemberCount={2} onUseCandidate={mergeCandidate} />
    {draft !== null && <>
      <ExpressionEditor value={draft} disabled={busy} onChange={(next) => { setDraft(next); setCandidateVersionId(null); setImpact(null); }} />
      <AiNodePanel bookId={bookId} nodeKind="volume_expression_coordination" objectId={plan.volumePlanId} roleKey="writer"
        title="协调混合后的表达方案" taskDescription="只协调作者已经选择或修改的六个维度，不私自换回未选方案。"
        source={{ ...source, sourceType: 'expression_draft', sourceId: plan.volumePlanId, content: JSON.stringify(draft), constraintStrength: 'current_task' }}
        templateVersion="volume-expression-coordinate-v1" onUseCandidate={(content) => mergeCandidate(content, 'writer')} />
      <div className="v6-expression-sample">
        <button type="button" className="v6-quiet-button" onClick={() => setSampleOpen((value) => !value)}><FlaskIcon />{sampleOpen ? '收起示例' : '按需生成 200—500 字示例'}</button>
        {draft.sampleText && <blockquote><small>示意，非正式正文</small>{draft.sampleText}</blockquote>}
      </div>
      {sampleOpen && <AiNodePanel bookId={bookId} nodeKind="volume_expression_sample" objectId={plan.volumePlanId} roleKey="writer"
        title="生成同一场景责任的表达示例" taskDescription="只示范表达，不推进事实，不进入正文或结算。" source={{ ...source,
          sourceType: 'expression_draft', sourceId: plan.volumePlanId, content: JSON.stringify(draft), constraintStrength: 'current_task' }}
        templateVersion="volume-expression-sample-v1" onUseCandidate={(content) => setDraft({ ...draft,
          sampleText: String(content.sampleText ?? content.content ?? ''), sampleDisclaimer: '示意，非正式正文' })} />}
      <footer><button type="button" className="v6-primary-button" disabled={busy || !complete(draft)} onClick={() => void save()}><MagicWandIcon />保存表达方案并预览影响</button></footer>
      {impact !== null && candidateVersionId !== null && <aside className="v6-expression-impact"><strong>确认前影响预览</strong><p>{impact.note}</p>
        <button type="button" className="v6-primary-button" disabled={busy} onClick={() => void confirm()}>确认卷方向与表达方案，进入事件</button></aside>}
    </>}
    {error !== null && <p className="v6-inline-error" role="alert">{error}</p>}
  </section>;
}

function ExpressionEditor({ value, disabled, onChange }: { value: ExpressionDraft; disabled: boolean; onChange: (value: ExpressionDraft) => void }): React.JSX.Element {
  const fields = [
    ['narrativeOrder', '叙事顺序'], ['pointOfView', '叙事视角'], ['emotionalTone', '情绪基调'],
    ['proseStyle', '文字表达'], ['informationRelease', '信息释放'], ['transitions', '转场方式']
  ] as const;
  return <section className="v6-expression-editor"><header><span>作者可编辑稿</span><small>六个维度必须组成一套连贯方案</small></header>
    <div>{fields.map(([key, label]) => <label key={key}><span>{label}</span><textarea rows={3} disabled={disabled} value={value[key]}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>)}</div></section>;
}

function complete(value: ExpressionDraft): boolean {
  return [value.narrativeOrder, value.pointOfView, value.emotionalTone, value.proseStyle, value.informationRelease, value.transitions]
    .every((item) => item.trim().length > 0);
}

function pickCurrentVolume<T extends { planNumber: number; status: string; activeVersion: unknown }>(plans: T[]): T | null {
  return plans
    .filter((item) => (item.status === 'active' || item.status === 'planning') && item.activeVersion !== null)
    .sort((left, right) => right.planNumber - left.planNumber)[0] ?? null;
}
