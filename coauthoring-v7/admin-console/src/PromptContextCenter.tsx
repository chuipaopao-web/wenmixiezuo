import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, CheckCircle, ClockCounterClockwise, FloppyDisk, WarningCircle } from '@phosphor-icons/react';
import {
  fetchV7PromptAssets,
  fetchV7PromptAssetVersions,
  fetchV7PromptContextSummary,
  fetchV7PromptManifest,
  fetchV7PromptManifests,
  previewV7PromptAssetVersion,
  publishV7PromptAssetVersion,
  restoreV7PromptAssetDraft,
  saveV7PromptAssetDraft,
  verifyV7PromptManifestRebuild,
  type V7PromptAssetKind,
  type V7PromptAssetPreview,
  type V7PromptAssetStatus,
  type V7PromptAssetSummary,
  type V7PromptAssetVersion,
  type V7PromptContextSummary,
  type V7PromptManifestDetail,
  type V7PromptManifestRebuildVerification,
  type V7PromptManifestSummary
} from './platform-api';

type CenterTab = 'sources' | 'traces';
type BusyState = 'loading' | 'saving' | 'previewing' | 'publishing' | 'restoring' | null;

const KIND_LABELS: Record<V7PromptAssetKind, string> = {
  role_prompt: '固定岗位提示词',
  workstation_prompt: '阶段工位提示词',
  genre_persona: '题材人设',
  skill: 'Skill执行流程'
};

const STATUS_LABELS: Record<V7PromptAssetStatus, string> = {
  draft: '草稿',
  published: '已发布',
  retired: '历史版本'
};

