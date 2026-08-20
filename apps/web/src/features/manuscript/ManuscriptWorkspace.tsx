import { useCallback, useEffect, useRef, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { inspectAuthorStoryText, toAuthorFacingText } from '../../app/author-presentation';
import {
  BookOpenTextIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  FileTextIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  WifiHighIcon,
  WifiSlashIcon,
  XIcon
} from '@phosphor-icons/react';
import {
  analyzeContinuationImport,
  confirmContinuationImport,
  createManuscriptChapter,
  createManuscriptVolume,
  fetchChapterDetail,
  fetchContinuationImport,
  fetchLatestContinuationImport,
  fetchLatestChallengerReview,
  fetchVolumeChapters,
  finalizeChapter,
  previewContinuationImport,
  rewriteChapter,
  saveOwnerManuscript,
  startChallengerReview,
  withdrawOwnerManuscript,
  type ChallengerReviewData,
  type ChapterData,
  type ChapterPageData,
  type ContinuationImportData,
  type TaskData,
  type WorkspaceData
} from '../../lib/api/client';
import { StructuredContent, authorityLabel, isRecord } from '../shared/StructuredContent';
import { ImeInput } from '../shared/ImeSafeField';

export function ManuscriptWorkspace({ workspace, selectedChapterId, chapter, reader, detail, onSelectChapter, onChanged, onOpenPlanning }: {
  workspace: WorkspaceData | null;
  selectedChapterId: string | null;
  chapter: ChapterData | null;
  reader: { content: string; offline: boolean; manuscriptVersionId: string | null } | null;
  detail: Awaited<ReturnType<typeof fetchChapterDetail>> | null;
  onSelectChapter: (chapter: ChapterData) => void;
  onChanged: () => void;
  onOpenPlanning: () => void;
}): React.JSX.Element {
  const [latestImport, setLatestImport] = useState<ContinuationImportData | null>(null);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bookId = workspace?.book.bookId ?? null;
  useEffect(() => {
    setLatestImport(null);
    setBatchImportOpen(false);
    setNotice(null);
    if (bookId === null) return;
    const controller = new AbortController();
    void fetchLatestContinuationImport(bookId, controller.signal).then((value) => {
      setLatestImport(value);
      if (value !== null && ['parsed', 'importing', 'failed'].includes(value.status)) setBatchImportOpen(true);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [bookId]);
  if (workspace === null) return <div className="text-skeleton" aria-label="正在加载章节列表" />;
  const createNextChapter = async (): Promise<void> => {
    if (creatingChapter) return;
    setCreatingChapter(true);
    setNotice(null);
    try {
      const total = (workspace.volumes ?? []).reduce((sum, volume) => sum + volume.chapterCount, 0);
      const lastPage = total > 0
        ? await fetchVolumeChapters(workspace.book.bookId, 'all', { offset: Math.max(0, total - 1), limit: 1 })
        : { items: [], total: 0, offset: 0, limit: 1 };
      const existingLast = lastPage.items[0] ?? workspace.chapters.at(-1);
      const chapterNumber = (existingLast?.chapterNumber ?? 0) + 1;
      let volumeId = existingLast?.volumeId ?? workspace.volumes?.[0]?.volumeId;
      if (volumeId === undefined) {
        volumeId = (await createManuscriptVolume(workspace.book.bookId, { volumeNumber: 1, title: '正文' })).volumeId;
      }
      const created = await createManuscriptChapter(workspace.book.bookId, {
        volumeId,
        chapterNumber,
        title: `第${chapterNumber}章`
      });
      onSelectChapter(created);
      setNotice(`第${chapterNumber}章已加入目录。请在右侧粘贴原文或选择单章 TXT。`);
      onChanged();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '章节没有创建成功，请稍后重试。'));
    } finally {
      setCreatingChapter(false);
    }
  };
  return <section className="manuscript-workspace">
    <aside className="manuscript-workspace-sidebar"><ManuscriptChapterBrowser
      workspace={workspace}
      selectedChapterId={selectedChapterId}
      onSelect={onSelectChapter}
      onCreateChapter={() => void createNextChapter()}
      onOpenBatchImport={() => setBatchImportOpen(true)}
      creatingChapter={creatingChapter}
      batchImportActive={latestImport !== null && ['parsed', 'importing', 'failed'].includes(latestImport.status)}
    /></aside>
    <div className="manuscript-workspace-editor">
      {notice !== null && <p className="binding-status manuscript-workspace-notice" role="status">{notice}</p>}
      {batchImportOpen ? <ExistingManuscriptImportPanel
        bookId={workspace.book.bookId}
        initialImport={latestImport}
        onImportChanged={setLatestImport}
        onImported={onChanged}
        onOpenPlanning={onOpenPlanning}
        onClose={() => setBatchImportOpen(false)}
      /> : chapter === null
        ? <div className="manuscript-chapter-empty"><BookOpenTextIcon /><h2>{workspace.chapters.length === 0 ? '从第1章开始导入' : '选择一章正文'}</h2><p>{workspace.chapters.length === 0 ? '点击左侧章节列表中的“第1章”，再在右侧粘贴作者原文或选择单章 TXT。每章独立保存和处理，不需要一次导入整本。' : '从左侧章节目录选中一章，即可阅读、修改、点评或生成待确认的优化稿。'}</p></div>
        : <ManuscriptView bookId={workspace.book.bookId} chapter={chapter} reader={reader} detail={detail} onChanged={onChanged} />}
    </div>
  </section>;
}

function continuationAnalysisOf(value: ContinuationImportData): ContinuationImportData['analysis'] {
  return value.analysis ?? {
    status: 'not_started',
    analyzedChapterCount: 0,
    totalChapterCount: value.importedChapterCount,
    summary: null,
    structuredData: null,
    activeTaskId: null,
    errorMessage: null
  };
}

interface ContinuationChapterOutlineView {
  chapterNumber: number | null;
  title: string;
  chapterGoal: string;
  openingState: string;
  plotBeats: unknown[];
  cast: unknown[];
  centralConflict: string;
  emotionalArc: unknown[];
  payoffOrPressure: unknown[];
  threadActions: unknown[];
  descriptionFocus: unknown[];
  ending: Record<string, unknown>;
}

function continuationChapterOutlinesOf(analysis: ContinuationImportData['analysis']): ContinuationChapterOutlineView[] {
  const values = analysis.structuredData?.chapterOutlines;
  if (!Array.isArray(values)) return [];
  return values.filter(isRecord).map((value) => ({
    chapterNumber: typeof value.chapterNumber === 'number' ? value.chapterNumber : null,
    title: typeof value.title === 'string' ? value.title : '未命名章节',
    chapterGoal: typeof value.chapterGoal === 'string' ? value.chapterGoal : '',
    openingState: typeof value.openingState === 'string' ? value.openingState : '',
    plotBeats: Array.isArray(value.plotBeats) ? value.plotBeats : [],
    cast: Array.isArray(value.cast) ? value.cast : [],
    centralConflict: typeof value.centralConflict === 'string' ? value.centralConflict : '',
    emotionalArc: Array.isArray(value.emotionalArc) ? value.emotionalArc : [],
    payoffOrPressure: Array.isArray(value.payoffOrPressure) ? value.payoffOrPressure : [],
    threadActions: Array.isArray(value.threadActions) ? value.threadActions : [],
    descriptionFocus: Array.isArray(value.descriptionFocus) ? value.descriptionFocus : [],
    ending: isRecord(value.ending) ? value.ending : {}
  }));
}

function ExistingManuscriptImportPanel({ bookId, initialImport, onImportChanged, onImported, onOpenPlanning, onClose }: {
  bookId: string;
  initialImport: ContinuationImportData | null;
  onImportChanged: (value: ContinuationImportData) => void;
  onImported: () => void;
  onOpenPlanning: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [sourceName, setSourceName] = useState('粘贴的已有正文.txt');
  const [sourceText, setSourceText] = useState('');
  const [preview, setPreview] = useState<ContinuationImportData | null>(initialImport);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'preview' | 'confirm' | 'analyze' | 'handoff' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (initialImport === null) return;
    setPreview((current) => current === null || current.importId === initialImport.importId ? initialImport : current);
  }, [initialImport]);

  const updateChapter = (importChapterId: string, patch: { title?: string; included?: boolean }): void => {
    setPreview((current) => current === null ? null : {
      ...current,
      chapters: current.chapters.map((item) => item.importChapterId === importChapterId ? { ...item, ...patch } : item)
    });
    setConfirmed(false);
  };

  const readFile = async (file: File): Promise<void> => {
    if (busy !== null) return;
    setBusy('reading'); setNotice(null); setPreview(null); setConfirmed(false);
    try {
      if (!file.name.toLocaleLowerCase('zh-CN').endsWith('.txt') && file.type !== 'text/plain') {
        throw new Error('请选择 TXT 纯文本文件。');
      }
      if (file.size > 24 * 1024 * 1024) throw new Error('文件过大。已有正文最多支持约500万中文字符。');
      const text = await file.text();
      if (text.trim().length === 0) throw new Error('文件中没有可导入的正文。');
      setSourceName(file.name);
      setSourceText(text);
      setNotice(`已读取 ${file.name}，共 ${text.length.toLocaleString('zh-CN')} 个字符。请先检查，再识别章节。`);
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '读取文件失败。'));
    } finally {
      setBusy(null);
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    }
  };

  const createPreview = async (): Promise<void> => {
    if (busy !== null || sourceText.trim().length === 0) return;
    setBusy('preview'); setNotice(null); setConfirmed(false);
    try {
      const result = await previewContinuationImport(bookId, { sourceName, text: sourceText });
      setPreview(result);
      onImportChanged(result);
      setNotice(`已识别 ${result.chapters.length.toLocaleString('zh-CN')} 个章节。预览不会创建正文，也不会修改已经确认的内容。`);
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '章节识别没有完成。'));
    } finally {
      setBusy(null);
    }
  };

  const handoffToEditor = (result: ContinuationImportData): void => {
    setNotice(`已有正文和反向章纲已准备好（${result.importedChapterCount}章）。正在打开设定；你可在当前设定项直接让三名成员各自给方案。`);
    onOpenPlanning();
  };

  const confirmImport = async (): Promise<void> => {
    if (preview === null || busy !== null || !confirmed) return;
    const included = preview.chapters.filter((item) => item.included);
    if (included.length === 0) { setNotice('至少保留一个章节。'); return; }
    if (included.some((item) => item.title.trim().length === 0)) { setNotice('保留章节的标题不能为空。'); return; }
    setBusy('confirm'); setNotice('正在逐章保存你确认过的旧正文，并建立查询资料，请不要关闭页面。');
    try {
      const result = await confirmContinuationImport(bookId, preview.importId, preview.chapters.map((item) => ({
        importChapterId: item.importChapterId,
        title: item.title.trim(),
        included: item.included
      })));
      setPreview(result);
      onImportChanged(result);
      setNotice(`导入完成：${result.importedChapterCount.toLocaleString('zh-CN')} 章已成为正式前文，并且可以查到来源。`);
      onImported();
      const analysis = continuationAnalysisOf(result);
      if (analysis.status === 'ready') await handoffToEditor(result);
      else setNotice(`正文已安全保存。文姬正在逐章提炼设定、人物状态、事件和未回收线索（${analysis.analyzedChapterCount}/${analysis.totalChapterCount}），整理完成后再交给主编。`);
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '导入没有完成；已经保存的内容不会重复写入。'));
      try {
        const latest = await fetchContinuationImport(bookId, preview.importId);
        setPreview(latest);
        onImportChanged(latest);
      } catch {
        // 保留当前预览，作者仍可重新提交；服务端会按检查点幂等恢复。
      }
    } finally {
      setBusy(null);
    }
  };

  const refreshAnalysis = async (): Promise<void> => {
    if (preview === null || busy !== null) return;
    setBusy('analyze'); setNotice(null);
    try {
      const currentAnalysis = continuationAnalysisOf(preview);
      const result = currentAnalysis.status === 'failed' || currentAnalysis.status === 'not_started'
        ? await analyzeContinuationImport(bookId, preview.importId)
        : await fetchContinuationImport(bookId, preview.importId);
      const analysis = continuationAnalysisOf(result);
      setPreview(result);
      onImportChanged(result);
      if (analysis.status === 'ready') {
        setNotice('逐章整理已经完成。主编会以已有正文为准，只确认缺口、冲突和接下来的创作方向。');
      } else if (analysis.status === 'failed') {
        setNotice(`逐章整理未完成：${authorErrorFromUnknown(analysis.errorMessage, '可点击重试；已经导入的正文不会回滚或丢失。')}`);
      } else {
        setNotice(`文姬正在逐章整理（${analysis.analyzedChapterCount}/${analysis.totalChapterCount}）。正文已经保存，可以稍后再查看进度。`);
      }
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '没有取得最新整理进度。'));
    } finally {
      setBusy(null);
    }
  };

  const includedCount = preview?.chapters.filter((item) => item.included).length ?? 0;
  const analysis = preview === null ? null : continuationAnalysisOf(preview);
  const reverseOutlines = analysis === null ? [] : continuationChapterOutlinesOf(analysis);
  return <section className="continuation-import-shell">
    <div className="continuation-import-panel" id="continuation-import-panel">
      <header className="continuation-import-header">
        <div>
          <span className="eyebrow">按需使用</span>
          <h2>导入已有正文继续写</h2>
          <p>这个入口只用于已有整本旧稿。系统先识别章节供你核对；日常导入请关闭本页，直接在左侧选择单章。</p>
          <button className="text-button continuation-new-book-link" type="button" onClick={onOpenPlanning}>不导入旧稿，返回设定与规划</button>
        </div>
        <button className="icon-button continuation-collapse-button" type="button" aria-label="关闭整本导入" disabled={busy === 'confirm' || busy === 'handoff'} onClick={onClose}><XIcon /></button>
      </header>
      <div className="continuation-source-actions">
        <label className="continuation-source-name">资料名称<ImeInput value={sourceName} maxChars={240} onChange={setSourceName} disabled={busy !== null || preview !== null} /></label>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".txt,text/plain" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void readFile(file);
        }} />
        <button className="secondary-button" type="button" disabled={busy !== null || preview !== null} onClick={() => fileInputRef.current?.click()}>{busy === 'reading' ? '正在读取…' : '选择 TXT'}</button>
      </div>
      {preview === null ? <>
        <label className="continuation-source-text">已有正文
          <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} maxLength={5_000_000} disabled={busy !== null} placeholder={'粘贴正文，例如：\n\n第一章 雨夜归来\n正文……\n\n第二章 故人\n正文……'} />
        </label>
        <div className="continuation-import-footer"><span>{sourceText.length.toLocaleString('zh-CN')} / 5,000,000 字符</span><button className="primary-button" type="button" disabled={busy !== null || sourceText.trim().length === 0} onClick={() => void createPreview()}>{busy === 'preview' ? '正在识别…' : '识别章节并预览'}</button></div>
      </> : <>
        <div className="continuation-preview-summary">
          <div><strong>{preview.chapters.length.toLocaleString('zh-CN')}</strong><span>识别章节</span></div>
          <div><strong>{includedCount.toLocaleString('zh-CN')}</strong><span>准备导入</span></div>
          <div><strong>{preview.sourceCharacterCount.toLocaleString('zh-CN')}</strong><span>原文字符</span></div>
        </div>
        {preview.warnings.length > 0 && <div className="continuation-warnings"><strong>请留意</strong><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        <div className="continuation-preview-list" aria-label="章节识别预览">{preview.chapters.map((item) => <article className={item.included ? '' : 'excluded'} key={item.importChapterId}>
          <label className="continuation-include"><input type="checkbox" checked={item.included} disabled={busy !== null || preview.status !== 'parsed'} onChange={(event) => updateChapter(item.importChapterId, { included: event.target.checked })} /><span>纳入</span></label>
          <span className="continuation-ordinal">{item.ordinal}</span>
          <label className="continuation-title"><span className="visually-hidden">第{item.ordinal}项标题</span><ImeInput value={item.title} maxChars={120} disabled={busy !== null || preview.status !== 'parsed'} onChange={(next) => updateChapter(item.importChapterId, { title: next })} /></label>
          <small>{item.characterCount.toLocaleString('zh-CN')} 字符</small>
        </article>)}</div>
        {preview.status === 'failed' && <div className="continuation-warnings"><strong>上次导入没有完成</strong><p>{authorErrorFromUnknown(preview.errorMessage, '已完成部分已经保留，可以继续。')}</p></div>}
        {['parsed', 'failed', 'importing'].includes(preview.status) && <div className="continuation-confirm">
          <label><input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已检查章节拆分，确认把所选正文作为这本书已经发生的正式前文。</span></label>
          <div>{preview.status === 'parsed' && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => { setPreview(null); setConfirmed(false); setNotice(null); }}>返回修改原文</button>}<button className="primary-button" type="button" disabled={busy !== null || !confirmed || includedCount === 0} onClick={() => void confirmImport()}>{busy === 'confirm' ? '正在导入…' : preview.status === 'parsed' ? `确认导入 ${includedCount} 章` : '继续导入'}</button></div>
        </div>}
        {preview.status === 'ready' && analysis !== null && analysis.status !== 'ready' && <div className="continuation-ready"><ClockCountdownIcon /><div><strong>正文已保存，正在逐章整理</strong><span>{analysis.analyzedChapterCount.toLocaleString('zh-CN')} / {analysis.totalChapterCount.toLocaleString('zh-CN')} 章；整理失败也不会影响已导入正文。</span>{analysis.errorMessage !== null && <small>{authorErrorFromUnknown(analysis.errorMessage, '整理没有完成，可以重试。')}</small>}</div><button className="primary-button" type="button" disabled={busy !== null} onClick={() => void refreshAnalysis()}>{busy === 'analyze' ? '正在检查…' : analysis.status === 'failed' || analysis.status === 'not_started' ? '开始逐章整理' : '刷新整理进度'}</button></div>}
        {preview.status === 'ready' && analysis?.status === 'ready' && <div className="continuation-ready"><CheckCircleIcon /><div><strong>前文与反向章纲均已准备好</strong><span>共 {preview.importedChapterCount.toLocaleString('zh-CN')} 章。人物状态、剧情事件、规则、线索和逐章章纲已经整理；这些是可重建参考，原文仍是权威来源。</span>{analysis.summary !== null && analysis.summary.trim().length > 0 && <details className="continuation-analysis-summary"><summary>查看前文章节摘要</summary><p>{analysis.summary}</p></details>}{reverseOutlines.length > 0 && <details className="continuation-reverse-outlines"><summary>查看逐章反向章纲（{reverseOutlines.length}章）</summary><div>{reverseOutlines.map((outline) => <article key={`${outline.chapterNumber ?? 'unknown'}-${outline.title}`}><h4>{outline.chapterNumber === null ? '' : `第${outline.chapterNumber}章 `}{outline.title}</h4><dl><div><dt>本章目标</dt><dd>{outline.chapterGoal || '原文没有足够信息'}</dd></div><div><dt>开场状态</dt><dd>{outline.openingState || '原文没有足够信息'}</dd></div><div><dt>出场人物</dt><dd><StructuredContent value={outline.cast} /></dd></div><div><dt>剧情推进</dt><dd><StructuredContent value={outline.plotBeats} /></dd></div><div><dt>主要冲突</dt><dd>{outline.centralConflict || '原文没有明确冲突'}</dd></div><div><dt>情绪变化</dt><dd><StructuredContent value={outline.emotionalArc} /></dd></div><div><dt>爽点与压力</dt><dd><StructuredContent value={outline.payoffOrPressure} /></dd></div><div><dt>伏笔与钩子</dt><dd><StructuredContent value={outline.threadActions} /></dd></div><div><dt>描写重点</dt><dd><StructuredContent value={outline.descriptionFocus} /></dd></div><div><dt>章末承接</dt><dd><StructuredContent value={outline.ending} /></dd></div></dl></article>)}</div></details>}</div><button className="primary-button" type="button" disabled={busy !== null} onClick={() => handoffToEditor(preview)}>进入设定</button></div>}
      </>}
      {notice !== null && <p className="binding-status continuation-notice" role="status">{notice}</p>}
    </div>
  </section>;
}

