import {
  CaretDownIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FileTextIcon,
  GitBranchIcon,
  HandPalmIcon,
  SparkleIcon,
  UsersThreeIcon
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activateManagedCreation,
  cancelCreationWorkflow,
  chooseCreationOption,
  confirmCreationOutline,
  continueCreationToChain,
  continueCreationToNextChain,
  createCreationWorkflow,
  fetchCreationLibrary,
  fetchCreationManuscript,
  fetchCreationMembers,
  fetchCreationWorkflow,
  fetchCreationWriteBack,
  fetchLatestCreationWorkflow,
  finalizeCreationManuscript,
  generateCreationManuscript,
  generateCreationOutlines,
  retryCreationOptions,
  type CreationMember,
  type CreationChapterOutline,
  type CreationChapterReview,
  type CreationLibraryView,
  type CreationManuscriptView,
  type CreationMemberSelectionKey,
  type CreationRoleKey,
  type CreationWorkflowView
} from './creation-api';
import {
  AuthorApiError,
  confirmPlanningTree,
  fetchPlanningTree,
  type PlanningTreeNodeView,
  type PlanningTreeView
} from './opening-api';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { canonicalMemberIdentityKey, publicFailureCopy, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import type { CreationScopeOverride } from './navigation';

type Focus = 'volume' | 'chain' | 'chapter';
type CreationWriteBack = Awaited<ReturnType<typeof fetchCreationWriteBack>>;
type OutlineCandidateView = NonNullable<CreationWorkflowView['outlines']>[number];
type CreationLibraryVolume = CreationLibraryView['volumes'][number];
type CreationLibraryChain = CreationLibraryVolume['chains'][number];
type CreationLibraryChapter = NonNullable<CreationLibraryChain['outline']>['chapters'][number];
type ChapterDirectoryEntry = CreationLibraryChapter & { chainScopeId: string };

export function CreationWorkspacePage({ bookId, focus, onNavigate }: {
  bookId: string;
  focus: Focus;
  onNavigate: (focus: Focus, scope?: CreationScopeOverride) => void;
}): React.JSX.Element {
  const [bookTree, setBookTree] = useState<PlanningTreeView | null>(null);
  const [volumeTree, setVolumeTree] = useState<PlanningTreeView | null>(null);
  const [chainTree, setChainTree] = useState<PlanningTreeView | null>(null);
  const [workflow, setWorkflow] = useState<CreationWorkflowView | null>(null);
  const [library, setLibrary] = useState<CreationLibraryView>({ volumes: [] });
  const [members, setMembers] = useState<CreationMember[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState(() => creationScopeFromSearch().volumeScopeId);
  const [selectedChainId, setSelectedChainId] = useState(() => creationScopeFromSearch().chainScopeId);
  const [selectedChapterNumber, setSelectedChapterNumber] = useState<number | null>(() => creationScopeFromSearch().chapterNumber);
  const [selectedManuscript, setSelectedManuscript] = useState<CreationManuscriptView | null>(null);
  const [goal, setGoal] = useState('');
  const [authorNote, setAuthorNote] = useState('');
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeBack, setWriteBack] = useState<CreationWriteBack | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [tree, latest, roster, nextLibrary] = await Promise.all([
      fetchPlanningTree(bookId, 'book', bookId, signal).catch((reason: unknown) => {
        if (reason instanceof AuthorApiError && reason.status === 404) return null;
        throw reason;
      }),
      fetchLatestCreationWorkflow(bookId, signal),
      fetchCreationMembers(signal),
      fetchCreationLibrary(bookId, signal)
    ]);
    setError(null);
    setBookTree(tree);
    setWorkflow(latest);
    setLibrary(nextLibrary);
    setMembers(uniqueByMemberKey(roster));
    const firstVolume = tree?.root.children.find((node) => node.linkedTree?.treeKind === 'volume');
    const nextVolumeScopeId = latest?.volumeScopeId || firstVolume?.linkedTree?.scopeId || '';
    const nextChainScopeId = latest?.chainScopeId
      ?? nextLibrary.volumes.find((volume) => volume.volumeScopeId === nextVolumeScopeId)?.chains[0]?.chainScopeId
      ?? '';
    setSelectedVolumeId((current) => volumeScopeExists(tree, current) ? current : nextVolumeScopeId);
    setSelectedChainId((current) => current || nextChainScopeId);
    if (latest !== null) {
      if (latest.stage === 'settlement') {
        setWriteBack(await fetchCreationWriteBack(bookId, latest.workflowId, signal).catch(() => null));
      } else setWriteBack(null);
    }
  }, [bookId, focus]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(publicError(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (selectedVolumeId.length === 0) {
      setVolumeTree(null);
      return;
    }
    const controller = new AbortController();
    void fetchPlanningTree(bookId, 'volume', selectedVolumeId, controller.signal)
      .then((tree) => setVolumeTree(tree.treeKind === 'volume' ? tree : null))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !(reason instanceof AuthorApiError && reason.status === 404)) setError(publicError(reason));
        if (!controller.signal.aborted) setVolumeTree(null);
      });
    return () => controller.abort();
  }, [bookId, focus, selectedVolumeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedVolumeId.length > 0) params.set('volumeId', selectedVolumeId);
    else params.delete('volumeId');
    if (selectedChainId.length > 0) params.set('chainId', selectedChainId);
    else params.delete('chainId');
    if (selectedChapterNumber !== null) params.set('chapter', String(selectedChapterNumber));
    else params.delete('chapter');
    const next = `?${params.toString()}`;
    if (next !== window.location.search) window.history.replaceState({}, '', next);
  }, [selectedChainId, selectedChapterNumber, selectedVolumeId]);

  useEffect(() => {
    if (focus !== 'chain' || selectedChainId.length === 0) {
      setChainTree(null);
      return;
    }
    const controller = new AbortController();
    void fetchPlanningTree(bookId, 'chain', selectedChainId, controller.signal)
      .then((tree) => setChainTree(tree.treeKind === 'chain' ? tree : null))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !(reason instanceof AuthorApiError && reason.status === 404)) setError(publicError(reason));
        if (!controller.signal.aborted) setChainTree(null);
      });
    return () => controller.abort();
  }, [bookId, focus, selectedChainId]);

  useEffect(() => {
    if (workflow === null) return;
    const pendingWriteBack = workflow.stage === 'settlement'
      && (writeBack === null || writeBack.completed + writeBack.failed + writeBack.unknown < writeBack.total);
    if (!['waiting', 'working'].includes(workflow.status) && workflow.execution.status !== 'active' && !pendingWriteBack) return;
    const timer = window.setInterval(() => {
      void fetchCreationWorkflow(bookId, workflow.workflowId).then((next) => {
        setWorkflow(next);
        if (next.stage === 'settlement') void fetchCreationWriteBack(bookId, next.workflowId).then(setWriteBack).catch(() => undefined);
      }).catch((reason: unknown) => setError(publicError(reason)));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [bookId, workflow, writeBack]);

  const volumeNodes = useMemo(() => bookTree?.root.children.filter((node) => node.linkedTree?.treeKind === 'volume') ?? [], [bookTree]);
  const selectedVolumeNode = useMemo(() => volumeNodes.find((node) => node.linkedTree?.scopeId === selectedVolumeId), [selectedVolumeId, volumeNodes]);
  const selectedVolumeRecord = useMemo(() => library.volumes.find((volume) => volume.volumeScopeId === selectedVolumeId), [library, selectedVolumeId]);
  const selectedChainRecord = useMemo(() => selectedVolumeRecord?.chains.find((chain) => chain.chainScopeId === selectedChainId), [selectedChainId, selectedVolumeRecord]);
  const selectedChainNode = useMemo(() => volumeTree?.root.children.find((node) => node.linkedTree?.scopeId === selectedChainId), [selectedChainId, volumeTree]);
  const chainTitles = useMemo(() => new Map((volumeTree?.root.children ?? []).flatMap((node) => node.linkedTree?.treeKind === 'chain'
    ? [[node.linkedTree.scopeId, node.title] as const]
    : [])), [volumeTree]);
  const chapterEntries = useMemo(() => creationChapterDirectory(library, workflow, selectedVolumeId), [library, selectedVolumeId, workflow]);
  const selectedChapter = chapterEntries.find((entry) => entry.chapter.chapterNumber === selectedChapterNumber) ?? null;

  useEffect(() => {
    if (focus !== 'chain' || volumeTree === null) return;
    const chainIds = volumeTree.root.children.flatMap((node) => node.linkedTree?.treeKind === 'chain' ? [node.linkedTree.scopeId] : []);
    if (chainIds.length === 0) return;
    setSelectedChainId((current) => chainIds.includes(current)
      ? current
      : workflow?.volumeScopeId === selectedVolumeId && workflow.chainScopeId !== null && chainIds.includes(workflow.chainScopeId)
        ? workflow.chainScopeId
        : chainIds[0]!);
  }, [focus, selectedVolumeId, volumeTree, workflow]);

  useEffect(() => {
    if (focus !== 'chapter' || chapterEntries.length === 0) return;
    setSelectedChapterNumber((current) => {
      if (current !== null && chapterEntries.some((entry) => entry.chapter.chapterNumber === current)) return current;
      const preferred = workflow?.manuscript?.chapterNumber ?? workflow?.progress.nextChapterNumber;
      if (preferred !== null && preferred !== undefined && chapterEntries.some((entry) => entry.chapter.chapterNumber === preferred)) return preferred;
      return [...chapterEntries].reverse().find((entry) => entry.manuscript !== null)?.chapter.chapterNumber
        ?? chapterEntries[0]!.chapter.chapterNumber;
    });
  }, [chapterEntries, focus, workflow]);

  useEffect(() => {
    if (focus !== 'chapter' || selectedChapterNumber === null) return;
    const entry = chapterEntries.find((item) => item.chapter.chapterNumber === selectedChapterNumber);
    if (entry !== undefined && entry.chainScopeId !== selectedChainId) setSelectedChainId(entry.chainScopeId);
  }, [chapterEntries, focus, selectedChainId, selectedChapterNumber]);

  useEffect(() => {
    const manuscriptVersionId = selectedChapter?.manuscript?.manuscriptVersionId;
    if (focus !== 'chapter' || manuscriptVersionId === undefined) {
      setSelectedManuscript(null);
      return;
    }
    if (workflow?.manuscript?.manuscriptVersionId === manuscriptVersionId) {
      setSelectedManuscript({
        ...workflow.manuscript,
        workflowId: workflow.workflowId,
        sequenceId: workflow.outline?.sequenceId ?? '',
        createdAt: '', finalizedAt: workflow.manuscript.status === 'final' ? '' : null
      });
      return;
    }
    const controller = new AbortController();
    setSelectedManuscript(null);
    void fetchCreationManuscript(bookId, manuscriptVersionId, controller.signal)
      .then(setSelectedManuscript)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(publicError(reason)); });
    return () => controller.abort();
  }, [bookId, focus, selectedChapter?.manuscript?.manuscriptVersionId, workflow]);

  const refresh = async (): Promise<void> => {
    await load();
  };

  const action = async (work: () => Promise<unknown>, after?: () => void): Promise<void> => {
    setBusy(true); setError(null);
    try { await work(); await refresh(); after?.(); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const retryInitialLoad = (): void => {
    setLoading(true);
    setError(null);
    void load().catch((reason: unknown) => setError(publicError(reason))).finally(() => setLoading(false));
  };

  if (loading) return <section className="creation-workspace"><div className="creation-loading"><CircleNotchIcon className="spin" /> 正在找回创作进度…</div></section>;
  if (bookTree === null && error !== null) return <section className="creation-workspace"><InitialLoadFailure message={error} onRetry={retryInitialLoad}/></section>;
  if (bookTree === null || bookTree.status !== 'confirmed') return <section className="creation-workspace"><EmptyDirection focus={focus} /></section>;

  const canStartVolume = workflow === null || (workflow.status === 'cancelled' && workflow.remainingChains.length === 0
    && !['manuscript', 'manuscript_confirmation', 'settlement'].includes(workflow.stage))
    || (workflow.status === 'failed' && workflow.stage === 'context_selection')
    || (workflow.status === 'completed' && workflow.remainingChains.length === 0);
  const canContinueChain = workflow !== null && (workflow.status === 'completed' || workflow.status === 'cancelled')
    && workflow.remainingChains.length > 0;
  const outlineStages = ['chapter_outlines', 'chapter_outline_confirmation'];
  const manuscriptStages = ['manuscript', 'manuscript_confirmation', 'settlement'];
  const selectedIsWorkflowVolume = workflow?.volumeScopeId === selectedVolumeId;
  const selectedIsWorkflowChain = selectedIsWorkflowVolume && workflow?.chainScopeId === selectedChainId;
  const currentChapterNumber = workflow?.manuscript?.chapterNumber ?? workflow?.progress.nextChapterNumber ?? null;
  const selectedIsCurrentChapter = selectedIsWorkflowChain
    && (selectedChapterNumber === null || selectedChapterNumber === currentChapterNumber);
  const canStartSelectedVolume = canStartVolume && selectedVolumeRecord?.status !== 'completed';

  return <section className={`creation-workspace focus-${focus}`} aria-label={focusLabel(focus)}>
    {error !== null && <div className="creation-error" role="alert">{error}</div>}
    {workflow !== null && <EditorialPresence workflow={workflow} members={members} writeBack={writeBack} busy={busy} onStop={() => {
      void action(() => cancelCreationWorkflow(bookId, workflow.workflowId));
    }} />}

    {focus === 'volume' && <section className="creation-layer-stack">
      <CreationLayerIdentity kind="volume" title="分卷规划"
        context={selectedVolumeNode?.title ?? '请选择分卷'}
        copy="这里只看本卷方向、阶段责任和粗单元链；详细事件与章纲留在链页。"/>
      <VolumeDirectory nodes={volumeNodes} library={library} selected={selectedVolumeId} onSelect={(scopeId) => {
        setSelectedVolumeId(scopeId); setSelectedChainId(''); setSelectedChapterNumber(null);
      }}/>
      {canStartSelectedVolume
      ? <VolumeStart
          nodes={volumeNodes} selected={selectedVolumeId} goal={goal} members={members} preferences={preferences}
          candidateCount={candidateCount} completed={workflow?.status === 'completed'} busy={busy}
          onSelect={setSelectedVolumeId} onGoal={setGoal} onCandidateCount={setCandidateCount}
          onPreference={(role, key) => setPreferences((current) => ({ ...current, [role]: key }))}
          onStart={() => action(async () => setWorkflow(await createCreationWorkflow(
            bookId,
            selectedVolumeId,
            goal,
            candidateCount,
            activePlanningPreferences(preferences, candidateCount)
          )))}
        />
      : !selectedIsWorkflowVolume && volumeTree !== null
        ? <ReadOnlyTree title="本卷方向与粗单元链" tree={volumeTree}
            content={<VolumePlanTree root={volumeTree.root}/>}
            footer={<LayerGate title="正在查看已保存的分卷" copy="切换上方卷目录，可以查看其他分卷或返回当前工作。"/>}/>
        : !selectedIsWorkflowVolume
          ? <LayerGate title="这一卷还没开始" copy="先完成当前分卷，再从卷目录进入下一卷。"/>
      : workflow !== null && selectedIsWorkflowVolume && ['volume_options', 'volume_decision'].includes(workflow.stage)
        ? <OptionChoice
            kind="volume" workflow={workflow} authorNote={authorNote} busy={busy} onNote={setAuthorNote}
            onChoose={(optionId) => action(() => chooseCreationOption(bookId, workflow.workflowId, 'volume', optionId, authorNote))}
            onRetry={() => action(async () => setWorkflow(await retryCreationOptions(bookId, workflow.workflowId)))}
          />
        : workflow !== null && selectedIsWorkflowVolume && (volumeTree !== null || workflow.stage === 'volume_tree_confirmation')
          ? <TreeConfirmation
            title="本卷方向与粗单元链" tree={volumeTree} busy={busy}
            content={volumeTree === null ? null : <VolumePlanTree root={volumeTree.root}/>}
            onConfirm={() => volumeTree === null ? undefined : action(() => confirmPlanningTree(bookId, 'volume', workflow.volumeScopeId, volumeTree.revision))}
            footer={volumeTree?.status === 'confirmed'
              ? workflow.stage === 'volume_tree_confirmation'
                ? <ChainEntry tree={volumeTree} members={members} busy={busy} onStart={(scopeId, count, selectedMembers) => action(
                    () => continueCreationToChain(bookId, workflow.workflowId, scopeId, count, selectedMembers),
                    () => onNavigate('chain')
                  )}/>
                : <LayerGate title="本卷详细骨架已确认" copy="卷页保留本卷骨架；全部单元事件和章纲在链页继续展开。" action="进入链页" onAction={() => onNavigate('chain')}/>
              : null}
          />
          : <LayerGate title="本卷骨架正在准备" copy="编辑部会先完成本卷方向，再把单元链交给您查看。" action="查看任务进度" onAction={() => onNavigate('volume')}/>
      }
    </section>}

    {focus === 'chain' && <section className="creation-layer-stack">
      <CreationLayerIdentity kind="chain" title="单元链"
        context={`${selectedVolumeNode?.title ?? '所选分卷'}${selectedChainNode === undefined ? '' : ` · ${selectedChainNode.title}`}`}
        copy="先从本卷全部单元链中选择一条，再查看事件节奏、因果、情绪、伏笔和章纲责任。"/>
      <VolumeDirectory nodes={volumeNodes} library={library} selected={selectedVolumeId} compact onSelect={(scopeId) => {
        setSelectedVolumeId(scopeId); setSelectedChainId(''); setSelectedChapterNumber(null);
      }}/>
      {volumeTree !== null && <VolumeChainOverview tree={volumeTree} workflow={workflow} libraryVolume={selectedVolumeRecord}
        selected={selectedChainId} onSelect={(scopeId) => { setSelectedChainId(scopeId); setSelectedChapterNumber(null); }}/>} 
      {selectedChainRecord?.outline !== null && selectedChainRecord !== undefined && !selectedIsWorkflowChain
        ? <HistoricalChain chain={selectedChainRecord} tree={chainTree} members={members} onOpenChapter={(chapterNumber) => {
          onNavigate('chapter', { chapter: chapterNumber });
        }}/>
        : workflow === null || !selectedIsWorkflowVolume || ['volume_options', 'volume_decision', 'volume_tree_confirmation'].includes(workflow.stage)
        ? <LayerGate title="先确认本卷详细骨架" copy="本卷确认后，这里会按顺序展开全部单元事件链。" action="返回卷页" onAction={() => onNavigate('volume')}/>
        : !selectedIsWorkflowChain && canContinueChain
          ? <ChainContinuation workflow={workflow} members={members} busy={busy} onContinue={(scopeId, count, selectedMembers) => action(async () => {
              const result = await continueCreationToNextChain(bookId, workflow.workflowId, scopeId, count, selectedMembers);
              if (result.workflow !== null) setWorkflow(result.workflow);
            })}/>
          : !selectedIsWorkflowChain
            ? <LayerGate title="请选择一条单元链" copy="从上方目录切换后，可以查看已经完成的内容或继续未完成的链。"/>
          : ['chain_options', 'chain_decision'].includes(workflow.stage)
            ? <OptionChoice
            kind="chain" workflow={workflow} authorNote={authorNote} busy={busy} onNote={setAuthorNote}
            onChoose={(optionId) => action(() => chooseCreationOption(bookId, workflow.workflowId, 'chain', optionId, authorNote))}
            onRetry={() => action(async () => setWorkflow(await retryCreationOptions(bookId, workflow.workflowId)))}
          />
            : workflow.stage === 'chain_tree_confirmation'
              ? <TreeConfirmation
            title="当前单元链" tree={chainTree} busy={busy}
            content={chainTree === null ? null : <ChainPlanTree root={chainTree.root}/>}
            onConfirm={() => chainTree === null || workflow.chainScopeId === null ? undefined : action(() => confirmPlanningTree(bookId, 'chain', workflow.chainScopeId!, chainTree.revision))}
            footer={chainTree?.status === 'confirmed' ? <OutlineStart members={members} busy={busy} onStart={(memberKeys, count, maximumChapters) => action(
              () => generateCreationOutlines(bookId, workflow.workflowId, {
                maximumChapters, candidateCount: count,
                ...(memberKeys.length === 0 ? {} : { memberKeys })
              })
            )} /> : null}
          />
              : outlineStages.includes(workflow.stage)
                ? <ChainOutlineDesk
            workflow={workflow} members={members} busy={busy}
            onConfirmOutline={(candidateId) => action(
              () => confirmCreationOutline(bookId, workflow.workflowId, candidateId),
              () => onNavigate('chapter')
            )}
            onRegenerateOutline={(candidateId, maximumChapters, memberKey) => action(() => generateCreationOutlines(bookId, workflow.workflowId, {
              maximumChapters, candidateCount: 1, replaceCandidateId: candidateId, regenerate: true,
              ...(memberKey === undefined ? {} : { memberKeys: [memberKey] })
            }))}
            onRetryMissingOutline={() => action(() => generateCreationOutlines(bookId, workflow.workflowId, {
              maximumChapters: workflow.outlines?.[0]?.content.chapters.length ?? workflow.outline?.content.chapters.length ?? 6,
              candidateCount: Math.max(1, Math.min(3, workflow.expectedOutlines ?? 1)) as 1 | 2 | 3
            }))}
          />
                : manuscriptStages.includes(workflow.stage)
                  ? <ConfirmedChainOutline workflow={workflow} tree={chainTree} members={members} onOpenChapter={() => onNavigate('chapter')}/>
                  : <WaitingCard workflow={workflow}/>
      }
    </section>}

    {focus === 'chapter' && <section className="creation-layer-stack">
      <CreationLayerIdentity kind="chapter" title="章节正文"
        context={`${selectedVolumeNode?.title ?? '所选分卷'}${selectedChainNode === undefined ? '' : ` · ${selectedChainNode.title}`}${selectedChapterNumber === null ? '' : ` · 第${selectedChapterNumber}章`}`}
        copy="这里完成详细章纲核对、正文创作、独立审查、定稿和写后资料更新。"/>
      <VolumeDirectory nodes={volumeNodes} library={library} selected={selectedVolumeId} compact onSelect={(scopeId) => {
        setSelectedVolumeId(scopeId); setSelectedChainId(''); setSelectedChapterNumber(null);
      }}/>
      <ChapterDirectory entries={chapterEntries} chainTitles={chainTitles} selected={selectedChapterNumber} onSelect={(entry) => {
        setSelectedVolumeId(selectedVolumeId || workflow?.volumeScopeId || '');
        setSelectedChainId(entry.chainScopeId);
        setSelectedChapterNumber(entry.chapter.chapterNumber);
      }}/>
      {selectedChapter !== null && !selectedIsCurrentChapter
        ? selectedChapter.manuscript !== null
          ? <ChapterReader chapter={selectedChapter.chapter} manuscript={selectedManuscript} members={members}/>
          : <ChapterOutlinePreview chapter={selectedChapter.chapter}/>
        : workflow !== null && manuscriptStages.includes(workflow.stage)
      ? <ChapterDesk
          workflow={workflow} members={members} busy={busy} writeBack={writeBack}
          onManaged={(writerMemberKey, reviewerMemberKey) => action(() => activateManagedCreation(bookId, workflow.workflowId, {
            ...(writerMemberKey === undefined ? {} : { writerMemberKey }),
            ...(reviewerMemberKey === undefined ? {} : { reviewerMemberKey })
          }))}
          onRetryWriteBack={() => action(() => activateManagedCreation(bookId, workflow.workflowId, {}))}
          onWrite={(writerMemberKey, reviewerMemberKey, resumeExistingDraft) => workflow.progress.nextChapterNumber === null ? undefined : action(() => generateCreationManuscript(bookId, workflow.workflowId, {
            chapterNumber: workflow.progress.nextChapterNumber!,
            ...(writerMemberKey === undefined ? {} : { writerMemberKey }),
            ...(reviewerMemberKey === undefined ? {} : { reviewerMemberKey }),
            ...(resumeExistingDraft === true ? { resumeExistingDraft: true } : {})
          }))}
          onFinalize={() => workflow.manuscript === null ? undefined : action(() => finalizeCreationManuscript(bookId, workflow.workflowId, workflow.manuscript!.manuscriptVersionId))}
        />
      : <LayerGate
          title={workflow !== null && outlineStages.includes(workflow.stage) ? '章纲还在链页确认' : '先把当前链展开成章纲'}
          copy="章页只负责正文创作；事件、因果和章纲会在链页确认后带到这里。"
          action="前往链页"
          onAction={() => onNavigate('chain')}
        />
      }
    </section>}
  </section>;
}

function CreationLayerIdentity({ kind, title, context, copy }: {
  kind: Focus;
  title: string;
  context: string;
  copy: string;
}): React.JSX.Element {
  const Icon = kind === 'chapter' ? FileTextIcon : GitBranchIcon;
  return <header className={`creation-layer-identity is-${kind}`}>
    <Icon aria-hidden="true"/>
    <span><small>{context}</small><strong>{title}</strong><p>{copy}</p></span>
  </header>;
}

function VolumeDirectory({ nodes, library, selected, compact = false, onSelect }: {
  nodes: PlanningTreeNodeView[];
  library: CreationLibraryView;
  selected: string;
  compact?: boolean;
  onSelect: (scopeId: string) => void;
}): React.JSX.Element {
  const status = (scopeId: string): string => {
    const record = library.volumes.find((volume) => volume.volumeScopeId === scopeId);
    if (record === undefined) return '未开始';
    return record.status === 'completed' ? '已完成'
      : record.status === 'failed' || record.status === 'partially_failed' ? '需处理'
        : record.status === 'cancelled' ? '已停止' : '进行中';
  };
  return <details className="creation-scope-directory" open={!compact}>
    <summary><span><strong>分卷目录</strong><small>{nodes.length}卷，点击即可切换查看</small></span><CaretDownIcon/></summary>
    <div>{nodes.map((node, index) => {
      const scopeId = node.linkedTree?.scopeId ?? '';
      return <button key={node.key} type="button" className={scopeId === selected ? 'selected' : ''}
        aria-pressed={scopeId === selected} onClick={() => onSelect(scopeId)}>
        <span>{String(index + 1).padStart(2, '0')}</span><b>{node.title}</b><small>{node.story.summary}</small><em>{status(scopeId)}</em>
      </button>;
    })}</div>
  </details>;
}

function ReadOnlyTree({ title, tree, content, footer }: {
  title: string;
  tree: PlanningTreeView;
  content: React.ReactNode;
  footer?: React.ReactNode;
}): React.JSX.Element {
  return <section className="creation-tree-panel"><div className="creation-compact-heading"><span><strong>{title}</strong><small>这里展示已经保存的内容，不会重新生成。</small></span><span className="creation-confirmed"><CheckCircleIcon/>已保存</span></div>{content}{footer}</section>;
}

function HistoricalChain({ chain, tree, members, onOpenChapter }: {
  chain: CreationLibraryChain;
  tree: PlanningTreeView | null;
  members: CreationMember[];
  onOpenChapter: (chapterNumber: number) => void;
}): React.JSX.Element {
  if (chain.outline === null) return <LayerGate title="这条链还没有章纲" copy="您可以切换其他单元链继续查看。"/>;
  const outline: OutlineCandidateView = {
    candidateId: chain.outline.sequenceId,
    seat: '方案一', status: chain.outline.status,
    memberKey: chain.outline.memberKey,
    reviewerMemberKey: chain.outline.reviewerMemberKey,
    review: chain.outline.review,
    content: chain.outline.content
  };
  return <section className="creation-layer-stack">
    {tree !== null && <ReadOnlyTree title="单元链事件节奏" tree={tree} content={<ChainPlanTree root={tree.root}/>}/>} 
    <section className="creation-outline-desk confirmed">
      <div className="creation-compact-heading"><span><strong>本链章纲</strong><small>已按章节展开，正文请到章页查看。</small></span><span className="creation-confirmed"><CheckCircleIcon/>已保存</span></div>
      <OutlineCandidateDetails outline={outline} members={members} nextChapterNumber={null} open/>
      <button className="creation-primary" type="button" onClick={() => onOpenChapter(outline.content.chapterStart)}><FileTextIcon/>查看本链正文</button>
    </section>
  </section>;
}

function ChapterDirectory({ entries, chainTitles, selected, onSelect }: {
  entries: ChapterDirectoryEntry[];
  chainTitles: ReadonlyMap<string, string>;
  selected: number | null;
  onSelect: (entry: ChapterDirectoryEntry) => void;
}): React.JSX.Element {
  const groups = [...new Set(entries.map((entry) => entry.chainScopeId))];
  if (entries.length === 0) return <section className="creation-scope-directory empty"><strong>章节目录</strong><small>当前单元链确认章纲后，章节会显示在这里。</small></section>;
  return <details className="creation-scope-directory chapter" open>
    <summary><span><strong>章节目录</strong><small>{entries.length}章，选择后在下方查看章纲或正文</small></span><CaretDownIcon/></summary>
    <div className="creation-chapter-groups">{groups.map((chainScopeId, chainIndex) => {
      const chapters = entries.filter((entry) => entry.chainScopeId === chainScopeId);
      return <details key={chainScopeId} open={chapters.some((entry) => entry.chapter.chapterNumber === selected)}>
        <summary><span>{chainTitles.get(chainScopeId) ?? `单元链 ${chainIndex + 1}`}</span><small>{chapters[0]?.chapter.chapterNumber}—{chapters.at(-1)?.chapter.chapterNumber}章</small><CaretDownIcon/></summary>
        <div>{chapters.map((entry) => <button key={entry.chapter.chapterNumber} type="button"
          className={entry.chapter.chapterNumber === selected ? 'selected' : ''}
          aria-pressed={entry.chapter.chapterNumber === selected} onClick={() => onSelect(entry)}>
          <span>{entry.chapter.chapterNumber}</span><b>{entry.chapter.title}</b><small>{entry.chapter.objective}</small>
          <em>{entry.manuscript?.status === 'final' ? '已定稿' : entry.manuscript !== null ? '待确认' : '仅章纲'}</em>
        </button>)}</div>
      </details>;
    })}</div>
  </details>;
}

function ChapterOutlinePreview({ chapter }: { chapter: CreationChapterOutline }): React.JSX.Element {
  return <section className="creation-manuscript outline-only"><header><span><strong>第{chapter.chapterNumber}章 · {chapter.title}</strong><small>这章已有章纲，正文尚未生成。</small></span><span className="review-mark">仅章纲</span></header><ChapterReferenceContent chapter={chapter}/></section>;
}

function ChapterReader({ chapter, manuscript, members }: {
  chapter: CreationChapterOutline;
  manuscript: CreationManuscriptView | null;
  members: CreationMember[];
}): React.JSX.Element {
  if (manuscript === null) return <section className="creation-waiting"><CircleNotchIcon className="spin"/><strong>正在打开第{chapter.chapterNumber}章正文…</strong></section>;
  const writer = findMemberByIdentity(members, manuscript.memberKey);
  const reviewer = manuscript.reviewerMemberKey === null ? undefined : findMemberByIdentity(members, manuscript.reviewerMemberKey);
  return <article className="creation-manuscript creation-chapter-reader">
    <header><span><strong>第{chapter.chapterNumber}章 · {chapter.title}</strong><small>{manuscript.review?.publicSummary ?? (manuscript.status === 'final' ? '本章已经定稿。' : '本章正文已经保存。')}</small><span className="creation-result-members">{writer !== undefined && <span><i className="creation-avatar small" style={{ backgroundPosition: memberAvatarPosition(writer.memberKey) }}/>{memberDisplayName(writer.memberKey, writer.name)} · {publicRoleLabel(writer.role, writer.roleKey)}</span>}{reviewer !== undefined && <span><i className="creation-avatar small" style={{ backgroundPosition: memberAvatarPosition(reviewer.memberKey) }}/>{memberDisplayName(reviewer.memberKey, reviewer.name)} · {publicRoleLabel(reviewer.role, reviewer.roleKey)}</span>}</span></span><span className={`review-mark ${manuscript.status === 'final' ? 'pass' : 'warn'}`}>{manuscript.status === 'final' ? '已定稿' : '已保存'}</span></header>
    <details open><summary>完整正文<CaretDownIcon/></summary><div className="manuscript-copy">{manuscript.content}</div></details>
    <details><summary>本章章纲<CaretDownIcon/></summary><ChapterReferenceContent chapter={chapter}/></details>
    {manuscript.review !== null && <ChapterReviewDetails review={manuscript.review}/>} 
  </article>;
}

function ChapterReferenceContent({ chapter }: { chapter: CreationChapterOutline }): React.JSX.Element {
  return <div className="creation-chapter-reference-copy">
    <p><b>本章任务：</b>{chapter.objective}</p>
    <p><b>开场钩子：</b>{chapter.openingHook}</p>
    <p><b>场景准备：</b>{chapter.sceneSetup}</p>
    <p><b>人物选择：</b>{chapter.protagonistChoice}</p>
    <p><b>主要阻力：</b>{chapter.opposition}</p>
    <p><b>关键变化：</b>{chapter.turn}</p>
    <p><b>情绪推进：</b>{chapter.emotionalMovement}</p>
    <p><b>本章回报：</b>{chapter.payoff}</p>
    <p><b>连续性责任：</b>{chapter.continuity}</p>
    <p><b>待回答问题：</b>{planningList(chapter.openQuestions, '当前没有遗留问题')}</p>
    <p><b>接下一章：</b>{chapter.nextChapterInterface}</p>
  </div>;
}

function ChapterReviewDetails({ review }: { review: CreationChapterReview }): React.JSX.Element {
  const issueCount = review.hardConflicts.length + review.continuityRisks.length + review.qualitySuggestions.length;
  return <details className="creation-review-details">
    <summary><span><b>完整审查</b><small>{issueCount === 0 ? '没有发现需要作者处理的问题' : `共${issueCount}项需要留意`}</small></span><CaretDownIcon/></summary>
    <div>
      {review.hardConflicts.length > 0 && <section><strong>必须处理</strong>{review.hardConflicts.map((issue, index) => <p key={`hard-${index}`}><b>{issue.evidence}</b><span>{issue.impact}</span><em>{issue.action}</em></p>)}</section>}
      {review.continuityRisks.length > 0 && <section><strong>连续性风险</strong>{review.continuityRisks.map((issue, index) => <p key={`continuity-${index}`}><b>{issue.evidence}</b><span>{issue.impact}</span><em>{issue.action}</em></p>)}</section>}
      {review.qualitySuggestions.length > 0 && <section><strong>文字与节奏建议</strong>{review.qualitySuggestions.map((issue, index) => <p key={`quality-${index}`}><b>{issue.evidence}</b><span>{issue.impact}</span><em>{issue.action}</em></p>)}</section>}
      {issueCount === 0 && <p className="creation-review-empty">{review.publicSummary}</p>}
    </div>
  </details>;
}

function ChainContinuation({ workflow, members, busy, onContinue }: {
  workflow: CreationWorkflowView;
  members: CreationMember[];
  busy: boolean;
  onContinue: (scopeId: string, candidateCount: 1 | 2 | 3, preferences: Record<string, string>) => void;
}): React.JSX.Element {
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const stopped = workflow.status === 'cancelled';
  return <section className="creation-start-panel">
    <div className="creation-compact-heading"><span><strong>{stopped ? '这项工作已经停止' : '这条单元链已经写完'}</strong><small>{stopped ? '已完成内容和失败记录都已保留，可以重新开始未完成的单元链。' : '本卷还有方向未完成，已写正文和结算都已安全保存。'}</small></span></div>
    <PlanningCandidatePicker candidateCount={candidateCount} members={members} preferences={preferences}
      onCount={setCandidateCount} onPreference={(seat, memberKey) => setPreferences((current) => ({ ...current, [seat]: memberKey }))}/>
    <section className="creation-next-list"><strong>接着写哪条链</strong>{workflow.remainingChains.map((chain) => <button key={chain.scopeId} type="button" disabled={busy} onClick={() => onContinue(chain.scopeId, candidateCount, activePlanningPreferences(preferences, candidateCount))}><span><b>{chain.title}</b><small>{chain.summary}</small></span><em>{busy ? '正在接单…' : '继续设计'}</em></button>)}</section>
  </section>;
}

function EmptyDirection({ focus }: { focus: Focus }): React.JSX.Element {
  return <section className="creation-empty"><GitBranchIcon /><h2>先在时光机确认全书方向</h2><p>确认后，编辑部才能按全书方向设计{focusLabel(focus)}，避免越写越偏。</p></section>;
}

function InitialLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return <section className="creation-load-failure" role="alert">
    <HandPalmIcon/>
    <span><strong>对不起，这页资料暂时没有加载完成</strong><small>{message}</small></span>
    <button type="button" onClick={onRetry}>重试加载</button>
  </section>;
}

function LayerGate({ title, copy, action, onAction }: { title: string; copy: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return <section className="creation-layer-gate"><GitBranchIcon/><span><strong>{title}</strong><small>{copy}</small></span>{action !== undefined && onAction !== undefined && <button type="button" onClick={onAction}>{action}</button>}</section>;
}

function VolumeChainOverview({ tree, workflow, libraryVolume, selected, onSelect }: {
  tree: PlanningTreeView;
  workflow: CreationWorkflowView | null;
  libraryVolume: CreationLibraryVolume | undefined;
  selected: string;
  onSelect: (scopeId: string) => void;
}): React.JSX.Element {
  const chains = tree.root.children.filter((node) => node.linkedTree?.treeKind === 'chain');
  const remaining = new Set(workflow?.remainingChains.map((chain) => chain.scopeId) ?? []);
  const stateCopy = (scopeId: string): string => libraryVolume?.chains.find((chain) => chain.chainScopeId === scopeId)?.status === 'completed'
    ? '已完成'
    : scopeId === workflow?.chainScopeId
    ? workflow.status === 'completed' ? '本链已完成' : ['waiting', 'working'].includes(workflow.status) ? '正在处理' : '当前单元链'
    : remaining.has(scopeId) ? '待展开' : '已规划';
  return <details className="creation-layer-overview" open>
    <summary><span><strong>本卷单元链</strong><small>{chains.length}条，点击切换详细内容</small></span><CaretDownIcon/></summary>
    <div className="creation-layer-directory">{chains.map((chain, index) => {
      const scopeId = chain.linkedTree?.scopeId ?? '';
      return <button type="button" key={chain.key} className={scopeId === selected ? 'current' : ''}
        aria-pressed={scopeId === selected} onClick={() => onSelect(scopeId)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{chain.title}</b><small>{chain.story.summary}</small></div><em>{stateCopy(scopeId)}</em></button>;
    })}</div>
  </details>;
}

function EditorialPresence({ workflow, members, writeBack, busy, onStop }: {
  workflow: CreationWorkflowView; members: CreationMember[]; writeBack: CreationWriteBack | null; busy: boolean; onStop: () => void;
}): React.JSX.Element {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const workflowFailed = workflow.status === 'failed' || workflow.status === 'partially_failed';
  const actors = uniqueByMemberKey(workflow.actors);
  const pendingWriteBack = workflow.stage === 'settlement' && writeBack !== null
    && writeBack.completed + writeBack.failed + writeBack.unknown < writeBack.total;
  const stoppedWriteBack = workflow.status === 'cancelled' && pendingWriteBack;
  const workflowActive = ['waiting', 'working'].includes(workflow.status) || pendingWriteBack;
  const writeBackActorKey = pendingWriteBack
    ? actors.find((actor) => ['settlement_editor', 'continuity_editor'].includes(actor.role))?.memberKey
    : undefined;
  const effectiveStatus = (actor: CreationWorkflowView['actors'][number]): CreationWorkflowView['actors'][number]['status'] =>
    pendingWriteBack && actor.memberKey === writeBackActorKey ? 'working'
      : !workflowActive && ['working', 'waiting'].includes(actor.status) ? 'completed' : actor.status;
  const active = workflowActive
    ? actors.find((actor) => effectiveStatus(actor) === 'working') ?? actors.find((actor) => effectiveStatus(actor) === 'waiting')
    : undefined;
  const canStop = ['waiting', 'working', 'failed'].includes(workflow.status);
  const timingCopy = stoppedWriteBack ? '已停止继续写作，正在完成已经开始的本章资料整理。' : workflow.timing === undefined ? null : !workflowActive
    ? `最近更新${relativeCopy(workflow.timing.idleSeconds)}`
    : workflow.timing.state === 'overdue'
    ? `已等待${durationCopy(workflow.timing.elapsedSeconds)}，本轮可能已经超时，您可以保留成果并停止。`
    : workflow.timing.state === 'slow'
      ? `已用时${durationCopy(workflow.timing.elapsedSeconds)}，成员仍在处理。`
      : `本轮已用时${durationCopy(workflow.timing.elapsedSeconds)} · 成员仍在处理`;
  const timingState = pendingWriteBack ? 'normal' : workflow.timing?.state ?? 'normal';
  const progress = workflow.progress.totalChapters > 0
    ? workflow.progress.percent
    : workflow.expectedOptions > 0 ? Math.round((workflow.completedOptions / workflow.expectedOptions) * 100) : 0;
  const actorCopy = (actor: CreationWorkflowView['actors'][number]): string => pendingWriteBack && actor.memberKey === writeBackActorKey
    ? stoppedWriteBack ? '我正在完成已经开始的本章资料整理，请稍等。' : '我正在更新本章实际变化，请稍等。'
    : effectiveStatus(actor) === 'failed'
    ? publicFailureCopy(actor.message)
    : publicStatusCopy(!workflowActive && ['working', 'waiting'].includes(actor.status) ? null : actor.message, effectiveStatus(actor) === 'working'
      ? '正在处理这项工作。'
      : effectiveStatus(actor) === 'waiting' ? '已经接单，正在排队。'
        : effectiveStatus(actor) === 'handed_over' ? '当前工作已交给下一位成员。' : '本轮工作已经完成。');
  return <section className="creation-editorial-strip" aria-live="polite">
    {active !== undefined && <div className="creation-chief-presence"><span className="creation-avatar large" style={{ backgroundPosition: memberAvatarPosition(active.memberKey) }} aria-hidden="true"/><span><strong>{memberDisplayName(active.memberKey, active.memberName)} · {publicRoleLabel(active.role)}</strong><small>{active.emoji} {actorCopy(active)}</small></span></div>}
    {active === undefined && <div className="creation-chief-presence"><span><strong>{pendingWriteBack ? '编辑部正在完成本章整理' : workflowFailed ? '这次没有完成' : workflow.status === 'waiting' ? '任务正在排队' : '编辑部当前空闲'}</strong><small>{pendingWriteBack ? stoppedWriteBack ? '已经停止继续写作，本章已开始的资料更新仍会安全完成。' : '正文已经安全定稿，正在更新后续创作资料。' : workflowFailed ? publicFailureCopy(workflow.message) : publicStatusCopy(workflow.message, workflow.status === 'waiting' ? '任务已经保存，正在等待成员接单。' : '当前没有成员在执行任务。')}</small></span></div>}
    <div className="creation-progress-line" aria-label={`已完成${Math.max(0, Math.min(100, progress))}%`}><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
    {timingCopy !== null && <small className={`creation-task-timing state-${timingState}`}>{timingCopy}</small>}
    {actors.length > 0 && <details><summary><span className="creation-avatar-row">{actors.slice(0, 6).map((actor) => <i key={actor.memberKey} className={`creation-avatar small state-${effectiveStatus(actor)}`} style={{ backgroundPosition: memberAvatarPosition(actor.memberKey) }} title={`${memberDisplayName(actor.memberKey, actor.memberName)}：${actorCopy(actor)}`} />)}</span><span>查看编辑部状态</span><CaretDownIcon /></summary><div className="creation-actor-list">{actors.map((actor) => <article key={actor.memberKey}><span className="creation-avatar" style={{ backgroundPosition: memberAvatarPosition(actor.memberKey) }}/><span><strong>{memberDisplayName(actor.memberKey, actor.memberName)} · {publicRoleLabel(actor.role)}</strong><small>{actor.emoji} {actorCopy(actor)}</small></span></article>)}</div></details>}
    {canStop && (confirmingStop
      ? <div className="creation-stop-confirm" role="group" aria-label="确认停止任务">
          <span>已完成的内容会保留。</span>
          <button type="button" disabled={busy} onClick={() => { setConfirmingStop(false); onStop(); }}>{busy ? '正在停止…' : '保留成果并停止'}</button>
          <button type="button" disabled={busy} onClick={() => setConfirmingStop(false)}>继续工作</button>
        </div>
      : <button className="creation-stop-button" type="button" disabled={busy} onClick={() => setConfirmingStop(true)}><HandPalmIcon />停止任务</button>)}
    {members.length === 0 && <span className="sr-only">成员名单正在加载</span>}
  </section>;
}

function durationCopy(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds)}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
}

function relativeCopy(seconds: number): string {
  return seconds < 10 ? '刚刚' : `${durationCopy(seconds)}前`;
}

function VolumeStart({ nodes, selected, goal, members, preferences, candidateCount, completed, busy, onSelect, onGoal, onCandidateCount, onPreference, onStart }: {
  nodes: PlanningTreeNodeView[]; selected: string; goal: string; members: CreationMember[]; preferences: Record<string, string>;
  candidateCount: 1 | 2 | 3; completed: boolean; busy: boolean; onSelect: (value: string) => void; onGoal: (value: string) => void;
  onCandidateCount: (value: 1 | 2 | 3) => void;
  onPreference: (selection: CreationMemberSelectionKey, memberKey: string) => void; onStart: () => void;
}): React.JSX.Element {
  return <section className="creation-start-panel">
    <div className="creation-compact-heading"><span><strong>{completed ? '继续设计下一卷' : '选择要开始的卷'}</strong><small>默认由一位强模型成员设计；需要比较时再增加方案。</small></span></div>
    <div className="creation-volume-list">{nodes.map((node) => <button key={node.key} type="button" aria-pressed={selected === node.linkedTree?.scopeId} onClick={() => onSelect(node.linkedTree?.scopeId ?? '')}><b>{node.title}</b><span>{node.story.summary}</span><small>{node.budget.wordTarget === null ? '篇幅由内容决定' : `${Math.round(node.budget.wordTarget / 10_000)}万字左右`}</small></button>)}</div>
    <PlanningCandidatePicker candidateCount={candidateCount} members={members} preferences={preferences}
      onCount={onCandidateCount} onPreference={onPreference}/>
    <label className="creation-author-note"><span>本卷还有特别想法（可不填）</span><textarea maxLength={2000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="例如：这一卷先写小人物求生，卷末获得第一支真正听命于他的队伍。" /></label>
    <button className="creation-primary" type="button" disabled={busy || selected.length === 0} onClick={onStart}><UsersThreeIcon />{busy ? '正在建立任务…' : '请编辑部设计本卷'}</button>
  </section>;
}

function OptionChoice({ kind, workflow, authorNote, busy, onNote, onChoose, onRetry }: {
  kind: 'volume' | 'chain'; workflow: CreationWorkflowView; authorNote: string; busy: boolean;
  onNote: (value: string) => void; onChoose: (optionId: string) => void; onRetry: () => void;
}): React.JSX.Element {
  if (workflow.options.length === 0 && workflow.status !== 'failed') return <WaitingCard workflow={workflow} />;
  const complete = workflow.options.length >= workflow.expectedOptions && ['volume_decision', 'chain_decision'].includes(workflow.stage);
  const missingOptions = Math.max(0, workflow.expectedOptions - workflow.options.length);
  return <section className="creation-option-panel">
    {workflow.chiefReview !== null && <article className="creation-chief-review"><span className="creation-avatar large" style={{ backgroundPosition: memberAvatarPosition(workflow.chiefReview.memberKey) }}/><span><strong>{memberDisplayName(workflow.chiefReview.memberKey, workflow.chiefReview.memberName)}主编的建议</strong><p>{workflow.chiefReview.summary}</p>{(workflow.chiefReview.risks.length > 0 || workflow.chiefReview.authorDecisions.length > 0) && <details><summary>查看主编提醒<CaretDownIcon /></summary>{workflow.chiefReview.risks.length > 0 && <div><b>需要留意</b><ul>{workflow.chiefReview.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}{workflow.chiefReview.authorDecisions.length > 0 && <div><b>采用后这样处理</b><ul>{workflow.chiefReview.authorDecisions.map((decision) => <li key={decision}>{decision}</li>)}</ul></div>}</details>}</span></article>}
    {!complete && <section className="creation-incomplete-options" role="status"><span><strong>{missingOptions > 0 ? `还差${missingOptions}套方案` : '方案已保留，正在整理结果'}</strong><small>{workflow.status === 'failed' ? publicFailureCopy(workflow.message) : publicStatusCopy(workflow.message, missingOptions > 0 ? '只会补齐未完成的方案。' : '已完成方案不会重新生成。')}</small></span><button className="creation-primary compact" type="button" disabled={busy} onClick={onRetry}>{busy ? '正在安排…' : missingOptions > 0 ? '只补失败方案' : '继续整理'}</button></section>}
    <div className="creation-option-grid">{workflow.options.map((option) => {
      const difference = workflow.chiefReview?.differences.find((item) => item.optionId === option.optionId)?.difference;
      return <article key={option.optionId} className={option.optionId === workflow.chiefReview?.recommendedOptionId ? 'recommended' : ''}>
        <header><span className="creation-avatar" style={{ backgroundPosition: memberAvatarPosition(option.memberKey) }}/><span><small>{memberDisplayName(option.memberKey, option.memberName)} · {option.seat}</small><h2>{option.name}</h2></span></header>
        <p>{option.summary}</p>
        <p className="creation-option-rationale"><b>这样设计：</b>{option.designRationale ?? option.summary}</p>
        {difference !== undefined && <p className="creation-option-difference"><b>主编一句话：</b>{difference}</p>}
        <dl><div><dt>核心冲突</dt><dd>{option.coreConflict}</dd></div><div><dt>主角怎么选</dt><dd>{option.protagonistChoice}</dd></div><div><dt>付出与变化</dt><dd>{option.priceAndChange}</dd></div><div><dt>读起来</dt><dd>{option.readerExperience}</dd></div><div><dt>阶段回报</dt><dd>{option.payoff}</dd></div></dl>
        <details className="creation-option-details"><summary>查看完整{kind === 'volume' ? '卷' : '链'}方案<CaretDownIcon /></summary><div className="creation-option-steps">{option.steps.map((step) => <article key={`${option.optionId}-${step.sequence}`}><span>{String(step.sequence).padStart(2, '0')}</span><div><strong>{step.title}</strong><p>{step.summary}</p>{step.majorEvents.length > 0 && <small>{step.majorEvents.join(' → ')}</small>}<p><b>人物变化：</b>{step.protagonistChange}</p><p><b>阅读感受：</b>{step.emotion}；{step.experience}</p><p><b>结果：</b>{step.outcome}</p><p><b>接下一步：</b>{step.nextStep}</p></div></article>)}</div></details>
        <details><summary>优点与风险<CaretDownIcon /></summary><p>{option.strengths.join('；')}</p>{option.risks.length > 0 && <p>注意：{option.risks.join('；')}</p>}</details>
        <button type="button" disabled={busy || !complete} onClick={() => onChoose(option.optionId)}>{option.optionId === workflow.chiefReview?.recommendedOptionId ? '采用主编推荐' : '采用这套方向'}</button>
      </article>;
    })}</div>
    {complete && <label className="creation-author-note"><span>带给下一层的补充意见（可不填）</span><textarea value={authorNote} maxLength={2000} onChange={(event) => onNote(event.target.value)} placeholder={`选定后交给后续${kind === 'volume' ? '单元链' : '章纲'}设计，不会改写已经确认的资料。`} /></label>}
  </section>;
}

function WaitingCard({ workflow }: { workflow: CreationWorkflowView }): React.JSX.Element {
  const copy = workflow.status === 'failed' ? publicFailureCopy(workflow.message) : publicStatusCopy(workflow.message, workflow.status === 'waiting' ? '任务已经接单，正在排队。' : '编辑部正在处理这项工作。');
  return <section className="creation-waiting"><CircleNotchIcon className="spin"/><strong>{copy}</strong><small>任务已经保存，离开页面也不会丢失。</small></section>;
}

function TreeConfirmation({ title, tree, content, busy, onConfirm, footer }: {
  title: string; tree: PlanningTreeView | null; content: React.ReactNode; busy: boolean; onConfirm: () => void; footer: React.ReactNode;
}): React.JSX.Element {
  if (tree === null) return <section className="creation-waiting"><CircleNotchIcon className="spin"/>正在找回{title}…</section>;
  return <section className="creation-tree-panel"><div className="creation-compact-heading"><span><strong>{title}</strong><small>{tree.status === 'candidate' ? '确认后才会进入下一步。' : '已确认，可以继续。'}</small></span>{tree.status === 'candidate' ? <button className="creation-primary compact" type="button" disabled={busy} onClick={onConfirm}>确认采用</button> : <span className="creation-confirmed"><CheckCircleIcon />已确认</span>}</div>{content}{footer}</section>;
}

function VolumePlanTree({ root }: { root: PlanningTreeNodeView }): React.JSX.Element {
  return <section className="creation-plan-view volume-plan" aria-label="本卷方向与粗单元链">
    <article className="creation-plan-root">
      <div><small>本卷方向</small><strong>{root.title}</strong><p>{root.story.summary}</p></div>
      <span>{planningBudgetCopy(root)}</span>
      <dl>
        <div><dt>本卷责任</dt><dd>{planningList(root.story.majorEvents, root.story.outcome)}</dd></div>
        <div><dt>主角阶段变化</dt><dd>{root.story.protagonistChange}</dd></div>
        <div><dt>卷末结果</dt><dd>{root.story.outcome}</dd></div>
        <div><dt>接下一卷</dt><dd>{root.story.nextStep}</dd></div>
      </dl>
      {root.actual !== null && <p className="creation-plan-actual"><b>正文实际：</b>{root.actual.summary}</p>}
    </article>
    <div className="creation-plan-branches" aria-label="粗单元链">
      {root.children.map((node, index) => <details key={node.key} open={index === 0}>
        <summary><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{node.title}</strong><small>{node.story.summary}</small></div><em>{planningBudgetCopy(node)}</em><CaretDownIcon/></summary>
        <div className="creation-plan-detail-grid">
          <p><b>这条链要发生什么</b>{planningList(node.story.majorEvents, node.story.summary)}</p>
          <p><b>因果入口</b>{node.causality.trigger} → {node.causality.coreConflict}</p>
          <p><b>主角有什么变化</b>{node.story.protagonistChange}</p>
          <p><b>读者会有什么感受</b>{node.emotion.publicSummary}；{node.experience.publicSummary}</p>
          <p><b>阶段结果与下一步</b>{node.story.outcome}；{node.story.nextStep}</p>
          <p><b>计划伏笔</b>{planningList(node.threads.foreshadowing, '当前没有单独安排')}</p>
          {node.actual !== null && <p className="creation-plan-actual"><b>正文实际</b>{node.actual.summary}</p>}
        </div>
      </details>)}
    </div>
  </section>;
}

function ChainPlanTree({ root }: { root: PlanningTreeNodeView }): React.JSX.Element {
  return <section className="creation-plan-view chain-plan" aria-label="单元链事件节奏">
    <article className="creation-plan-root">
      <div><small>当前单元链</small><strong>{root.title}</strong><p>{root.story.summary}</p></div>
      <span>{planningBudgetCopy(root)}</span>
      <dl>
        <div><dt>链内目标</dt><dd>{planningList(root.story.majorEvents, root.story.outcome)}</dd></div>
        <div><dt>核心冲突</dt><dd>{root.causality.coreConflict}</dd></div>
        <div><dt>整体情绪</dt><dd>{root.emotion.publicSummary}</dd></div>
        <div><dt>明确回报</dt><dd>{root.story.outcome}</dd></div>
      </dl>
      {root.actual !== null && <p className="creation-plan-actual"><b>正文实际：</b>{root.actual.summary}</p>}
    </article>
    <div className="creation-plan-branches" aria-label="链内事件">
      {root.children.map((node, index) => <details key={node.key} open={index === 0}>
        <summary><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{node.title}</strong><small>{node.story.summary}</small></div><em>{planningBudgetCopy(node)}</em><CaretDownIcon/></summary>
        <div className="creation-plan-detail-grid chain-event">
          <p><b>事件推进</b>{planningList(node.story.majorEvents, node.story.summary)}</p>
          <p><b>起因与阻力</b>{node.causality.trigger}；{planningList(node.causality.causes, node.causality.coreConflict)}</p>
          <p><b>关键转折</b>{node.causality.turningPoint}</p>
          <p><b>结果与影响</b>{node.story.outcome}；{planningList(node.causality.consequences, node.story.nextStep)}</p>
          <p><b>情绪变化</b>{node.emotion.openingEmotion} → {node.emotion.pressureMovement} → {node.emotion.releaseEmotion}</p>
          <p><b>阅读体验</b>{node.experience.publicSummary}；{node.experience.payoffCadence}</p>
          <p><b>伏笔</b>{planningList(node.threads.foreshadowing, '当前没有单独安排')}</p>
          <p><b>待回答问题</b>{planningList(node.threads.openQuestions, '当前没有遗留问题')}</p>
          {node.actual !== null && <p className="creation-plan-actual"><b>正文实际</b>{node.actual.summary}；{node.actual.outcome}</p>}
        </div>
      </details>)}
    </div>
  </section>;
}

function planningList(values: readonly string[] | string, fallback: string): string {
  // 早期已确认规划会把单项列表保存成字符串；只在展示边界兼容，不改写作者历史数据。
  const source = typeof values === 'string' ? [values] : values;
  const visible = source.filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim()).filter(Boolean);
  return visible.length === 0 ? fallback : visible.join('；');
}

function planningBudgetCopy(node: PlanningTreeNodeView): string {
  const chapterRange = node.budget.chapterRange;
  const chapters = chapterRange === null ? '章节待定' : `第${chapterRange[0]}—${chapterRange[1]}章`;
  const words = node.budget.wordTarget === null ? '字数待定' : `${Math.max(0, Math.round(node.budget.wordTarget / 10_000 * 10) / 10)}万字`;
  return `${chapters} · ${words}`;
}

function ChainEntry({ tree, members, busy, onStart }: {
  tree: PlanningTreeView;
  members: CreationMember[];
  busy: boolean;
  onStart: (scopeId: string, candidateCount: 1 | 2 | 3, preferences: Record<string, string>) => void;
}): React.JSX.Element {
  const chains = tree.root.children.filter((node) => node.linkedTree?.treeKind === 'chain');
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  return <section className="creation-chain-entry">
    <PlanningCandidatePicker candidateCount={candidateCount} members={members} preferences={preferences}
      onCount={setCandidateCount} onPreference={(seat, memberKey) => setPreferences((current) => ({ ...current, [seat]: memberKey }))}/>
    <section className="creation-next-list"><strong>选择先写哪条单元链</strong>{chains.map((chain) => <button key={chain.key} type="button" disabled={busy} onClick={() => onStart(chain.linkedTree!.scopeId, candidateCount, activePlanningPreferences(preferences, candidateCount))}><span><b>{chain.title}</b><small>{chain.story.summary}</small></span><em>开始设计</em></button>)}</section>
  </section>;
}

function PlanningCandidatePicker({ candidateCount, members, preferences, onCount, onPreference, showComparisonChief = true }: {
  candidateCount: 1 | 2 | 3;
  members: CreationMember[];
  preferences: Record<string, string>;
  onCount: (value: 1 | 2 | 3) => void;
  onPreference: (selection: CreationMemberSelectionKey, memberKey: string) => void;
  showComparisonChief?: boolean;
}): React.JSX.Element {
  return <details className="creation-inline-options">
    <summary>{candidateCount === 1 ? '需要多做几套对比？' : `本轮做${candidateCount}套方案`}<CaretDownIcon /></summary>
    <div className="creation-candidate-count" role="group" aria-label="方案数量">
      {([1, 2, 3] as const).map((count) => <button key={count} type="button" aria-pressed={candidateCount === count} onClick={() => onCount(count)}>{count}套</button>)}
    </div>
    <p>{candidateCount === 1 ? '默认一位强模型成员直接设计，最省时间和额度。' : showComparisonChief ? '每套由不同成员独立完成，完成两套以上后主编再给一份比较建议。' : '每套由不同成员独立完成，并分别接受主编检查。'}</p>
    <div className="creation-member-selects">
      {(['option_1', 'option_2', 'option_3'] as const).slice(0, candidateCount).map((seat, index) => <MemberSelect
        key={seat} role="planning_writer" label={`方案${['一', '二', '三'][index]}编剧`} autoAssign members={members}
        value={preferences[seat] ?? ''} onChange={(value) => onPreference(seat, value)}
      />)}
      {showComparisonChief && candidateCount > 1 && <MemberSelect role="chief_editor" label="比较主编" members={members}
        value={preferences.chief_editor ?? ''} onChange={(value) => onPreference('chief_editor', value)}/>} 
    </div>
  </details>;
}

function OutlineStart({ members, busy, onStart }: { members: CreationMember[]; busy: boolean; onStart: (memberKeys: string[], count: 1 | 2 | 3, maximumChapters: number) => void }): React.JSX.Element {
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [maximumChapters, setMaximumChapters] = useState(6);
  const memberKeys = (['option_1', 'option_2', 'option_3'] as const).slice(0, candidateCount)
    .map((seat) => preferences[seat]).filter((value): value is string => typeof value === 'string' && value.length > 0);
  return <section className="creation-outline-start"><strong>把这条链拆成章纲</strong><p>默认一位强模型成员完成；想比较时再加到两至三位。每份独立保存，不会互相覆盖。</p><PlanningCandidatePicker candidateCount={candidateCount} members={members} preferences={preferences} showComparisonChief={false} onCount={setCandidateCount} onPreference={(seat, memberKey) => setPreferences((current) => ({ ...current, [seat]: memberKey }))}/><label><span>最多几章</span><select value={maximumChapters} onChange={(event) => setMaximumChapters(Number(event.target.value))}>{[4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}章</option>)}</select></label><button className="creation-primary" type="button" disabled={busy} onClick={() => onStart(memberKeys, candidateCount, maximumChapters)}><SparkleIcon />{busy ? '正在拆分…' : `生成${candidateCount === 1 ? '章纲' : `${candidateCount}套章纲`}`}</button></section>;
}

function ChainOutlineDesk({ workflow, members, busy, onConfirmOutline, onRegenerateOutline, onRetryMissingOutline }: {
  workflow: CreationWorkflowView; members: CreationMember[]; busy: boolean;
  onConfirmOutline: (candidateId: string) => void;
  onRegenerateOutline: (candidateId: string, maximumChapters: number, member?: string) => void;
  onRetryMissingOutline: () => void;
}): React.JSX.Element {
  const [outlineWriter, setOutlineWriter] = useState('');
  if (workflow.stage === 'chapter_outlines') return <WaitingCard workflow={workflow}/>;
  const outlineCandidates = creationOutlineCandidates(workflow);
  const expectedOutlines = workflow.expectedOutlines ?? Math.max(1, outlineCandidates.length);
  return <section className="creation-outline-desk" aria-label="本链章纲">
    <div className="creation-compact-heading"><span><strong>本链章纲</strong><small>事件、因果和阅读节奏在这里落到各章；采用后再进入正文。</small></span></div>
    {outlineCandidates.map((outline) => <article className="creation-outline-candidate" key={outline.candidateId}>
      <OutlineCandidateDetails outline={outline} members={members} nextChapterNumber={workflow.progress.nextChapterNumber} open={outlineCandidates.length === 1}/>
      <div className="creation-outline-candidate-actions"><details><summary>换成员重做这一案<CaretDownIcon /></summary><MemberSelect role="planning_writer" label="章纲编剧" members={members} value={outlineWriter} onChange={setOutlineWriter}/><button type="button" disabled={busy} onClick={() => onRegenerateOutline(outline.candidateId, outline.content.chapters.length, outlineWriter || undefined)}>只重做这一案</button></details><button className="creation-primary" type="button" disabled={busy || outline.review?.passed !== true} onClick={() => onConfirmOutline(outline.candidateId)}>采用这份章纲</button></div>
    </article>)}
    {(outlineCandidates.length < expectedOutlines || outlineCandidates.some((outline) => outline.review === null))
      && <button className="creation-secondary" type="button" disabled={busy} onClick={onRetryMissingOutline}>只补未完成的章纲或点评</button>}
  </section>;
}

function ConfirmedChainOutline({ workflow, tree, members, onOpenChapter }: {
  workflow: CreationWorkflowView;
  tree: PlanningTreeView | null;
  members: CreationMember[];
  onOpenChapter: () => void;
}): React.JSX.Element {
  const outline = creationOutlineCandidates(workflow).find((candidate) => candidate.status === 'selected' || candidate.status === 'confirmed')
    ?? creationOutlineCandidates(workflow)[0];
  if (outline === undefined) return <LayerGate title="章纲还没有准备好" copy="先完成当前单元链的事件和章纲，再进入正文。"/>;
  return <section className="creation-layer-stack">
    {tree !== null && <ReadOnlyTree title="单元链事件节奏" tree={tree} content={<ChainPlanTree root={tree.root}/>}/>} 
    <section className="creation-outline-desk confirmed" aria-label="已确认章纲">
      <div className="creation-compact-heading"><span><strong>已确认章纲</strong><small>这份章纲属于链层；章页只负责写正文。</small></span><span className="creation-confirmed"><CheckCircleIcon/>已采用</span></div>
      <OutlineCandidateDetails outline={outline} members={members} nextChapterNumber={workflow.progress.nextChapterNumber}/>
      <button className="creation-primary" type="button" onClick={onOpenChapter}><FileTextIcon/>进入章页写正文</button>
    </section>
  </section>;
}

function OutlineCandidateDetails({ outline, members, nextChapterNumber, open = false }: {
  outline: OutlineCandidateView; members: CreationMember[]; nextChapterNumber: number | null; open?: boolean;
}): React.JSX.Element {
  const outlineMember = findMemberByIdentity(members, outline.memberKey);
  const outlineReviewer = outline.reviewerMemberKey === null ? undefined : findMemberByIdentity(members, outline.reviewerMemberKey);
  return <details className="creation-outline-list" open={open}><summary><span className="creation-outline-summary"><span className="creation-outline-member-row">{outlineMember !== undefined && <i className="creation-avatar small" style={{ backgroundPosition: memberAvatarPosition(outlineMember.memberKey) }}/>}<strong>{outline.seat}</strong></span><small>{outline.content.publicSummary}</small><small>{outline.review === null ? '主编点评尚未完成' : `${outlineReviewer === undefined ? '主编' : memberDisplayName(outlineReviewer.memberKey, outlineReviewer.name)}：${outline.review.publicSummary}`}</small></span><em>{outline.content.chapterStart}—{outline.content.chapterEnd}章</em><CaretDownIcon /></summary><div>{outline.content.chapters.map((chapter) => <article key={chapter.chapterNumber} className={chapter.chapterNumber === nextChapterNumber ? 'next' : ''}><span>{chapter.chapterNumber}</span><div><b>{chapter.title}</b><p>{chapter.objective}</p><small>{chapter.openingHook} → {chapter.payoff}</small></div></article>)}</div></details>;
}

function creationOutlineCandidates(workflow: CreationWorkflowView): OutlineCandidateView[] {
  return workflow.outlines ?? (workflow.outline === null ? [] : [{
    candidateId: workflow.outline.sequenceId, seat: '方案一', status: workflow.outline.status,
    memberKey: workflow.outline.memberKey, reviewerMemberKey: workflow.outline.reviewerMemberKey,
    review: workflow.outline.review, content: workflow.outline.content
  }]);
}

function ChapterDesk({ workflow, members, busy, writeBack, onManaged, onRetryWriteBack, onWrite, onFinalize }: {
  workflow: CreationWorkflowView; members: CreationMember[]; busy: boolean;
  writeBack: CreationWriteBack | null;
  onManaged: (writer?: string, reviewer?: string) => void;
  onRetryWriteBack: () => void;
  onWrite: (writer?: string, reviewer?: string, resumeExistingDraft?: boolean) => void; onFinalize: () => void;
}): React.JSX.Element {
  const [writer, setWriter] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [mode, setMode] = useState<'manual' | 'managed'>('managed');
  const remaining = Math.max(0, workflow.progress.totalChapters - workflow.progress.completedChapters);
  const managedWorking = workflow.status === 'working' && workflow.execution.mode === 'managed' && workflow.execution.status === 'active';
  const managedActor = uniqueByMemberKey(workflow.actors).find((actor) => actor.status === 'working');
  const managedMemberKey = managedActor?.memberKey ?? workflow.execution.writerMemberKey ?? undefined;
  const manuscriptMember = workflow.manuscript === null ? undefined : findMemberByIdentity(members, workflow.manuscript.memberKey);
  const reviewerMember = workflow.manuscript?.reviewerMemberKey === null || workflow.manuscript?.reviewerMemberKey === undefined
    ? undefined : findMemberByIdentity(members, workflow.manuscript.reviewerMemberKey);
  const pendingWriteBack = workflow.stage === 'settlement' && writeBack !== null
    && writeBack.completed + writeBack.failed + writeBack.unknown < writeBack.total;
  return <section className="creation-chapter-desk">
    <ChapterOutlineReference workflow={workflow}/>
    {managedWorking && <section className="creation-waiting managed"><CircleNotchIcon className="spin"/>{managedMemberKey !== undefined && <span className="creation-avatar large" style={{ backgroundPosition: memberAvatarPosition(managedMemberKey) }}/>}<strong>{publicStatusCopy(managedActor?.message ?? workflow.message, managedActor === undefined ? '托管任务正在等待成员接单。' : '正在创作并复核下一章。')}</strong><small>本链还剩{remaining}章。任务已经保存，离开页面也会继续；结果不明时会自动停住。</small></section>}
    {workflow.stage === 'manuscript' && !managedWorking && <section className="creation-write-start"><div><strong>下一章：第{workflow.progress.nextChapterNumber ?? '—'}章</strong><span>{workflow.progress.completedChapters}/{workflow.progress.totalChapters}章已定稿</span></div><label className="creation-execution-mode"><span>这条链怎么写</span><select value={mode} onChange={(event) => setMode(event.target.value as 'manual' | 'managed')}><option value="managed">托管写完本链</option><option value="manual">每章由我确认</option></select><small>{mode === 'managed' ? `剩余${remaining}章，预计最多进行${remaining * 2}次写作与复核；确认后会连续执行。` : '每写完一章都等您确认定稿。'}</small></label><details><summary>选择主笔与审校（可不选）<CaretDownIcon /></summary><div className="creation-member-selects"><MemberSelect role="lead_writer" members={members} value={writer} onChange={setWriter}/><MemberSelect role="independent_reviewer" autoAssign members={members} value={reviewer} onChange={setReviewer}/></div></details><button className="creation-primary" type="button" disabled={busy || workflow.progress.nextChapterNumber === null} onClick={() => mode === 'managed' ? onManaged(writer || undefined, reviewer || undefined) : onWrite(writer || undefined, reviewer || undefined)}><FileTextIcon />{busy ? '正在安排成员…' : mode === 'managed' ? '确认托管，写完本链' : '写这一章'}</button></section>}
    {workflow.stage === 'manuscript_confirmation' && workflow.manuscript !== null && !managedWorking && <article className="creation-manuscript">
      <header><span><strong>第{workflow.manuscript.chapterNumber}章正文</strong><small>{workflow.manuscript.review?.publicSummary}</small>{(manuscriptMember !== undefined || reviewerMember !== undefined) && <span className="creation-result-members">{manuscriptMember !== undefined && <span><i className="creation-avatar small" style={{ backgroundPosition: memberAvatarPosition(manuscriptMember.memberKey) }}/>{memberDisplayName(manuscriptMember.memberKey, manuscriptMember.name)} · {publicRoleLabel(manuscriptMember.role, manuscriptMember.roleKey)}</span>}{reviewerMember !== undefined && <span><i className="creation-avatar small" style={{ backgroundPosition: memberAvatarPosition(reviewerMember.memberKey) }}/>{memberDisplayName(reviewerMember.memberKey, reviewerMember.name)} · {publicRoleLabel(reviewerMember.role, reviewerMember.roleKey)}</span>}</span>}</span><span className={`review-mark ${workflow.manuscript.review?.passed ? 'pass' : 'warn'}`}>{workflow.manuscript.review?.passed ? '审校通过' : '需要处理'}</span></header>
      <details open><summary>查看完整正文<CaretDownIcon /></summary><div className="manuscript-copy">{workflow.manuscript.content}</div></details>
      {workflow.manuscript.review !== null && <ChapterReviewDetails review={workflow.manuscript.review}/>} 
      {workflow.manuscript.review === null && <section className="creation-incomplete-options" role="status"><span><strong>正文已经保留，只差独立审校</strong><small>继续时不会重新写正文，也不会重复计算主笔额度。</small></span><button className="creation-primary compact" type="button" disabled={busy} onClick={() => onWrite(undefined, reviewer || undefined, true)}>{busy ? '正在安排审校…' : '继续审校当前正文'}</button></section>}
      <details className="creation-rewrite"><summary>换成员重新写这一章<CaretDownIcon /></summary><div className="creation-member-selects"><MemberSelect role="lead_writer" members={members} value={writer} onChange={setWriter}/><MemberSelect role="independent_reviewer" autoAssign members={members} value={reviewer} onChange={setReviewer}/></div><button type="button" disabled={busy} onClick={() => onWrite(writer || undefined, reviewer || undefined)}>重新写并审校</button></details>
      <button className="creation-primary" type="button" disabled={busy || workflow.manuscript.review?.passed !== true} onClick={onFinalize}>确认定稿本章</button>
    </article>}
    {workflow.stage === 'settlement' && <section className="creation-writeback">{pendingWriteBack || !['failed', 'partially_failed', 'cancelled'].includes(workflow.status) ? <CircleNotchIcon className="spin"/> : null}<div><strong>{workflow.status === 'cancelled' ? pendingWriteBack ? '已停止续写，正在完成本章资料整理' : '正文已安全保存，更新已经暂停' : '正文已安全保存，正在更新故事进度'}</strong><p>{workflow.status === 'failed' || workflow.status === 'partially_failed' ? publicFailureCopy(workflow.message) : pendingWriteBack ? workflow.status === 'cancelled' ? '已经停止继续写作；本章已开始的资料更新完成后，才可以安全继续。' : '正在把本章变化更新到后续创作资料，完成后会自动继续。' : publicStatusCopy(workflow.message, workflow.status === 'cancelled' ? '已完成的正文仍然保留，继续后会从当前断点更新。' : '正在把本章变化更新到后续创作资料。')}</p></div><span>{writeBack?.completed ?? 0}/{writeBack?.total ?? 4}</span>{writeBack !== null && <details><summary>查看更新任务<CaretDownIcon /></summary>{writeBack.tasks.map((task) => <p key={task.taskId}><b>{task.task}</b> · {task.status === 'failed' ? publicFailureCopy(task.message) : publicStatusCopy(task.message, '正在处理。')}</p>)}</details>}{(workflow.status === 'failed' || workflow.status === 'partially_failed' || workflow.status === 'cancelled' || (writeBack?.failed ?? 0) > 0) && <button className="creation-primary compact" type="button" disabled={busy || pendingWriteBack} onClick={onRetryWriteBack}>{busy ? '正在继续…' : pendingWriteBack ? '正在完成本章整理…' : '继续更新并写下一章'}</button>}</section>}
  </section>;
}

function ChapterOutlineReference({ workflow }: { workflow: CreationWorkflowView }): React.JSX.Element | null {
  const outline = creationOutlineCandidates(workflow).find((candidate) => candidate.status === 'selected' || candidate.status === 'confirmed')
    ?? creationOutlineCandidates(workflow)[0];
  if (outline === undefined) return null;
  const chapterNumber = workflow.manuscript?.chapterNumber ?? workflow.progress.nextChapterNumber ?? outline.content.chapterEnd;
  const chapter = outline.content.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (chapter === undefined) return null;
  return <details className="creation-chapter-reference"><summary><span><b>第{chapter.chapterNumber}章章纲</b><small>{chapter.title} · {chapter.objective}</small></span><CaretDownIcon/></summary><ChapterReferenceContent chapter={chapter}/></details>;
}

function MemberSelect({ role, label, autoAssign = false, members, value, onChange }: { role: CreationRoleKey; label?: string; autoAssign?: boolean; members: CreationMember[]; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const choices = uniqueByMemberKey(members.filter((member) => member.roleKey === role));
  const selected = findMemberByIdentity(choices, value) ?? (autoAssign ? undefined : choices.find((member) => member.defaultForRole) ?? choices[0]);
  return <label className="creation-member-select"><span>{selected !== undefined && <i style={{ backgroundPosition: memberAvatarPosition(selected.memberKey) }} aria-hidden="true" />}<b>{label ?? publicRoleLabel(choices[0]?.role, choices[0]?.roleKey)}</b><small>{selected === undefined ? '自动安排不同成员' : value.length === 0 ? `默认由${memberDisplayName(selected.memberKey, selected.name)}优先接单` : `${memberDisplayName(selected.memberKey, selected.name)}负责本轮`}</small></span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">编辑部自动安排{autoAssign ? '（自动避重）' : ''}</option>{choices.map((member) => <option key={member.memberKey} value={member.memberKey}>{memberDisplayName(member.memberKey, member.name)}{member.defaultForRole && !autoAssign ? '（推荐）' : ''}</option>)}</select></label>;
}

function creationChapterDirectory(
  library: CreationLibraryView,
  workflow: CreationWorkflowView | null,
  volumeScopeId: string
): ChapterDirectoryEntry[] {
  const entries = new Map<number, ChapterDirectoryEntry>();
  const volume = library.volumes.find((item) => item.volumeScopeId === volumeScopeId);
  for (const chain of volume?.chains ?? []) {
    for (const entry of chain.outline?.chapters ?? []) {
      entries.set(entry.chapter.chapterNumber, { ...entry, chainScopeId: chain.chainScopeId });
    }
  }
  if (workflow?.volumeScopeId === volumeScopeId && workflow.chainScopeId !== null) {
    const outline = creationOutlineCandidates(workflow).find((candidate) => candidate.status === 'selected' || candidate.status === 'confirmed')
      ?? creationOutlineCandidates(workflow)[0];
    for (const chapter of outline?.content.chapters ?? []) {
      const current = entries.get(chapter.chapterNumber);
      const liveManuscript = workflow.manuscript?.chapterNumber === chapter.chapterNumber ? {
        manuscriptVersionId: workflow.manuscript.manuscriptVersionId,
        revision: workflow.manuscript.revision,
        status: workflow.manuscript.status,
        memberKey: workflow.manuscript.memberKey,
        reviewerMemberKey: workflow.manuscript.reviewerMemberKey,
        review: workflow.manuscript.review
      } : current?.manuscript ?? null;
      entries.set(chapter.chapterNumber, { chapter, manuscript: liveManuscript, chainScopeId: workflow.chainScopeId });
    }
  }
  return [...entries.values()].sort((left, right) => left.chapter.chapterNumber - right.chapter.chapterNumber);
}

function volumeScopeExists(tree: PlanningTreeView | null, scopeId: string): boolean {
  return scopeId.length > 0 && (tree?.root.children.some((node) => node.linkedTree?.treeKind === 'volume' && node.linkedTree.scopeId === scopeId) ?? false);
}

function creationScopeFromSearch(): { volumeScopeId: string; chainScopeId: string; chapterNumber: number | null } {
  const params = new URLSearchParams(window.location.search);
  const chapter = Number.parseInt(params.get('chapter') ?? '', 10);
  return {
    volumeScopeId: params.get('volumeId')?.trim() ?? '',
    chainScopeId: params.get('chainId')?.trim() ?? '',
    chapterNumber: Number.isInteger(chapter) && chapter > 0 ? chapter : null
  };
}

function focusLabel(focus: Focus): string { return focus === 'volume' ? '卷' : focus === 'chain' ? '链' : '章'; }
function activePlanningPreferences(preferences: Record<string, string>, candidateCount: 1 | 2 | 3): Record<string, string> {
  const allowed = new Set<string>(['option_1', ...(candidateCount >= 2 ? ['option_2', 'chief_editor'] : []), ...(candidateCount >= 3 ? ['option_3'] : [])]);
  return Object.fromEntries(Object.entries(preferences).filter(([key, value]) => allowed.has(key) && value.length > 0));
}
function findMemberByIdentity(members: CreationMember[], memberKey: string): CreationMember | undefined {
  const identityKey = canonicalMemberIdentityKey(memberKey);
  return uniqueByMemberKey(members).find((member) => canonicalMemberIdentityKey(member.memberKey) === identityKey);
}
function publicError(reason: unknown): string {
  if (reason instanceof AuthorApiError) return reason.message;
  return '对不起，这次操作没有完成，请稍后重试。';
}