export function PromptContextCenter(): React.JSX.Element {
  const [tab, setTab] = useState<CenterTab>('sources');
  const [summary, setSummary] = useState<V7PromptContextSummary | null>(null);
  const [assets, setAssets] = useState<V7PromptAssetSummary[]>([]);
  const [manifests, setManifests] = useState<V7PromptManifestSummary[]>([]);
  const [kind, setKind] = useState<'all' | V7PromptAssetKind>('all');
  const [manifestState, setManifestState] = useState('all');
  const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null);
  const [assetVersions, setAssetVersions] = useState<V7PromptAssetVersion[] | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [assetSummary, setAssetSummary] = useState('');
  const [contentText, setContentText] = useState('{}');
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<V7PromptAssetPreview | null>(null);
  const [selectedManifestId, setSelectedManifestId] = useState<string | null>(null);
  const [manifestDetail, setManifestDetail] = useState<V7PromptManifestDetail | null>(null);
  const [busy, setBusy] = useState<BusyState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setBusy('loading');
    setError(null);
    try {
      const [nextSummary, assetList, manifestList] = await Promise.all([
        fetchV7PromptContextSummary(signal),
        fetchV7PromptAssets({}, signal),
        fetchV7PromptManifests({ limit: 100 }, signal)
      ]);
      setSummary(nextSummary);
      setAssets(assetList);
      setManifests(manifestList);
      setSelectedAssetKey((current) => current ?? assetList[0]?.assetKey ?? null);
      setSelectedManifestId((current) => current ?? manifestList[0]?.manifestId ?? null);
    } catch (reason) {
      if (!signal?.aborted) setError(readError(reason, '提示词与上下文暂时无法读取。'));
    } finally {
      if (!signal?.aborted) setBusy(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  useEffect(() => {
    if (selectedAssetKey === null) { setAssetVersions(null); return; }
    const controller = new AbortController();
    setError(null);
    void fetchV7PromptAssetVersions(selectedAssetKey, controller.signal).then((next) => {
      setAssetVersions(next);
      const selected = preferredVersion(next);
      if (selected !== undefined) selectVersion(selected);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(readError(reason, '配置版本暂时无法读取。'));
    });
    return () => controller.abort();
  }, [selectedAssetKey]);

  useEffect(() => {
    if (tab !== 'traces' || selectedManifestId === null) { setManifestDetail(null); return; }
    const controller = new AbortController();
    setError(null);
    void fetchV7PromptManifest(selectedManifestId, controller.signal).then(setManifestDetail).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(readError(reason, '运行详情暂时无法读取。'));
    });
    return () => controller.abort();
  }, [selectedManifestId, tab]);

  const filteredAssets = useMemo(() => assets.filter((item) => kind === 'all' || item.kind === kind), [assets, kind]);
  const filteredManifests = useMemo(
    () => manifests.filter((item) => manifestState === 'all' || item.execution.state === manifestState),
    [manifests, manifestState]
  );
  const selectedAsset = filteredAssets.find((item) => item.assetKey === selectedAssetKey);
  const selectedVersion = assetVersions?.find((item) => item.assetId === selectedVersionId);
  const manifestStates = useMemo(() => [...new Set(manifests.map((item) => item.execution.state))], [manifests]);

  useEffect(() => {
    if (selectedAssetKey !== null && filteredAssets.some((item) => item.assetKey === selectedAssetKey)) return;
    setSelectedAssetKey(filteredAssets[0]?.assetKey ?? null);
    setAssetVersions(null);
    setSelectedVersionId(null);
    setPreview(null);
  }, [filteredAssets, selectedAssetKey]);

  useEffect(() => {
    if (selectedManifestId !== null && filteredManifests.some((item) => item.manifestId === selectedManifestId)) return;
    setSelectedManifestId(filteredManifests[0]?.manifestId ?? null);
    setManifestDetail(null);
  }, [filteredManifests, selectedManifestId]);

  function selectKind(nextKind: 'all' | V7PromptAssetKind): void {
    if (dirty) {
      setError('当前修改还没有保存，请先保存草稿，再切换配置类型。');
      return;
    }
    const firstVisible = assets.find((item) => nextKind === 'all' || item.kind === nextKind);
    setKind(nextKind);
    setSelectedAssetKey(firstVisible?.assetKey ?? null);
    setAssetVersions(null);
    setSelectedVersionId(null);
    setPreview(null);
  }

  function selectManifestState(nextState: string): void {
    const firstVisible = manifests.find((item) => nextState === 'all' || item.execution.state === nextState);
    setManifestState(nextState);
    setSelectedManifestId(firstVisible?.manifestId ?? null);
    setManifestDetail(null);
  }

  function selectVersion(version: V7PromptAssetVersion): void {
    setSelectedVersionId(version.assetId);
    setTitle(version.title);
    setAssetSummary(version.summary);
    setContentText(JSON.stringify(version.content, null, 2));
    setDirty(false);
    setPreview(null);
  }

  function markChanged(change: () => void): void {
    change();
    setDirty(true);
    setPreview(null);
  }

  function parseContent(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(contentText) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
      return parsed as Record<string, unknown>;
    } catch {
      setError('规则内容格式不完整，请检查括号、引号和逗号。');
      return null;
    }
  }

  async function saveDraft(): Promise<void> {
    if (summary === null || selectedAssetKey === null || selectedVersion === undefined) return;
    const content = parseContent();
    if (content === null) return;
    setBusy('saving'); setError(null); setNotice(null);
    try {
      const next = await saveV7PromptAssetDraft(selectedAssetKey, {
        expectedRevision: summary.revision,
        basedOnAssetId: selectedVersion.assetId,
        kind: selectedVersion.kind,
        title: title.trim(), summary: assetSummary.trim(), content,
        reason: '管理员在提示词与上下文中心保存修改草稿'
      });
      setSummary((current) => current === null ? current : { ...current, revision: current.revision + 1 });
      setAssetVersions((current) => mergeVersion(current, next));
      selectVersion(next);
      setNotice('草稿已保存，只会影响发布后的新任务。');
      try { await refreshLists(); }
      catch { setNotice('草稿已保存；列表统计暂未刷新，稍后可点刷新。'); }
    } catch (reason) { setError(readError(reason, '草稿没有保存。')); }
    finally { setBusy(null); }
  }

  async function previewVersion(): Promise<void> {
    if (selectedVersion === undefined || dirty) {
      setError(dirty ? '请先保存当前修改，再检查编译结果。' : '请先选择一个版本。');
      return;
    }
    setBusy('previewing'); setError(null); setNotice(null);
    const baseManifestId = previewManifestId(selectedVersion, manifests, selectedManifestId);
    try { setPreview(await previewV7PromptAssetVersion(
      selectedVersion.assetKey,
      selectedVersion.assetId,
      baseManifestId
    )); }
    catch (reason) { setError(readError(reason, '这次预览没有完成。')); }
    finally { setBusy(null); }
  }

  async function publishVersion(): Promise<void> {
    if (summary === null || selectedVersion?.status !== 'draft' || dirty) {
      setError(dirty ? '请先保存当前修改，再发布。' : '只能发布已保存的草稿。');
      return;
    }
    if (preview?.asset.assetId !== selectedVersion.assetId || !previewIsValid(preview)) {
      setError('发布前请先检查本版本，确认可以正常编译。');
      return;
    }
    setBusy('publishing'); setError(null); setNotice(null);
    try {
      const next = await publishV7PromptAssetVersion(selectedVersion.assetKey, {
        assetId: selectedVersion.assetId,
        expectedRevision: summary.revision,
        reason: '管理员检查预览后发布提示资产版本'
      });
      setSummary((current) => current === null ? current : { ...current, revision: current.revision + 1 });
      setAssetVersions((current) => publishVersionLocally(current, next));
      selectVersion(next);
      setNotice('新版本已发布；执行中的任务仍使用原快照，新任务开始使用新版本。');
      try { await refreshLists(); }
      catch { setNotice('新版本已发布；列表统计暂未刷新，稍后可点刷新。'); }
    } catch (reason) { setError(readError(reason, '这次发布没有完成。')); }
    finally { setBusy(null); }
  }

  async function restoreVersion(version: V7PromptAssetVersion): Promise<void> {
    if (summary === null) return;
    setBusy('restoring'); setError(null); setNotice(null);
    try {
      const next = await restoreV7PromptAssetDraft(version.assetKey, {
        sourceAssetId: version.assetId,
        expectedRevision: summary.revision,
        reason: `管理员从第 ${version.version} 版创建恢复草稿`
      });
      setSummary((current) => current === null ? current : { ...current, revision: current.revision + 1 });
      setAssetVersions((current) => mergeVersion(current, next));
      selectVersion(next);
      setNotice(`已把第 ${version.version} 版恢复成新草稿，发布前仍可检查和修改。`);
      try { await refreshLists(); }
      catch { setNotice(`第 ${version.version} 版已恢复成新草稿；列表统计暂未刷新。`); }
    } catch (reason) { setError(readError(reason, '历史版本没有恢复。')); }
    finally { setBusy(null); }
  }

  async function refreshLists(): Promise<void> {
    const [nextSummary, assetList] = await Promise.all([
      fetchV7PromptContextSummary(), fetchV7PromptAssets()
    ]);
    setSummary(nextSummary); setAssets(assetList);
  }

  if (busy === 'loading' && summary === null) return <RemoteState loading />;
  if (summary === null) return <RemoteState error={error ?? '提示词与上下文暂时无法读取。'} onRetry={() => void loadOverview()} />;

  return <div className="prompt-context-page">
    <section className="prompt-context-intro">
      <p>统一管理岗位、工位、题材身份和执行流程；每次任务都保留实际采用版本与资料来源。</p>
      <button type="button" onClick={() => void loadOverview()} disabled={busy !== null}><ArrowClockwise />刷新</button>
    </section>

    <div className="prompt-context-metrics" aria-label="提示词与上下文概览">
      <Metric label="已发布配置" value={summary.publishedCount} />
      <Metric label="待发布草稿" value={summary.draftCount} />
      <Metric label="已留档任务" value={summary.manifestCount} />
      <Metric label="资料包快照" value={summary.contextPackCount} />
    </div>

    {(notice !== null || error !== null) && <div className={`prompt-context-notice ${error === null ? 'success' : 'error'}`} role={error === null ? 'status' : 'alert'}>
      {error === null ? <CheckCircle /> : <WarningCircle />}<span>{error ?? notice}</span>
    </div>}

    <div className="prompt-context-tabs" role="tablist" aria-label="提示词与上下文管理">
      <button type="button" role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}>配置来源</button>
      <button type="button" role="tab" aria-selected={tab === 'traces'} className={tab === 'traces' ? 'active' : ''} onClick={() => setTab('traces')}>运行追溯</button>
    </div>

    {tab === 'sources'
      ? <SourcesPanel
          assets={filteredAssets} kind={kind} onKind={selectKind} selectedAssetKey={selectedAssetKey}
          onSelectAsset={setSelectedAssetKey} selectedAsset={selectedAsset} assetVersions={assetVersions} selectedVersion={selectedVersion}
          title={title} summary={assetSummary} contentText={contentText} dirty={dirty} busy={busy} preview={preview}
          onTitle={(value) => markChanged(() => setTitle(value))}
          onSummary={(value) => markChanged(() => setAssetSummary(value))}
          onContent={(value) => markChanged(() => setContentText(value))}
          onSelectVersion={selectVersion} onSave={saveDraft} onPreview={previewVersion} onPublish={publishVersion} onRestore={restoreVersion}
        />
      : <TracesPanel
          manifests={filteredManifests} state={manifestState} onState={selectManifestState}
          states={manifestStates}
          selectedManifestId={selectedManifestId} onSelectManifest={setSelectedManifestId} detail={manifestDetail}
        />}
  </div>;
}