function ManuscriptView({ bookId, chapter, reader, detail, onChanged }: {
  bookId: string;
  chapter: ChapterData;
  reader: { content: string; offline: boolean; manuscriptVersionId: string | null } | null;
  detail: Awaited<ReturnType<typeof fetchChapterDetail>> | null;
  onChanged: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [baselineContent, setBaselineContent] = useState('');
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [showUnsafeHistory, setShowUnsafeHistory] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('保留已确认事实和人物声音，重新组织本章正文。');
  const [busyAction, setBusyAction] = useState<'save' | 'rewrite' | 'review' | 'reading' | 'delete' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const singleChapterFileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setDraft(reader?.content ?? '');
    setBaselineContent(reader?.content ?? '');
    setBaseVersionId(reader?.manuscriptVersionId ?? chapter.currentManuscriptVersionId ?? chapter.canonManuscriptVersionId);
    setNotice(null);
    setRewriteOpen(false);
    setShowUnsafeHistory(false);
    setDeleteOpen(false);
  }, [chapter.chapterId, chapter.currentManuscriptVersionId, chapter.canonManuscriptVersionId, reader?.content, reader?.manuscriptVersionId]);
  const settled = chapter.settlementStatus === 'settled';
  const editable = !settled && reader !== null && !reader.offline;
  const hasVersion = baseVersionId !== null;
  const changed = reader !== null && draft !== baselineContent;
  const perform = async (kind: 'save' | 'rewrite' | 'review', instruction = rewriteInstruction.trim()): Promise<void> => {
    const actionVersionId = baseVersionId;
    if (busyAction !== null || (kind !== 'save' && actionVersionId === null)) return;
    setBusyAction(kind); setNotice(null);
    try {
      if (kind === 'save') {
        const result = await saveOwnerManuscript(bookId, chapter.chapterId, { baseManuscriptVersionId: baseVersionId, content: draft, note: '作者在正文工作台修改' });
        setBaseVersionId(result.manuscriptVersionId);
        setBaselineContent(draft);
        setNotice(result.unchanged ? '正文没有变化。' : '修改已保存为新的草稿，旧稿仍会保留，之后可以查看。');
      } else if (kind === 'rewrite') {
        if (actionVersionId === null) return;
        const result = await rewriteChapter(bookId, chapter.chapterId, actionVersionId, instruction);
        setRewriteOpen(false);
        setNotice('正在按你的要求优化，完成后会生成一份待确认稿，不会覆盖你的原文。');
      } else {
        if (actionVersionId === null) return;
        const result = await finalizeChapter(bookId, chapter.chapterId, actionVersionId);
        setNotice(result.confirmationId === undefined
          ? 'AI点评和定稿检查已经开始。完成后仍需你确认，才会成为正式正文。'
          : '本章点评已经完成，正在等待你决定是否定稿。');
      }
      onChanged();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '这次操作没有完成，请稍后重试。'));
    } finally {
      setBusyAction(null);
    }
  };
  const readSingleChapter = async (file: File): Promise<void> => {
    if (busyAction !== null || !editable) return;
    setBusyAction('reading');
    setNotice(null);
    try {
      if (!file.name.toLocaleLowerCase('zh-CN').endsWith('.txt') && file.type !== 'text/plain') throw new Error('请选择 TXT 纯文本文件。');
      if (file.size > 2 * 1024 * 1024) throw new Error('单章文件过大，请确认只选择了当前一章。');
      const text = await file.text();
      if (text.trim().length === 0) throw new Error('文件中没有正文。');
      if (text.length > 100_000) throw new Error('单章最多导入100,000个字符；整本旧稿请使用左侧批量识别入口。');
      setDraft(text);
      setNotice(`已把 ${file.name} 放入第${chapter.chapterNumber}章编辑区。请检查后点击保存，原文件不会被修改。`);
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '单章文件读取失败。'));
    } finally {
      setBusyAction(null);
      if (singleChapterFileRef.current !== null) singleChapterFileRef.current.value = '';
    }
  };
  const withdrawCurrentDraft = async (): Promise<void> => {
    if (busyAction !== null || !editable || baseVersionId === null || changed) return;
    setBusyAction('delete');
    setNotice(null);
    try {
      await withdrawOwnerManuscript(bookId, chapter.chapterId, baseVersionId);
      setDraft('');
      setBaselineContent('');
      setBaseVersionId(null);
      setDeleteOpen(false);
      setRewriteOpen(false);
      setNotice('当前正文已撤下；历史稿仍安全保留，之后仍可恢复。');
      onChanged();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '正文没有删除成功，请稍后重试。'));
    } finally {
      setBusyAction(null);
    }
  };
  const expressionInstruction = '只修改当前章里不清楚、不顺畅或重复的表达，并调整节奏、场景衔接和句式；保留作者原意、已经确认的事实、人物动机、人物说话方式和情绪力度。不要擅自新增剧情、设定或结论，交回完整修改稿。';
  const naturalInstruction = '把当前章润色得更自然，减少套话、空话、机械排比、重复解释、过分工整和雷同句式；保留作者原意、剧情事实、人物说话方式、节奏和情绪力度。不要为了所谓去AI味故意加入错别字、病句、低俗口语或假细节，交回完整修改稿。';
  const genericChapterTitle = `第${chapter.chapterNumber}章`;
  const normalizedChapterTitle = chapter.title.trim().replace(/\s+/gu, '');
  const displayChapterTitle = normalizedChapterTitle === genericChapterTitle
    ? genericChapterTitle
    : `${genericChapterTitle} · ${chapter.title.trim()}`;
  const storyPresentation = reader === null ? null : inspectAuthorStoryText(reader.content);
  return (
    <article className="manuscript-view">
      {!settled && <input ref={singleChapterFileRef} className="visually-hidden" type="file" accept=".txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void readSingleChapter(file); }} />}
      <header>
        <div className="manuscript-heading">
          <h2>{displayChapterTitle}</h2>
          <span>{settled ? <><CheckCircleIcon />已定稿</> : <><ClockCountdownIcon />{chapterStatus(chapter)}</>}</span>
        </div>
        {reader !== null && <div className="manuscript-header-tools">
          <span>{reader.offline ? <><WifiSlashIcon />离线保存，只能查看</> : settled ? <><WifiHighIcon />已定稿，只能查看</> : <><WifiHighIcon />草稿可直接粘贴修改</>}</span>
          {!settled && <button className="secondary-button" type="button" disabled={!editable || busyAction !== null} onClick={() => singleChapterFileRef.current?.click()}><FileTextIcon />{busyAction === 'reading' ? '正在读取…' : '导入本章 TXT'}</button>}
        </div>}
      </header>
      {reader === null ? <div className="text-skeleton" aria-label="正在加载正文" /> : <>
        {settled ? storyPresentation?.safeToPresent === true
          ? <div className="novel-text">{storyPresentation.content}</div>
          : <section className="manuscript-quality-warning" role="status">
              <p>{storyPresentation?.notice}</p>
              <button className="secondary-button" type="button" onClick={() => setShowUnsafeHistory((value) => !value)}>{showUnsafeHistory ? '收起历史原稿' : '查看历史原稿'}</button>
              {showUnsafeHistory && <div className="novel-text manuscript-history-raw">{storyPresentation?.content}</div>}
            </section>
          : <textarea className="manuscript-editor-textarea" aria-label={"\u6b63\u6587\u7f16\u8f91\u5668"} placeholder={`\u7c98\u8d34\u7b2c${chapter.chapterNumber}\u7ae0\u4f5c\u8005\u539f\u6587\u2026\u2026`} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} disabled={!editable || busyAction !== null} />}
        {!settled && <div className="manuscript-actions">
          <button className="secondary-button" type="button" disabled={!editable || !changed || draft.trim().length === 0 || busyAction !== null} onClick={() => void perform('save')}>{busyAction === 'save' ? '保存中…' : hasVersion ? '保存修改' : '保存原文'}</button>
          <button className="secondary-button" type="button" title={!hasVersion ? '先保存作者原文' : changed ? '请先保存当前修改' : '生成一份待确认的优化稿，不覆盖原文'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => void perform('rewrite', expressionInstruction)}><MagicWandIcon />优化表达</button>
          <button className="secondary-button" type="button" title={!hasVersion ? '先保存作者原文' : changed ? '请先保存当前修改' : '减少模板化AI腔，不故意制造错误'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => void perform('rewrite', naturalInstruction)}>自然化（去AI腔）</button>
          <button className="secondary-button" type="button" title={!hasVersion ? '先保存作者原文' : changed ? '请先保存当前修改' : '填写本章专属优化要求'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => setRewriteOpen((value) => !value)}>自定义优化</button>
          <button className="primary-button" type="button" title={!hasVersion ? '先保存作者原文' : changed ? '请先保存当前修改' : '交给三位不同模型点评；是否定稿仍由作者确认'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => void perform('review')}>{busyAction === 'review' ? '提交中…' : 'AI点评'}</button>
          <button className="danger-text-button" type="button" title={!hasVersion ? '本章还没有已保存正文' : changed ? '请先保存或撤销当前未保存修改' : '从当前章节撤下正文，历史稿仍保留'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => setDeleteOpen(true)}><TrashIcon />删除正文</button>
        </div>}
        {rewriteOpen && <div className="rewrite-panel"><label>想怎么改<textarea rows={3} value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value)} /></label><p>AI只会另写一份待确认稿，你的原文和以前的稿件都会保留。</p><div><button className="secondary-button" type="button" onClick={() => setRewriteOpen(false)}>取消</button><button className="primary-button" type="button" disabled={!rewriteInstruction.trim() || busyAction !== null} onClick={() => void perform('rewrite')}>{busyAction === 'rewrite' ? '已提交…' : '生成修改版'}</button></div></div>}
        {deleteOpen && <div className="rewrite-panel manuscript-delete-panel" role="alertdialog" aria-label="确认删除当前正文"><strong>删除当前正文？</strong><p>正文会从本章编辑区撤下，但历史稿仍会保留，之后还能查到。已经定稿的正式正文不能删除。</p><div><button className="secondary-button" type="button" disabled={busyAction !== null} onClick={() => setDeleteOpen(false)}>取消</button><button className="danger-button" type="button" disabled={busyAction !== null} onClick={() => void withdrawCurrentDraft()}>{busyAction === 'delete' ? '正在删除…' : '确认删除'}</button></div></div>}
        {!settled && <p className="manuscript-unsaved">{!hasVersion
          ? '先输入或导入当前章并保存作者原文，保存后才能点评或生成待确认的优化稿。'
          : changed
            ? '当前章有未保存修改。保存后才能点评或优化。'
            : '你的原文已经保存。AI修改会另存一份稿件，不会覆盖原文；你看过以后再决定是否定稿。'}</p>}
        {notice !== null && <p className="binding-status" role="status">{notice}</p>}
      </>}
      {detail !== null && <ChapterProductionEvidence detail={detail} bookId={bookId} chapterId={chapter.chapterId} />}
    </article>
  );
}

