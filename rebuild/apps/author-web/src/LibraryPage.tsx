import { BookOpenTextIcon, CaretDownIcon, FileTextIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchCreationLibrary,
  fetchCreationManuscript,
  type CreationLibraryView,
  type CreationManuscriptView
} from './creation-api';

export function LibraryPage({ bookId }: { bookId: string }): React.JSX.Element {
  const [library, setLibrary] = useState<CreationLibraryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [openManuscriptId, setOpenManuscriptId] = useState<string | null>(null);
  const [manuscripts, setManuscripts] = useState<Record<string, CreationManuscriptView>>({});
  const [manuscriptError, setManuscriptError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLibrary(null);
    setError(null);
    void fetchCreationLibrary(bookId, controller.signal).then(setLibrary).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '抱歉，资料库暂时没有打开。');
    });
    return () => controller.abort();
  }, [bookId, retry]);

  const chapterCount = useMemo(() => library?.volumes.reduce((volumeTotal, volume) => volumeTotal +
    volume.chains.reduce((chainTotal, chain) => chainTotal + (chain.outline?.chapters.length ?? 0), 0), 0) ?? 0, [library]);
  const manuscriptCount = useMemo(() => library?.volumes.reduce((volumeTotal, volume) => volumeTotal +
    volume.chains.reduce((chainTotal, chain) => chainTotal + (chain.outline?.chapters.filter((entry) => entry.manuscript !== null).length ?? 0), 0), 0) ?? 0, [library]);

  const openManuscript = async (manuscriptVersionId: string): Promise<void> => {
    const retryingFailedManuscript = openManuscriptId === manuscriptVersionId
      && manuscriptError !== null
      && manuscripts[manuscriptVersionId] === undefined;
    if (openManuscriptId === manuscriptVersionId && !retryingFailedManuscript) {
      setOpenManuscriptId(null);
      return;
    }
    setOpenManuscriptId(manuscriptVersionId);
    setManuscriptError(null);
    if (manuscripts[manuscriptVersionId] !== undefined) return;
    try {
      const manuscript = await fetchCreationManuscript(bookId, manuscriptVersionId);
      setManuscripts((current) => ({ ...current, [manuscriptVersionId]: manuscript }));
    } catch (reason) {
      setManuscriptError(reason instanceof Error ? reason.message : '抱歉，这一章暂时没有打开。');
    }
  };

  if (error !== null) return <section className="library-page"><div className="library-error" role="alert"><strong>资料库暂时没有打开</strong><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重新打开</button></div></section>;
  if (library === null) return <section className="library-page" aria-busy="true"><div className="library-loading"><BookOpenTextIcon /><span>正在整理本书资料…</span></div></section>;

  return <section className="library-page" aria-labelledby="library-title">
    <header className="library-head"><div><p className="eyebrow">正式创作资料</p><h2 id="library-title">资料库</h2><p>按卷、链和章节查看已经生成的章纲与正文。</p></div><dl><div><dt>卷</dt><dd>{library.volumes.length}</dd></div><div><dt>章节</dt><dd>{chapterCount}</dd></div><div><dt>正文</dt><dd>{manuscriptCount}</dd></div></dl></header>
    {library.volumes.length === 0 ? <div className="library-empty"><BookOpenTextIcon /><strong>还没有正式创作资料</strong><span>确认卷、链和章后，这里会自动形成目录。</span></div> : <div className="library-volume-list">{library.volumes.map((volume, volumeIndex) => <details className="library-volume" key={volume.volumeScopeId} open={volumeIndex === 0}>
      <summary><span><b>第{volumeIndex + 1}卷</b><small>{volume.chains.length}条链</small></span><em>{workflowStatus(volume.status)}</em><CaretDownIcon /></summary>
      <div className="library-chain-list">{volume.chains.map((chain, chainIndex) => <details className="library-chain" key={chain.chainScopeId} open={volumeIndex === 0 && chainIndex === 0}>
        <summary><span><b>链 {chainIndex + 1}</b><small>{chain.outline?.content.publicSummary ?? '尚未形成章纲'}</small></span><em>{chain.outline?.chapters.length ?? 0}章</em><CaretDownIcon /></summary>
        {chain.outline === null ? <p className="library-chain-empty">这条链还没有确认章纲。</p> : <div className="library-chapter-list">{chain.outline.chapters.map((entry) => <article className="library-chapter" key={`${chain.chainScopeId}-${entry.chapter.chapterNumber}`}>
          <header><span>{entry.chapter.chapterNumber}</span><div><strong>{entry.chapter.title}</strong><p>{entry.chapter.objective}</p></div>{entry.manuscript === null ? <em>待写正文</em> : <button type="button" onClick={() => void openManuscript(entry.manuscript!.manuscriptVersionId)}>{openManuscriptId === entry.manuscript.manuscriptVersionId && manuscriptError !== null && manuscripts[entry.manuscript.manuscriptVersionId] === undefined ? '重新打开正文' : openManuscriptId === entry.manuscript.manuscriptVersionId ? '收起正文' : '查看正文'}</button>}</header>
          <details><summary>查看章纲要点</summary><dl><div><dt>开篇</dt><dd>{entry.chapter.openingHook}</dd></div><div><dt>推进</dt><dd>{entry.chapter.protagonistChoice}</dd></div><div><dt>阻力</dt><dd>{entry.chapter.opposition}</dd></div><div><dt>转折</dt><dd>{entry.chapter.turn}</dd></div><div><dt>回报</dt><dd>{entry.chapter.payoff}</dd></div></dl></details>
          {entry.manuscript !== null && openManuscriptId === entry.manuscript.manuscriptVersionId && <div className="library-manuscript">{manuscriptError !== null && manuscripts[entry.manuscript.manuscriptVersionId] === undefined ? <p role="alert">{manuscriptError}</p> : manuscripts[entry.manuscript.manuscriptVersionId] === undefined ? <p><FileTextIcon />正在打开正文…</p> : <><div className="library-manuscript-meta"><span>{manuscripts[entry.manuscript.manuscriptVersionId]!.status === 'final' ? '已定稿' : '创作稿'}</span><span>第 {manuscripts[entry.manuscript.manuscriptVersionId]!.revision} 版</span></div><div className="library-manuscript-content">{manuscripts[entry.manuscript.manuscriptVersionId]!.content}</div></>}</div>}
        </article>)}</div>}
      </details>)}</div>
    </details>)}</div>}
  </section>;
}

function workflowStatus(status: CreationLibraryView['volumes'][number]['status']): string {
  if (status === 'completed') return '已完成';
  if (status === 'working') return '创作中';
  if (status === 'waiting_for_you') return '等您确认';
  if (status === 'failed' || status === 'partially_failed') return '需要处理';
  if (status === 'cancelled') return '已停止';
  return '准备中';
}