function SourcesPanel(props: {
  assets: V7PromptAssetSummary[];
  kind: 'all' | V7PromptAssetKind;
  onKind: (value: 'all' | V7PromptAssetKind) => void;
  selectedAssetKey: string | null;
  onSelectAsset: (value: string) => void;
  selectedAsset: V7PromptAssetSummary | undefined;
  assetVersions: V7PromptAssetVersion[] | null;
  selectedVersion: V7PromptAssetVersion | undefined;
  title: string;
  summary: string;
  contentText: string;
  dirty: boolean;
  busy: BusyState;
  preview: V7PromptAssetPreview | null;
  onTitle: (value: string) => void;
  onSummary: (value: string) => void;
  onContent: (value: string) => void;
  onSelectVersion: (value: V7PromptAssetVersion) => void;
  onSave: () => Promise<void>;
  onPreview: () => Promise<void>;
  onPublish: () => Promise<void>;
  onRestore: (value: V7PromptAssetVersion) => Promise<void>;
}): React.JSX.Element {
  const isBusy = props.busy !== null;
  const comparisonOptions = props.assetVersions?.filter((version) => version.assetId !== props.selectedVersion?.assetId) ?? [];
  const [comparisonVersionId, setComparisonVersionId] = useState<string | null>(null);
  const comparisonVersion = comparisonOptions.find((version) => version.assetId === comparisonVersionId) ?? comparisonOptions[0];

  useEffect(() => {
    if (comparisonOptions.length === 0) {
      if (comparisonVersionId !== null) setComparisonVersionId(null);
      return;
    }
    if (!comparisonOptions.some((version) => version.assetId === comparisonVersionId)) {
      setComparisonVersionId(comparisonOptions[0]?.assetId ?? null);
    }
  }, [comparisonOptions, comparisonVersionId]);

  return <section className="prompt-context-workspace">
    <aside className="prompt-source-list" aria-label="配置来源列表">
      <div className="prompt-kind-filter">
        <button type="button" className={props.kind === 'all' ? 'active' : ''} onClick={() => props.onKind('all')}>全部</button>
        {(Object.keys(KIND_LABELS) as V7PromptAssetKind[]).map((value) => <button type="button" key={value} className={props.kind === value ? 'active' : ''} onClick={() => props.onKind(value)}>{KIND_LABELS[value]}</button>)}
      </div>
      <div className="prompt-source-cards">{props.assets.length === 0
        ? <p className="prompt-empty-copy">当前筛选下没有配置。</p>
        : props.assets.map((asset) => {
          const display = assetDisplayVersion(asset);
          return <button type="button" key={asset.assetKey} className={props.selectedAssetKey === asset.assetKey ? 'active' : ''} onClick={() => props.onSelectAsset(asset.assetKey)}>
            <span><small>{KIND_LABELS[asset.kind]}</small>{asset.latestDraft !== null && <em>有草稿</em>}</span>
            <strong>{display?.title ?? asset.assetKey}</strong><p>{display?.summary ?? '尚无可展示版本。'}</p>
            <time>{display === undefined ? `共 ${asset.versionCount} 版` : formatTime(display.createdAt)}</time>
          </button>;
        })}</div>
    </aside>

    <div className="prompt-source-editor">
      {props.assetVersions === null || props.selectedVersion === undefined
        ? <section className="prompt-inline-state"><span className="asset-spinner" /><p>正在读取配置版本…</p></section>
        : <>
          <header>
            <div><span>{KIND_LABELS[props.selectedVersion.kind]}</span><h2>{assetDisplayVersion(props.selectedAsset)?.title ?? props.selectedVersion.title}</h2><p>当前查看第 {props.selectedVersion.version} 版 · {STATUS_LABELS[props.selectedVersion.status]}</p></div>
            <select aria-label="选择配置版本" value={props.selectedVersion.assetId} onChange={(event) => {
              const next = props.assetVersions?.find((item) => item.assetId === event.target.value);
              if (next !== undefined) props.onSelectVersion(next);
            }}>{props.assetVersions.map((version) => <option key={version.assetId} value={version.assetId}>第 {version.version} 版 · {STATUS_LABELS[version.status]}</option>)}</select>
          </header>

          <div className="prompt-editor-fields">
            <label><span>后台名称</span><input value={props.title} maxLength={80} onChange={(event) => props.onTitle(event.target.value)} /></label>
            <label><span>用途说明</span><textarea value={props.summary} maxLength={500} rows={3} onChange={(event) => props.onSummary(event.target.value)} /></label>
            <label><span>结构化规则</span><textarea className="prompt-rule-editor" value={props.contentText} rows={18} spellCheck={false} onChange={(event) => props.onContent(event.target.value)} /><small>只写这个来源负责的规则；作者资料、任务目标和执行结果不在这里保存。</small></label>
          </div>

          <div className="prompt-editor-actions">
            <button type="button" className="secondary" disabled={isBusy || props.dirty || props.selectedVersion.status === 'retired'} onClick={() => void props.onPreview()}>{props.busy === 'previewing' ? '检查中…' : '检查编译结果'}</button>
            {props.dirty
              ? <button type="button" className="primary" disabled={isBusy || props.title.trim().length === 0} onClick={() => void props.onSave()}><FloppyDisk />{props.busy === 'saving' ? '保存中…' : '保存草稿'}</button>
              : props.selectedVersion.status === 'draft'
                ? <button type="button" className="primary" disabled={isBusy || props.preview?.asset.assetId !== props.selectedVersion.assetId || !previewIsValid(props.preview)} onClick={() => void props.onPublish()}>{props.busy === 'publishing' ? '发布中…' : '发布此版本'}</button>
                : <button type="button" className="primary" disabled={isBusy} onClick={() => { props.onTitle(props.title); }}><FloppyDisk />创建修改草稿</button>}
          </div>

          {props.preview !== null && <section className={`prompt-preview ${previewIsValid(props.preview) ? 'valid' : 'invalid'}`}>
            <header>{previewIsValid(props.preview) ? <CheckCircle /> : <WarningCircle />}<div><strong>{previewIsValid(props.preview) ? '可以发布' : '暂时不能发布'}</strong><p>{props.preview.preview.contextMode === 'historical' ? '真实历史上下文预览' : '安全模拟上下文预览'} · {props.preview.preview.characterCount} 字符 · 约 {props.preview.preview.estimatedTokens} 字元</p></div></header>
            <p>{props.preview.preview.contextLabel}</p>
            <ul>{props.preview.preview.checks.map((check) => <li key={check.key}>{check.passed ? '通过' : '未通过'}：{previewCheckLabel(check.key)}</li>)}</ul>
            {props.preview.preview.limitations.length > 0 && <p className="prompt-trace-meta">说明：{props.preview.preview.limitations.join('；')}</p>}
            <details><summary>查看整套运行时编译预览</summary><pre>{props.preview.preview.compiledPrompt || '编译失败，没有可展示的运行时提示。'}</pre></details>
          </section>}

          <details className="prompt-version-history">
            <summary><ClockCounterClockwise />查看版本记录</summary>
            <section className="prompt-version-compare" aria-label="版本并排比较">
              <header>
                <div><strong>并排比较</strong><small>左侧是当前编辑内容，右侧可选择任一其他版本。</small></div>
                {comparisonOptions.length > 0 && <label><span>对照版本</span><select aria-label="选择要比较的历史版本" value={comparisonVersion?.assetId ?? ''} onChange={(event) => setComparisonVersionId(event.target.value)}>
                  {comparisonOptions.map((version) => <option key={version.assetId} value={version.assetId}>第 {version.version} 版 · {STATUS_LABELS[version.status]}</option>)}
                </select></label>}
              </header>
              {comparisonVersion === undefined
                ? <p className="prompt-empty-copy">还没有其他版本可供比较。</p>
                : <VersionComparison
                    currentVersion={props.selectedVersion}
                    currentTitle={props.title}
                    currentSummary={props.summary}
                    currentContentText={props.contentText}
                    currentDirty={props.dirty}
                    comparisonVersion={comparisonVersion}
                  />}
            </section>
            <div className="prompt-version-history-list">{props.assetVersions.map((version) => <article key={version.assetId}>
              <div><strong>第 {version.version} 版 · {STATUS_LABELS[version.status]}</strong><small>{formatTime(version.createdAt)} · {version.createdBy}</small></div>
              <button type="button" disabled={isBusy || version.status === 'draft'} onClick={() => void props.onRestore(version)}>恢复为草稿</button>
            </article>)}</div>
          </details>
        </>}
    </div>
  </section>;
}