function ChapterProductionEvidence({ detail, bookId, chapterId }: { detail: Awaited<ReturnType<typeof fetchChapterDetail>>; bookId: string; chapterId: string }): React.JSX.Element {
  const order = detail.production.writingOrders[0];
  const reports = detail.production.reviewReports.map((row) => ({ row, report: parseRecordJson(row.report_json) })).filter((item) => item.report !== null) as Array<{ row: Record<string, unknown>; report: Record<string, unknown> }>;
  if (order === undefined && reports.length === 0) return <section className="production-evidence empty"><h3>本章写作记录</h3><p>本章还没有正式写作要求和三位模型的点评。</p><ChallengerReviewCard bookId={bookId} chapterId={chapterId} /></section>;
  return <section className="production-evidence"><header><h3>写作要求与AI点评</h3><p>三位模型点评的是同一份正文。AI腔检查会指出具体段落，不是在判断作者是不是AI；内容风险提示也不能代替法律或平台结论。</p></header>
    {order !== undefined && <article className="writing-order-card"><span>本章写作要求</span><strong>{String(order.objective ?? '本章要完成什么')}</strong><small>写作要求已确认</small></article>}
    <div className="review-evidence-grid">{reports.map(({ row, report }) => {
      const aiStyle = isRecord(report.aiStyle) ? report.aiStyle : null;
      const political = isRecord(report.politicalRisk) ? report.politicalRisk : null;
      const sexual = isRecord(report.sexualContentRisk) ? report.sexualContentRisk : null;
      return <article key={String(row.review_report_id)}><header><span>{reviewerRoleLabel(String(row.reviewer_role))}</span><em>{authorityLabel(String(row.status ?? 'completed'))}</em></header><h4>{String(report.summary ?? '已完成结构化点评')}</h4><dl><div><dt>结论</dt><dd>{reviewVerdictLabel(String(report.verdict ?? 'pass'))}</dd></div>{aiStyle !== null && <><div><dt>AI腔风险</dt><dd>{String(aiStyle.riskScore ?? 0)}/100</dd></div><div><dt>证据段落</dt><dd>{String(aiStyle.flaggedParagraphCount ?? 0)}/{String(aiStyle.totalParagraphCount ?? 0)}（{formatPercent(Number(aiStyle.flaggedParagraphRatio ?? 0))}）</dd></div></>}{political !== null && <div><dt>政治风险</dt><dd>{riskLevelLabel(String(political.level ?? 'none'))}</dd></div>}{sexual !== null && <div><dt>情色风险</dt><dd>{riskLevelLabel(String(sexual.level ?? 'none'))}</dd></div>}</dl>{Array.isArray(report.issues) && report.issues.length > 0 && <details><summary>查看定位问题 {report.issues.length}</summary><StructuredContent value={report.issues} /></details>}</article>;
    })}</div>
    <ChallengerReviewCard bookId={bookId} chapterId={chapterId} />
  </section>;
}

