import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CirclesThreePlusIcon,
} from '@phosphor-icons/react';
import type { CoreWorkflowV6View, StorylineContent, StorylineTopologyContent, StorylineTopologyType } from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import {
  AiNodePanel,
  V6Dialog,
  V6Drawer,
  V6EmptyState,
  V6ErrorState,
  V6LoadingState,
  V6PageHeader
} from './V6Shared';
import {
  confirmStoryline,
  confirmTopology,
  createStoryline,
  fetchCoreWorkflow,
  reorderStorylines,
  saveStorylineVersion,
  saveTopology,
  upsertStorylineRelation,
  updateStorylineLifecycle
} from './v6-api';
import { StorylineBoard } from './StorylineBoard';

const topologyOptions: Array<{ key: StorylineTopologyType; title: string; summary: string; lines: string[] }> = [
  { key: 'core_with_branches', title: '一条核心线 + 支线', summary: '一个全书核心问题持续牵引，其他线路负责服务、牵制或映照。', lines: ['核心线回答全书最重要的问题', '支线在关键节点与核心线交汇'] },
  { key: 'dual_core', title: '双核心线', summary: '两条同等重要的核心问题彼此推动，适合双主角或双世界。', lines: ['两条线各自完整推进', '交汇点必须改变彼此走向'] },
  { key: 'multi_core', title: '多核心线', summary: '三条以上核心问题并进，适合群像与复杂势力。', lines: ['每条线都有独立阶段目标', '按卷决定主导与暂缓线路'] },
  { key: 'unit_stories', title: '单元故事', summary: '稳定核心关系串联多个相对完整的故事单元。', lines: ['单元有独立问题与结算', '全书暗线持续积累和回收'] }
];