function VersionComparison(props: {
  currentVersion: V7PromptAssetVersion;
  currentTitle: string;
  currentSummary: string;
  currentContentText: string;
  currentDirty: boolean;
  comparisonVersion: V7PromptAssetVersion;
}): React.JSX.Element {
  const comparisonContentText = JSON.stringify(props.comparisonVersion.content, null, 2);
  const titleChanged = props.currentTitle !== props.comparisonVersion.title;
  const summaryChanged = props.currentSummary !== props.comparisonVersion.summary;
  const contentRows = compareTextLines(props.currentContentText, comparisonContentText);
  const contentChanged = contentRows.some((row) => row.kind !== 'same');

  return <div className="prompt-version-comparison-grid">
    <VersionComparisonColumn
      heading={`当前编辑 · 第 ${props.currentVersion.version} 版`}
      subheading={`${STATUS_LABELS[props.currentVersion.status]}${props.currentDirty ? ' · 尚未保存' : ''}`}
      title={props.currentTitle}
      summary={props.currentSummary}
      contentRows={contentRows}
      side="current"
      titleChanged={titleChanged}
      summaryChanged={summaryChanged}
      contentChanged={contentChanged}
    />
    <VersionComparisonColumn
      heading={`历史对照 · 第 ${props.comparisonVersion.version} 版`}
      subheading={`${STATUS_LABELS[props.comparisonVersion.status]} · ${formatTime(props.comparisonVersion.createdAt)}`}
      title={props.comparisonVersion.title}
      summary={props.comparisonVersion.summary}
      contentRows={contentRows}
      side="comparison"
      titleChanged={titleChanged}
      summaryChanged={summaryChanged}
      contentChanged={contentChanged}
    />
  </div>;
}