/** 挑剔读者妙玉的按需找茬卡（DEC-CURRENT-067）：不进入固定审校，结果只供参考，不影响定稿。 */
function ChallengerReviewCard({ bookId, chapterId }: { bookId: string; chapterId: string }): React.JSX.Element {
  const [review, setReview] = useState<ChallengerReviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setReview(null);
    setNotice(null);
    const controller = new AbortController();
    void fetchLatestChallengerReview(bookId, chapterId, controller.signal).then(setReview).catch(() => undefined);
    return () => controller.abort();
  }, [bookId, chapterId]);
  useEffect(() => {
    if (review === null || review.status !== 'working') return;
    const timer = window.setInterval(() => {
      void fetchLatestChallengerReview(bookId, chapterId).then(setReview).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [bookId, chapterId, review]);
  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      setReview(await startChallengerReview(bookId, chapterId));
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '找茬没有开始成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };
  const working = review?.status === 'working';
  const report = review?.status === 'succeeded' ? review.report : null;
  return <div className="challenger-review-card">
    <div className="challenger-review-actions">
      <button className="secondary-button" type="button" disabled={busy || working} onClick={() => void start()}>
        {working ? '挑剔读者正在找茬…' : report === null ? '请挑剔读者找茬' : '再让挑剔读者看一遍'}
      </button>
      <small>妙玉专挑毒点和弃读风险；她的意见只供参考，不影响定稿。</small>
    </div>
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
    {review?.status === 'failed' && <p className="binding-status" role="status">这次找茬中途失败了，可以再点一次重试。</p>}
    {report !== null && <article className="challenger-review-report">
      <header><span>挑剔读者 · 妙玉</span><em>{reviewVerdictLabel(report.verdict)}</em></header>
      <h4>{report.summary}</h4>
      {report.issues.length > 0 && <details><summary>查看吐槽点 {report.issues.length}</summary><StructuredContent value={report.issues} /></details>}
    </article>}
  </div>;
}

export function ManuscriptChapterBrowser({ workspace, selectedChapterId, onSelect, onCreateChapter, onOpenBatchImport, creatingChapter, batchImportActive }: {
  workspace: WorkspaceData;
  selectedChapterId: string | null;
  onSelect: (chapter: ChapterData) => void;
  onCreateChapter: () => void;
  onOpenBatchImport: () => void;
  creatingChapter: boolean;
  batchImportActive: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState<ChapterPageData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const totalChapters = (workspace.volumes ?? []).reduce((sum, volume) => sum + volume.chapterCount, 0) || workspace.chapters.length;
  const loadPage = useCallback((offset = 0, searchQuery = query, searchStatus = status) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    void fetchVolumeChapters(workspace.book.bookId, 'all', { offset, limit: 80, query: searchQuery, status: searchStatus, signal: controller.signal })
      .then(setPage)
      .catch(() => undefined)
      .finally(() => { if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); } });
  }, [query, status, workspace.book.bookId]);
  useEffect(() => {
    setPage(null);
    loadPage(0, query, status);
    return () => activeRequest.current?.abort();
  }, [workspace.book.bookId, totalChapters]);
  useEffect(() => {
    const timeout = window.setTimeout(() => loadPage(0), 250);
    return () => window.clearTimeout(timeout);
  }, [query, status]);
  const chapterButton = (chapter: ChapterData): React.JSX.Element => {
    const numberedPlaceholder = /^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*章$/u.test(chapter.title.trim());
    const label = numberedPlaceholder ? chapter.title.trim() : `${chapter.chapterNumber}. ${chapter.title}`;
    return <button className={selectedChapterId === chapter.chapterId ? 'chapter-button active' : 'chapter-button'} type="button" key={chapter.chapterId} onClick={() => onSelect(chapter)}>
      <span className={`chapter-state ${chapter.settlementStatus}`} aria-hidden="true" />
      <span><strong>{label}</strong><small>{chapterStatus(chapter, workspace.tasks)}</small></span>
    </button>;
  };
  const pager = page === null || page.total <= page.limit ? null : <div className="chapter-pager" aria-label="章节分页">
    <button type="button" disabled={page.offset === 0 || loading} onClick={() => loadPage(Math.max(0, page.offset - page.limit))}>上一页</button>
    <span>{page.offset + 1}-{Math.min(page.total, page.offset + page.items.length)} / {page.total}</span>
    <button type="button" disabled={page.offset + page.items.length >= page.total || loading} onClick={() => loadPage(page.offset + page.limit)}>下一页</button>
  </div>;
  return <section className="manuscript-chapter-browser" aria-label="正文章节列表">
    <div className="manuscript-chapter-browser-heading"><span>章节列表</span><small>{page?.total ?? totalChapters} 章</small></div>
    <div className="manuscript-browser-actions">
      {totalChapters > 0 && <button className="primary-button" type="button" disabled={creatingChapter} onClick={onCreateChapter}><PlusIcon />{creatingChapter ? '正在添加…' : '新增下一章'}</button>}
      <button className="secondary-button" type="button" onClick={onOpenBatchImport}><FileTextIcon />{batchImportActive ? '继续整本导入' : '批量识别整本TXT'}</button>
    </div>
    {totalChapters > 20 && <div className="chapter-filter"><label className="chapter-search"><MagnifyingGlassIcon /><span className="sr-only">搜索章节、人物或状态</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="章节、人物或标题" /></label><select aria-label="按章节状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="planned">已规划</option><option value="working">写作中</option><option value="review">待点评</option><option value="settled">已定稿</option><option value="blocked">遇到问题</option></select></div>}
    <div className="chapter-search-results">
      {loading && page === null && <p className="rail-empty">正在加载章节</p>}
      {page?.items.map(chapterButton)}
      {page !== null && page.items.length === 0 && totalChapters > 0 && <p className="rail-empty">没有符合条件的章节。</p>}
      {totalChapters === 0 && <button className="chapter-button chapter-button-placeholder" type="button" disabled={creatingChapter} onClick={onCreateChapter}><span className="chapter-state planned" aria-hidden="true" /><span><strong>{creatingChapter ? '正在添加第1章…' : '第1章'}</strong><small>等待导入作者原文</small></span></button>}
      {pager}
    </div>
  </section>;
}

function chapterStatus(chapter: ChapterData, tasks: TaskData[] = []): string {
  // 正史结算是章节的最终业务状态。历史失败/阻断任务仍会保留作审计，
  // 但不能反向把已经结算的章节显示成“受阻”。
  if (chapter.settlementStatus === 'settled') return '正式正文';
  const task = tasks.find((item) => item.chapterId === chapter.chapterId && isActiveTask(item.status));
  if (task?.status === 'waiting_confirmation') return '待老板确认';
  if (task?.status === 'blocked' || task?.status === 'failed') return '受阻';
  if (task?.currentPhase === 'review' || task?.currentPhase === 'hard_check' || task?.currentPhase === 'rewrite') return '待点评或修订';
  if (chapter.generationStatus === 'working') return '创作中';
  if (chapter.generationStatus === 'paused') return '已暂停';
  if (chapter.generationStatus === 'failed') return '需要处理';
  if (chapter.generationStatus === 'completed') return '待老板确认';
  if (chapter.planStatus === 'candidate') return '章纲待确认';
  return '已规划';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '未知';
}

function parseRecordJson(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try { const parsed = JSON.parse(value) as unknown; return isRecord(parsed) ? parsed : null; } catch { return null; }
}

function reviewerRoleLabel(value: string): string {
  return ({ fact: '事实与连续性席', literary: '文学与AI腔席', experience: '体验与内容风险席', challenger: '挑剔读者席' } as Record<string, string>)[value] ?? value;
}

function reviewVerdictLabel(value: string): string {
  return ({ pass: '通过', rewrite: '需要定点修订', blocked: '阻断并等待处理' } as Record<string, string>)[value] ?? value;
}

function riskLevelLabel(value: string): string {
  return ({ none: '未发现', low: '低', medium: '中', high: '高', blocked: '阻断' } as Record<string, string>)[value] ?? value;
}


function isActiveTask(status: string): boolean {
  return ['pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted'].includes(status);
}