export function StorylineWorkspace({ bookId, bookTitle, onChanged, onNext }: {
  bookId: string;
  bookTitle: string;
  onChanged?: () => Promise<void> | void;
  onNext: () => void;
}): React.JSX.Element {
  const [workflow, setWorkflow] = useState<CoreWorkflowV6View | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topologyChoice, setTopologyChoice] = useState<StorylineTopologyType>('core_with_branches');
  const [showAllStructures, setShowAllStructures] = useState(false);
  const [editor, setEditor] = useState<{ storylineId: string | null; content: StorylineContent } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [mapTab, setMapTab] = useState<'lines' | 'progress' | 'foreshadow'>('lines');
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { setWorkflow(await fetchCoreWorkflow(bookId, signal)); setError(null); }
    catch (reason) { if (signal?.aborted !== true) setError(authorErrorFromUnknown(reason, '故事线加载失败')); }
    finally { if (signal?.aborted !== true) setLoading(false); }
  }, [bookId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const chosenTopology = topologyOptions.find((item) => item.key === topologyChoice) ?? topologyOptions[0]!;
  const source = useMemo(() => ({
    sourceType: 'book_core', sourceId: bookId, content: `${bookTitle}。请围绕本书已确认开书资料推荐叙事拓扑，不补写具体事件。`,
    reason: '本书开书资料与当前故事线任务', priority: 100, truthStatus: 'confirmed' as const,
    constraintStrength: 'hard_fact' as const, scopeType: 'book' as const, scopeId: bookId,
    componentKind: 'BookCorePack' as const
  }), [bookId, bookTitle]);

  const acceptTopology = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const content: StorylineTopologyContent = {
        topologyType: chosenTopology.key,
        plainLanguageReason: chosenTopology.summary,
        lineResponsibilities: chosenTopology.lines,
        authorNotes: null
      };
      const saved = await saveTopology(bookId, content);
      await confirmTopology(bookId, saved.topologyVersionId, workflow?.topology.active?.topologyVersionId ?? null);
      await load(); setConfirmation('全书结构已确认，正在生成可编辑的故事线骨架。'); await onChanged?.();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '叙事结构确认失败')); }
    finally { setBusy(false); }
  };

  const moveLine = async (storylineId: string, direction: -1 | 1): Promise<void> => {
    const ids = (workflow?.storylines ?? []).filter((line) => line.lifecycleStatus !== 'abandoned').map((line) => line.storylineId);
    const from = ids.indexOf(storylineId); const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setBusy(true);
    try { await reorderStorylines(bookId, ids); await load(); }
    catch (reason) { setError(authorErrorFromUnknown(reason, '故事线排序失败')); }
    finally { setBusy(false); }
  };
  const saveLine = async (content: StorylineContent): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (editor?.storylineId === null || editor === null) {
        const created = await createStoryline(bookId, content, (workflow?.storylines.length ?? 0) + 1);
        await confirmStoryline(bookId, created.storylineId, created.versionId, null);
      } else {
        const current = workflow?.storylines.find((item) => item.storylineId === editor.storylineId);
        const saved = await saveStorylineVersion(bookId, editor.storylineId, content);
        await confirmStoryline(bookId, editor.storylineId, saved.versionId, current?.activeVersionId ?? null);
      }
      setEditor(null); await load(); await onChanged?.();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '故事线保存失败')); }
    finally { setBusy(false); }
  };

  if (loading) return <V6LoadingState label="正在整理故事线与全书结构…" />;
  if (workflow === null) return <V6ErrorState message={error ?? '故事线暂时无法打开'} onRetry={() => void load()} />;
  const activeTopology = workflow.topology.active;
  const activeLines = workflow.storylines.filter((line) => line.lifecycleStatus !== 'abandoned');

  return <section className="v6-page v6-storyline-page">
    <div className="v6-phase-line" aria-label="故事线阶段"><span>结构推荐</span><i /><b>故事线骨架</b><i /><span>确认</span></div>
    <V6PageHeader eyebrow="全书脉络" title="全书故事线" description="一条核心故事带着支线共同推进；每条线都保留自己的问题、阶段和交汇。" mapAction={() => setMapOpen(true)} />
    {activeTopology === null ? <>
      <section className="v6-paper-section v6-topology-recommendation">
        <header><span>AI 推荐</span><h3>{chosenTopology.title}</h3><p>{chosenTopology.summary}</p></header>
        <div className="v6-topology-sketch" aria-label={chosenTopology.title}>
          <i /><strong>全书核心问题</strong>{chosenTopology.lines.map((line, index) => <span key={line} data-kind={index === 0 ? 'core' : 'branch'}>{line}</span>)}
        </div>
        <footer><button type="button" className="v6-quiet-button" onClick={() => setShowAllStructures((value) => !value)}>{showAllStructures ? '收起其他结构' : '自己选择其他结构'}</button>
          <button type="button" className="v6-primary-button" disabled={busy} onClick={() => void acceptTopology()}><CheckCircleIcon />直接接受</button></footer>
      </section>
      {showAllStructures && <section className="v6-topology-grid" aria-label="选择叙事拓扑">{topologyOptions.map((option) => <button type="button"
        key={option.key} className={topologyChoice === option.key ? 'selected' : ''} onClick={() => setTopologyChoice(option.key)}>
        <CirclesThreePlusIcon /><strong>{option.title}</strong><span>{option.summary}</span>
      </button>)}</section>}
      <AiNodePanel bookId={bookId} nodeKind="storyline_topology" objectId="storyline-root" roleKey="screenwriter"
        title="让团队出结构方案" taskDescription="编剧会独立给出 2—3 种白话结构供您比较。" source={source}
        templateVersion="storyline-topology-v1" onUseCandidate={(content) => {
          const key = String(content.topologyType ?? '');
          if (topologyOptions.some((item) => item.key === key)) setTopologyChoice(key as StorylineTopologyType);
        }} />
    </> : <>
      <StorylineBoard lines={activeLines} busy={busy}
        onAdd={() => setEditor({ storylineId: null, content: emptyLine(activeLines.length === 0 ? '全书核心线' : '新故事线', activeLines.length === 0 ? 'core' : 'branch') })}
        onRelations={() => setRelationOpen(true)}
        onView={(view) => { setMapTab(view); setMapOpen(true); }}
        onMove={(storylineId, offset) => void moveLine(storylineId, offset)}
        onEdit={(storylineId, content) => setEditor({ storylineId, content })}
        onAbandon={(storylineId) => void updateStorylineLifecycle(bookId, storylineId, 'abandoned').then(() => load())} />
      {activeLines.length > 0 && <div className="v6-next-step"><span><strong>故事线骨架已准备好确认</strong><small>确认后才会开放分卷，并安排各条线在本卷的责任。</small></span><button type="button" className="v6-primary-button" onClick={onNext}>确认故事线并进入分卷<ArrowRightIcon /></button></div>}
      <details className="v6-storyline-ai-tools"><summary>让编剧补充或重新整理故事线</summary><AiNodePanel bookId={bookId} nodeKind="storyline_design" objectId="storyline-root" roleKey="screenwriter"
        title="让编剧整理故事线骨架" taskDescription="把自然语言想法整理成可编辑的线路，不会覆盖您已确认的内容。" source={{ ...source,
          sourceType: 'storyline_topology', sourceId: activeTopology.topologyVersionId, version: activeTopology.version,
          content: JSON.stringify(activeTopology.content), reason: '已确认叙事拓扑', componentKind: 'BookStorySpinePack' }}
        templateVersion="storyline-skeleton-v1" /></details>
    </>}
    {confirmation !== null && <p className="v6-inline-success" role="status">{confirmation}</p>}
    {editor !== null && <LineEditor initial={editor.content} characters={workflow.characters} busy={busy} onClose={() => setEditor(null)} onSave={(content) => void saveLine(content)} />}
    {relationOpen && <RelationEditor lines={activeLines.map((line) => ({ id: line.storylineId, title: line.activeVersion?.content.title ?? '未命名故事线' }))}
      onClose={() => setRelationOpen(false)} onSave={async (input) => {
        setBusy(true);
        try { await upsertStorylineRelation(bookId, input); setRelationOpen(false); await load(); }
        catch (reason) { setError(authorErrorFromUnknown(reason, '线路关系保存失败')); }
        finally { setBusy(false); }
      }} />}
    {mapOpen && <V6Drawer title="故事地图" onClose={() => setMapOpen(false)}>
      <div className="v6-map-tabs" role="tablist">{([['lines', '线路地图'], ['progress', '推进轨道'], ['foreshadow', '伏笔轨道']] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={mapTab === key} key={key} onClick={() => setMapTab(key)}>{label}</button>)}</div>
      <StoryMap tab={mapTab} workflow={workflow} />
    </V6Drawer>}
    {error !== null && <p className="v6-inline-error" role="alert">{error}</p>}
  </section>;
}