function VersionComparisonColumn(props: {
  heading: string;
  subheading: string;
  title: string;
  summary: string;
  contentRows: TextComparisonRow[];
  side: 'current' | 'comparison';
  titleChanged: boolean;
  summaryChanged: boolean;
  contentChanged: boolean;
}): React.JSX.Element {
  return <article className="prompt-version-comparison-column">
    <header><strong>{props.heading}</strong><small>{props.subheading}</small></header>
    <ComparisonField label="后台名称" changed={props.titleChanged}><p>{props.title || '（空）'}</p></ComparisonField>
    <ComparisonField label="用途说明" changed={props.summaryChanged}><p>{props.summary || '（空）'}</p></ComparisonField>
    <ComparisonField label="结构化规则" changed={props.contentChanged}>
      <pre aria-label={`${props.heading}的结构化规则`}>{props.contentRows.map((row, index) => {
        const content = props.side === 'current' ? row.current : row.comparison;
        const changed = row.kind !== 'same';
        return <span key={`${index}-${row.kind}`} className={changed ? `diff-${row.kind}` : ''}>{content ?? ' '}{'\n'}</span>;
      })}</pre>
    </ComparisonField>
  </article>;
}

function ComparisonField(props: { label: string; changed: boolean; children: React.ReactNode }): React.JSX.Element {
  return <section className={props.changed ? 'changed' : 'same'}>
    <header><strong>{props.label}</strong><em>{props.changed ? '有变化' : '相同'}</em></header>
    {props.children}
  </section>;
}

interface TextComparisonRow {
  current: string | null;
  comparison: string | null;
  kind: 'same' | 'changed' | 'current-only' | 'comparison-only';
}

function compareTextLines(currentText: string, comparisonText: string): TextComparisonRow[] {
  const currentLines = currentText.replace(/\r\n/g, '\n').split('\n');
  const comparisonLines = comparisonText.replace(/\r\n/g, '\n').split('\n');
  const lengths = Array.from({ length: currentLines.length + 1 }, () => Array<number>(comparisonLines.length + 1).fill(0));

  for (let currentIndex = currentLines.length - 1; currentIndex >= 0; currentIndex -= 1) {
    for (let comparisonIndex = comparisonLines.length - 1; comparisonIndex >= 0; comparisonIndex -= 1) {
      lengths[currentIndex]![comparisonIndex] = currentLines[currentIndex] === comparisonLines[comparisonIndex]
        ? (lengths[currentIndex + 1]?.[comparisonIndex + 1] ?? 0) + 1
        : Math.max(lengths[currentIndex + 1]?.[comparisonIndex] ?? 0, lengths[currentIndex]?.[comparisonIndex + 1] ?? 0);
    }
  }

  const rows: TextComparisonRow[] = [];
  let currentIndex = 0;
  let comparisonIndex = 0;
  while (currentIndex < currentLines.length || comparisonIndex < comparisonLines.length) {
    if (currentIndex < currentLines.length && comparisonIndex < comparisonLines.length && currentLines[currentIndex] === comparisonLines[comparisonIndex]) {
      rows.push({ current: currentLines[currentIndex] ?? '', comparison: comparisonLines[comparisonIndex] ?? '', kind: 'same' });
      currentIndex += 1;
      comparisonIndex += 1;
      continue;
    }

    const currentBlock: string[] = [];
    const comparisonBlock: string[] = [];
    while (currentIndex < currentLines.length || comparisonIndex < comparisonLines.length) {
      if (currentIndex < currentLines.length && comparisonIndex < comparisonLines.length && currentLines[currentIndex] === comparisonLines[comparisonIndex]) break;
      if (comparisonIndex >= comparisonLines.length || (currentIndex < currentLines.length && (lengths[currentIndex + 1]?.[comparisonIndex] ?? 0) >= (lengths[currentIndex]?.[comparisonIndex + 1] ?? 0))) {
        currentBlock.push(currentLines[currentIndex] ?? '');
        currentIndex += 1;
      } else {
        comparisonBlock.push(comparisonLines[comparisonIndex] ?? '');
        comparisonIndex += 1;
      }
    }
    const blockSize = Math.max(currentBlock.length, comparisonBlock.length);
    for (let index = 0; index < blockSize; index += 1) {
      const current = currentBlock[index] ?? null;
      const comparison = comparisonBlock[index] ?? null;
      rows.push({
        current,
        comparison,
        kind: current !== null && comparison !== null ? 'changed' : current !== null ? 'current-only' : 'comparison-only'
      });
    }
  }
  return rows;
}

function TracesPanel(props: {
  manifests: V7PromptManifestSummary[];
  state: string;
  onState: (value: string) => void;
  states: string[];
  selectedManifestId: string | null;
  onSelectManifest: (value: string) => void;
  detail: V7PromptManifestDetail | null;
}): React.JSX.Element {
  return <section className="prompt-trace-workspace">
    <aside className="prompt-trace-list">
      <label><span>任务结果</span><select value={props.state} onChange={(event) => props.onState(event.target.value)}>
        <option value="all">全部结果</option>{props.states.map((state) => <option key={state} value={state}>{executionStateLabel(state)}</option>)}
      </select></label>
      <div>{props.manifests.length === 0
        ? <p className="prompt-empty-copy">当前筛选下没有运行记录。</p>
        : props.manifests.map((manifest) => <button type="button" key={manifest.manifestId} className={props.selectedManifestId === manifest.manifestId ? 'active' : ''} onClick={() => props.onSelectManifest(manifest.manifestId)}>
          <span><strong>书籍 {displayIdentifier(manifest.bookId)}</strong><em className={`state-${safeCssToken(manifest.execution.state)}`}>{executionStateLabel(manifest.execution.state)}</em></span>
          <p>{manifest.workstationKey} · {manifest.memberKey}</p><small>提示快照已留档</small><time>{formatTime(manifest.createdAt)}</time>
        </button>)}</div>
    </aside>

    <div className="prompt-trace-detail">{props.selectedManifestId === null
      ? <section className="prompt-inline-state"><p>选择一条任务查看采用的配置和资料来源。</p></section>
      : props.detail === null
        ? <section className="prompt-inline-state"><span className="asset-spinner" /><p>正在读取运行记录…</p></section>
        : <ManifestDetail detail={props.detail} />}</div>
  </section>;
}