function RelationEditor({ lines: items, onClose, onSave }: {
  lines: Array<{ id: string; title: string }>;
  onClose: () => void;
  onSave: (input: { fromStorylineId: string; toStorylineId: string; relationType: 'serves' | 'constrains' | 'mirrors' | 'intersects'; description: string }) => Promise<void>;
}): React.JSX.Element {
  const [from, setFrom] = useState(items[0]?.id ?? ''); const [to, setTo] = useState(items[1]?.id ?? '');
  const [relationType, setRelationType] = useState<'serves' | 'constrains' | 'mirrors' | 'intersects'>('serves');
  const [description, setDescription] = useState('');
  return <V6Dialog title="设置线路关系" onClose={onClose}>
    <div className="v6-field-grid"><label><span>从这条线</span><select value={from} onChange={(event) => setFrom(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>到这条线</span><select value={to} onChange={(event) => setTo(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>关系</span><select value={relationType} onChange={(event) => setRelationType(event.target.value as typeof relationType)}><option value="serves">服务</option><option value="constrains">牵制</option><option value="mirrors">映照</option><option value="intersects">交汇</option></select></label>
      <label className="wide"><span>白话说明</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={from === to || description.trim() === ''} onClick={() => void onSave({ fromStorylineId: from, toStorylineId: to, relationType, description })}>保存关系</button></footer>
  </V6Dialog>;
}
function LineEditor({ initial, characters, busy, onClose, onSave }: { initial: StorylineContent; characters: CoreWorkflowV6View['characters']; busy: boolean; onClose: () => void; onSave: (content: StorylineContent) => void }): React.JSX.Element {
  const [content, setContent] = useState(initial);
  const [stages, setStages] = useState(initial.expectedStages.join('\n'));
  const [foreshadows, setForeshadows] = useState(initial.foreshadowingKeys.join('\n'));
  return <div className="v6-dialog-backdrop"><section className="v6-dialog v6-line-editor" role="dialog" aria-modal="true" aria-labelledby="line-editor-title">
    <header><h3 id="line-editor-title">编辑故事线</h3><button type="button" className="v6-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
    <div className="v6-field-grid"><label><span>线路名称</span><input value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} /></label>
      <label><span>线路性质</span><select value={content.lineKind} onChange={(event) => setContent({ ...content, lineKind: event.target.value as StorylineContent['lineKind'] })}><option value="core">核心线</option><option value="branch">支线</option><option value="unit">单元线</option></select></label>
      <label className="wide"><span>全书/本线要回答的核心问题</span><textarea rows={2} value={content.coreQuestion} onChange={(event) => setContent({ ...content, coreQuestion: event.target.value })} /></label>
      <label className="wide"><span>当前阶段目标</span><textarea rows={2} value={content.stageGoal} onChange={(event) => setContent({ ...content, stageGoal: event.target.value })} /></label>
      <label><span>预计阶段（每行一项）</span><textarea rows={4} value={stages} onChange={(event) => setStages(event.target.value)} /></label>
      <label><span>伏笔（每行一项）</span><textarea rows={4} value={foreshadows} onChange={(event) => setForeshadows(event.target.value)} /></label>
      <fieldset className="wide v6-option-checks"><legend>关联角色</legend>{characters.filter((item) => item.content !== null).map((character) => <label key={character.characterId}>
        <input type="checkbox" checked={content.associatedCharacterIds.includes(character.characterId)} onChange={(event) => setContent({ ...content,
          associatedCharacterIds: event.target.checked ? [...content.associatedCharacterIds, character.characterId] : content.associatedCharacterIds.filter((id) => id !== character.characterId) })} />
        <span>{character.content?.name}</span></label>)}{characters.length === 0 && <small>角色会在后续角色安排中补充。</small>}</fieldset>
    </div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={busy || content.title.trim() === '' || content.coreQuestion.trim() === ''}
      onClick={() => onSave({ ...content, expectedStages: lines(stages), foreshadowingKeys: lines(foreshadows) })}>保存并确认版本</button></footer>
  </section></div>;
}

function StoryMap({ tab, workflow }: { tab: 'lines' | 'progress' | 'foreshadow'; workflow: CoreWorkflowV6View }): React.JSX.Element {
  if (tab === 'foreshadow') {
    const items = workflow.storylines.flatMap((line) => line.activeVersion?.content.foreshadowingKeys.map((key) => ({ line: line.activeVersion?.content.title ?? '', key })) ?? []);
    return items.length === 0 ? <V6EmptyState title="尚无伏笔记录" description="伏笔计划在事件和章节中管理，实际进度由结算更新。" />
      : <ul className="v6-map-list">{items.map((item) => <li key={`${item.line}:${item.key}`}><i data-truth="planned" /><span><strong>{item.key}</strong><small>{item.line} · 计划</small></span></li>)}</ul>;
  }
  return <div className="v6-map-canvas">{workflow.storylines.map((line) => {
    const content = line.activeVersion?.content;
    if (content === undefined) return null;
    const actual = workflow.ledgers.storyline.actual.some((entry) => entry.subjectKey === line.storylineId);
    return <article key={line.storylineId} data-line={actual ? 'actual' : line.lifecycleStatus === 'abandoned' ? 'abandoned' : line.lifecycleStatus === 'ideation' ? 'pending' : 'planned'}>
      <span>{content.lineKind === 'core' ? '核心线' : content.lineKind === 'branch' ? '支线' : '单元线'}</span><strong>{content.title}</strong><p>{tab === 'progress' ? content.stageGoal : content.coreQuestion}</p>
    </article>;
  })}<div className="v6-map-legend"><span><i data-line="actual" />真实已发生</span><span><i data-line="planned" />计划</span><span><i data-line="pending" />待定</span><span><i data-line="abandoned" />废弃</span></div></div>;
}

function emptyLine(title: string, kind: StorylineContent['lineKind']): StorylineContent {
  return { title, lineKind: kind, coreQuestion: '', stageGoal: '', expectedStages: [], associatedCharacterIds: [], foreshadowingKeys: [], rhythmMethodVersionId: null };
}

function lines(value: string): string[] { return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean); }
function topologyLabel(value: StorylineTopologyType): string { return topologyOptions.find((item) => item.key === value)?.title ?? value; }
function lineKindLabel(value: StorylineContent['lineKind']): string { return value === 'core' ? '全书核心线' : value === 'branch' ? '支线' : '单元线'; }
function lifecycleLabel(value: string): string { return ({ ideation: '构思中', active: '推进中', paused: '暂缓', completed: '已完成', abandoned: '已废弃' } as Record<string, string>)[value] ?? value; }