function ManifestDetail({ detail }: { detail: V7PromptManifestDetail }): React.JSX.Element {
  const [verification, setVerification] = useState<V7PromptManifestRebuildVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  useEffect(() => {
    setVerification(null);
    setVerificationError(null);
  }, [detail.manifest.manifestId]);
  const includedSources = detail.contextPack?.sources.filter((source) => source.decision === 'included') ?? [];
  const excludedSources = detail.contextPack?.sources.filter((source) => source.decision === 'excluded') ?? [];
  const rolePrompt = detail.promptAssets.rolePrompt;
  const workstationPrompt = detail.promptAssets.workstationPrompt;
  return <>
    <header><div><span>{workstationPrompt?.title ?? detail.manifest.workstationKey}</span><h2>书籍 {displayIdentifier(detail.manifest.bookId)}</h2><p>{detail.manifest.memberKey} · {rolePrompt?.title ?? detail.manifest.roleKey} · {detail.manifest.modelProfileKey}</p></div><em className={`state-${safeCssToken(detail.execution.state)}`}>{executionStateLabel(detail.execution.state)}</em></header>

    <section className="prompt-trace-section prompt-execution-summary"><h3>提示快照与真实任务状态</h3><dl>
      <div><dt>提示快照</dt><dd>{manifestStateLabel(detail.manifest.lifecycleStatus)}，只证明本次下发内容已经留档。</dd></div>
      <div><dt>任务结果</dt><dd>{executionStateLabel(detail.execution.state)}：{detail.execution.summary}</dd></div>
      <div><dt>产物类型</dt><dd>{detail.execution.artifactType}</dd></div>
      <div><dt>完成时间</dt><dd>{detail.execution.completedAt === null ? '尚无完成时间' : formatTime(detail.execution.completedAt)}</dd></div>
    </dl></section>

    <section className="prompt-trace-section"><h3>本次 PromptManifest</h3><dl>
      <div><dt>运行清单</dt><dd>{detail.manifest.manifestId}</dd></div>
      <div><dt>任务编号</dt><dd>{detail.manifest.taskId}</dd></div>
      <div><dt>固定岗位与阶段工位</dt><dd>{rolePrompt?.title ?? detail.manifest.roleKey}；{workstationPrompt?.title ?? detail.manifest.workstationKey}</dd></div>
      <div><dt>成员与模型</dt><dd>{detail.manifest.memberKey}；{detail.manifest.modelProfileKey}；温度 {detail.manifest.temperature.toFixed(2)}</dd></div>
      <div><dt>任务合同版本</dt><dd>{detail.manifest.taskContractId} · 第 {detail.manifest.taskContractVersion} 版</dd></div>
      <div><dt>ContextPack 快照</dt><dd>{detail.manifest.contextPackId} · {displayIdentifier(detail.manifest.contextPackHash)}</dd></div>
    </dl>
      <div className="prompt-editor-actions">
        <button type="button" className="secondary" disabled={verifying} onClick={() => {
          setVerifying(true); setVerificationError(null);
          void verifyV7PromptManifestRebuild(detail.manifest.manifestId).then(setVerification).catch((reason: unknown) => {
            setVerificationError(readError(reason, '历史快照核对没有完成。'));
          }).finally(() => setVerifying(false));
        }}>{verifying ? '正在重建核对…' : '重建核对历史快照'}</button>
      </div>
      {verificationError !== null && <p className="prompt-empty-copy" role="alert">{verificationError}</p>}
      {verification !== null && <div className={`prompt-context-notice ${verification.matched ? 'success' : 'error'}`} role="status">
        {verification.matched ? <CheckCircle /> : <WarningCircle />}<span>{verification.summary}<br />保存哈希：{displayIdentifier(verification.storedHash ?? '缺失')}；重建哈希：{displayIdentifier(verification.rebuiltHash ?? '缺失')}</span>
      </div>}
    </section>

    {detail.taskContract === null
      ? <section className="prompt-trace-section"><h3>本次任务合同</h3><p className="prompt-empty-copy">这条历史清单没有关联到任务合同快照。</p></section>
      : <section className="prompt-trace-section"><h3>本次任务合同</h3><dl>
        <div><dt>要完成什么</dt><dd>{detail.taskContract.objective}</dd></div>
        <div><dt>必须保留</dt><dd>{joinOrEmpty(detail.taskContract.mustPreserve)}</dd></div>
        <div><dt>可以调整</dt><dd>{joinOrEmpty(detail.taskContract.allowedChanges)}</dd></div>
        <div><dt>不能改动</dt><dd>{joinOrEmpty(detail.taskContract.forbiddenChanges)}</dd></div>
        <div><dt>完成标准</dt><dd>{joinOrEmpty(detail.taskContract.successCriteria)}</dd></div>
        <div><dt>交付内容</dt><dd>{formatStructured(detail.taskContract.outputContract)}</dd></div>
      </dl></section>}

    <section className="prompt-trace-section"><h3>实际采用的配置</h3><div className="prompt-version-tags">
      {rolePrompt !== null && <span>{rolePrompt.title} · 第{rolePrompt.version}版</span>}
      {workstationPrompt !== null && <span>{workstationPrompt.title} · 第{workstationPrompt.version}版</span>}
      {detail.promptAssets.skills.map((skill) => <span key={skill.assetId}>{skill.title} · 第{skill.version}版</span>)}
      {detail.genreProfile !== null && <span>{detail.genreProfile.publicLabel} · 第{detail.genreProfile.version}版</span>}
    </div><p className="prompt-trace-meta">温度 {detail.manifest.temperature.toFixed(2)} · 配置版本 {detail.manifest.governanceRevision} · 可用工具 {joinOrEmpty(detail.manifest.allowedTools)}</p></section>

    {detail.genreProfile === null
      ? <section className="prompt-trace-section"><h3>本书题材工作档案</h3><p className="prompt-empty-copy">这次任务没有使用书级题材融合档案。</p></section>
      : <section className="prompt-trace-section"><h3>本书题材工作档案</h3><dl>
        <div><dt>融合结果</dt><dd>{detail.genreProfile.publicLabel} · 第 {detail.genreProfile.version} 版</dd></div>
        <div><dt>本次创作身份</dt><dd>{detail.genreProfile.workingIdentity}</dd></div>
        <div><dt>主题材与融合题材</dt><dd>{detail.genreProfile.primaryGenreKey}；{joinOrEmpty(detail.genreProfile.supportingGenreKeys)}</dd></div>
        <div><dt>核心阅读承诺</dt><dd>{detail.genreProfile.primaryPromise}</dd></div>
        <div><dt>融合题材只负责</dt><dd>{joinOrEmpty(detail.genreProfile.supportingFunctions)}</dd></div>
        <div><dt>写作优先级</dt><dd>{joinOrEmpty(detail.genreProfile.writingPriorities)}</dd></div>
        <div><dt>真实性检查</dt><dd>{joinOrEmpty(detail.genreProfile.authenticityChecks)}</dd></div>
        <div><dt>需要避免</dt><dd>{joinOrEmpty(detail.genreProfile.avoidPatterns)}</dd></div>
        <div><dt>题材冲突取舍</dt><dd>{joinOrEmpty(detail.genreProfile.conflictResolutions)}</dd></div>
        <div><dt>来源</dt><dd>开书资料第 {detail.genreProfile.sourceBookVersion} 版；语义合成任务 {detail.genreProfile.compiledByTaskId}</dd></div>
      </dl></section>}

    {detail.contextPack === null
      ? <section className="prompt-trace-section"><h3>资料包来源</h3><p className="prompt-empty-copy">这条历史清单没有关联到资料包快照。</p></section>
      : <section className="prompt-trace-section"><h3>资料包来源</h3><p className="prompt-trace-meta">使用 {detail.contextPack.estimatedTokens} / {detail.contextPack.tokenBudget} 预计字元 · 规则 {detail.contextPack.policyVersion}</p>
        <div className="prompt-source-traces">{includedSources.map((source) => <article key={`${source.sourceKey}-${source.sourceId}`}><span>已采用</span><div><strong>{source.sourceKey}</strong><p>{source.sourceType} · {source.reason}</p><small>范围：{displayIdentifier(source.ownerId)} / {displayIdentifier(source.bookId)}</small></div><small>第 {source.sourceVersion} 版</small></article>)}</div>
        {excludedSources.length > 0 && <details><summary>查看未采用的资料（{excludedSources.length}）</summary><div className="prompt-source-traces excluded">{excludedSources.map((source) => <article key={`${source.sourceKey}-${source.sourceId}`}><span>未采用</span><div><strong>{source.sourceKey}</strong><p>{source.sourceType} · {source.reason}</p><small>范围：{displayIdentifier(source.ownerId)} / {displayIdentifier(source.bookId)}</small></div><small>第 {source.sourceVersion} 版</small></article>)}</div></details>}
      </section>}

    <details className="prompt-compiled-output"><summary>查看最终下发内容</summary><pre>{detail.manifest.compiledPrompt}</pre></details>
  </>;
}

function preferredVersion(versions: V7PromptAssetVersion[]): V7PromptAssetVersion | undefined {
  return [...versions].sort((left, right) => {
    const leftRank = left.status === 'draft' ? 2 : left.status === 'published' ? 1 : 0;
    const rightRank = right.status === 'draft' ? 2 : right.status === 'published' ? 1 : 0;
    return rightRank - leftRank || right.version - left.version;
  })[0];
}

function assetDisplayVersion(asset: V7PromptAssetSummary | undefined): V7PromptAssetVersion | undefined {
  return asset?.latestDraft ?? asset?.published ?? undefined;
}

function mergeVersion(current: V7PromptAssetVersion[] | null, next: V7PromptAssetVersion): V7PromptAssetVersion[] {
  const withoutCurrent = (current ?? []).filter((version) => version.assetId !== next.assetId);
  return [next, ...withoutCurrent].sort((left, right) => right.version - left.version);
}

function publishVersionLocally(current: V7PromptAssetVersion[] | null, published: V7PromptAssetVersion): V7PromptAssetVersion[] {
  return mergeVersion((current ?? []).map((version) => {
    if (version.assetId === published.assetId) return published;
    return version.status === 'published' ? { ...version, status: 'retired' as const } : version;
  }), published);
}

function previewIsValid(preview: V7PromptAssetPreview | null): boolean {
  return preview !== null && preview.preview.checks.length > 0 && preview.preview.checks.every((check) => check.passed);
}

function previewManifestId(
  asset: V7PromptAssetVersion,
  manifests: readonly V7PromptManifestSummary[],
  preferredId: string | null
): string | undefined {
  if (asset.kind === 'genre_persona') return undefined;
  const matches = (manifest: V7PromptManifestSummary): boolean => {
    if (asset.kind === 'role_prompt') return (asset.content as { roleKey?: string }).roleKey === manifest.roleKey;
    if (asset.kind === 'workstation_prompt') {
      const content = asset.content as { workstationKey?: string; taskKinds?: readonly string[] };
      return content.workstationKey === manifest.workstationKey && content.taskKinds?.includes(manifest.taskKind) === true;
    }
    return (asset.content as { triggerTaskKinds?: readonly string[] }).triggerTaskKinds?.includes(manifest.taskKind) === true;
  };
  const preferred = manifests.find((manifest) => manifest.manifestId === preferredId && matches(manifest));
  return preferred?.manifestId ?? manifests.find(matches)?.manifestId;
}

function previewCheckLabel(key: string): string {
  if (key === 'requiredFields') return '必要字段齐全';
  if (key === 'assetIdentity') return '配置编号和固定工位一致';
  if (key === 'fieldTypes') return '字段类型正确';
  if (key === 'requiredStrings') return '必要说明完整';
  if (key === 'listItems') return '列表内容有效';
  if (key === 'requiredLists') return '必要规则列表完整';
  if (key === 'taskKinds') return '任务类型有效';
  if (key === 'length') return '配置长度合理';
  if (key === 'structure') return '结构完整';
  if (key === 'secretBoundary') return '未包含密钥';
  if (key === 'reasoningBoundary') return '未保存模型思维过程';
  if (key === 'runtimeCompilation') return '岗位、工位、Skill、任务合同与资料包可完整编译';
  return key;
}

function manifestStateLabel(value: string): string {
  if (value === 'active' || value === 'immutable') return '提示快照已留档';
  if (value === 'archived') return '已归档';
  if (value === 'superseded') return '已替代';
  return value.length === 0 ? '状态未知' : value;
}

function executionStateLabel(value: string): string {
  if (value === 'working') return '正在执行';
  if (value === 'succeeded') return '已完成';
  if (value === 'failed') return '本次未完成';
  if (value === 'cancelled') return '已取消';
  if (value === 'not_linked') return '未找到运行记录';
  return '状态未知';
}

function displayIdentifier(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function safeCssToken(value: string): string {
  return value.replace(/[^a-z0-9_-]/giu, '-').toLowerCase();
}

function formatStructured(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '无';
  return entries.map(([key, item]) => `${key}：${typeof item === 'string' ? item : JSON.stringify(item)}`).join('；');
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }): React.JSX.Element {
  return <article className={warning ? 'warning' : ''}><strong>{value}</strong><span>{label}</span></article>;
}

function RemoteState({ loading = false, error, onRetry }: { loading?: boolean; error?: string; onRetry?: () => void }): React.JSX.Element {
  return <section className="platform-remote-state">{loading ? <span className="asset-spinner" /> : <WarningCircle size={30} />}<strong>{loading ? '正在读取提示词与上下文' : '提示词与上下文暂时无法读取'}</strong><p>{loading ? '正在核对配置版本和最近运行记录。' : error}</p>{!loading && onRetry !== undefined && <button type="button" onClick={onRetry}><ArrowClockwise />重新读取</button>}</section>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function joinOrEmpty(values: string[]): string { return values.length === 0 ? '无' : values.join('；'); }
function readError(reason: unknown, fallback: string): string { return reason instanceof Error ? reason.message : fallback; }
