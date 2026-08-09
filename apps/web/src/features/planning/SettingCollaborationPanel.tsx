import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAuthorPlanningInput,
  fetchSettingCollaboration,
  resumeTask,
  retryTask,
  saveSettingOutlineItem,
  startSettingCollaboration,
  synthesizeSettingCollaboration,
  reviseSettingCollaboration,
  type SettingCollaborationData,
  type SettingOutlineWorkspaceData
} from '../../lib/api/client';

const activeTaskStatuses = new Set(['pending', 'queued', 'working']);

export function SettingCollaborationPanel({
  bookId,
  item,
  onSnapshot
}: {
  bookId: string;
  item: Pick<SettingOutlineWorkspaceData, 'itemKey' | 'groupTitle' | 'label' | 'prompt' | 'sourceLabel' | 'status' | 'custom' | 'sortOrder' | 'content'>;
  onSnapshot: (item: SettingOutlineWorkspaceData) => void;
}): React.JSX.Element {
  const [data, setData] = useState<SettingCollaborationData | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [source, setSource] = useState('');
  const [idea, setIdea] = useState('');
  const [draft, setDraft] = useState(item.content ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ideaKey = useRef<string | null>(null);
  const sourceKey = useRef<string | null>(null);
  const startKey = useRef<string | null>(null);
  const synthesisKey = useRef<string | null>(null);
  const revisionKey = useRef<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const next = await fetchSettingCollaboration(bookId, item.itemKey, signal);
    setData(next);
    setDraft((current) => next.item.content === null ? current : next.item.content!);
    onSnapshot(next.item);
  }, [bookId, item.itemKey, onSnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected([]);
    setSource('');
    setDraft(item.content ?? '');
    void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setNotice(reason instanceof Error ? reason.message : '协作状态读取失败');
    });
    return () => controller.abort();
  }, [item.content, refresh]);

  const panelStatus = data?.panel?.taskStatus ?? null;
  const revisionStatus = data?.revisionTask?.status ?? null;
  const polling = (panelStatus !== null && activeTaskStatuses.has(panelStatus))
    || (revisionStatus !== null && activeTaskStatuses.has(revisionStatus));
  useEffect(() => {
    if (!polling) return undefined;
    const timer = window.setInterval(() => {
      void refresh().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '协作状态刷新失败'));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  const start = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy('start'); setNotice(null);
    try {
      const existingSource = source.trim();
      let authorInputId: string | null = null;
      if (existingSource.length > 0) {
        sourceKey.current ??= createClientKey();
        const saved = await createAuthorPlanningInput(bookId, {
          surface: 'setting',
          subjectType: 'setting_module',
          subjectId: item.itemKey,
          intentStrength: 'preference',
          originalText: existingSource,
          attachmentRefs: [],
          mentionedAgentIds: [],
          scopeNotes: `作者为“${item.label}”提供的已有设定原文，作为本轮发散参考，不自动确认。`,
          idempotencyKey: sourceKey.current
        });
        authorInputId = saved.authorInputId;
      }
      startKey.current ??= createClientKey();
      await startSettingCollaboration(bookId, item.itemKey, {
        authorInputId,
        idempotencyKey: startKey.current
      });
      setSource('');
      sourceKey.current = null;
      startKey.current = null;
      setNotice('三名成员已开始各自构思；刷新页面不会重复创建任务。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '启动协作失败');
    } finally { setBusy(null); }
  };

  const synthesize = async (): Promise<void> => {
    const panel = data?.panel;
    if (busy !== null || panel === null || panel === undefined || selected.length === 0) return;
    setBusy('synthesize'); setNotice(null);
    try {
      const authorIdea = idea.trim();
      let authorInputId: string | null = null;
      if (authorIdea.length > 0) {
        ideaKey.current ??= createClientKey();
        const saved = await createAuthorPlanningInput(bookId, {
          surface: 'setting',
          subjectType: 'setting_module',
          subjectId: item.itemKey,
          intentStrength: 'preference',
          originalText: authorIdea,
          attachmentRefs: [],
          mentionedAgentIds: [],
          scopeNotes: `用于“${item.label}”方案整理`,
          idempotencyKey: ideaKey.current
        });
        authorInputId = saved.authorInputId;
      }
      const proposalIds = panel.proposals
        .filter((proposal) => selected.includes(proposal.number))
        .map((proposal) => proposal.proposalId);
      synthesisKey.current ??= createClientKey();
      await synthesizeSettingCollaboration(bookId, item.itemKey, {
        proposalIds,
        authorInputId,
        idempotencyKey: synthesisKey.current
      });
      ideaKey.current = null;
      synthesisKey.current = null;
      setNotice('主编正在按你的选择整理一个待确认版本。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '提交选择失败');
    } finally { setBusy(null); }
  };

  const saveCandidate = async (status: '候选待确认' | '已确认'): Promise<void> => {
    if (busy !== null || draft.trim().length === 0) return;
    setBusy(status); setNotice(null);
    try {
      const saved = await saveSettingOutlineItem(bookId, {
        itemKey: item.itemKey,
        groupTitle: item.groupTitle,
        label: item.label,
        prompt: item.prompt,
        sourceLabel: item.sourceLabel,
        status,
        custom: item.custom,
        sortOrder: item.sortOrder,
        content: draft
      });
      onSnapshot(saved);
      setData((current) => current === null ? current : { ...current, item: saved });
      setNotice(status === '已确认'
        ? '这一项已确认。它不会改写正文或正史；完成全部必谈项后才生成新的正式设定版本。'
        : '修改已保存为待确认内容。');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '设定内容保存失败');
    } finally { setBusy(null); }
  };

  const revise = async (): Promise<void> => {
    if (busy !== null || idea.trim().length === 0) return;
    setBusy('revise'); setNotice(null);
    try {
      ideaKey.current ??= createClientKey();
      const saved = await createAuthorPlanningInput(bookId, {
        surface: 'setting',
        subjectType: 'setting_module',
        subjectId: item.itemKey,
        intentStrength: 'preference',
        originalText: idea.trim(),
        attachmentRefs: [],
        mentionedAgentIds: [],
        scopeNotes: `用于“${item.label}”候选的定点修改`,
        idempotencyKey: ideaKey.current
      });
      revisionKey.current ??= createClientKey();
      await reviseSettingCollaboration(bookId, item.itemKey, {
        authorInputId: saved.authorInputId,
        idempotencyKey: revisionKey.current
      });
      ideaKey.current = null;
      revisionKey.current = null;
      setIdea('');
      setNotice('修改意见已交给主编，现有版本和三份原始方案都会保留。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '提交修改意见失败');
    } finally { setBusy(null); }
  };

  const retry = async (): Promise<void> => {
    const revisionFailed = data?.revisionTask != null
      && ['failed', 'interrupted'].includes(data.revisionTask.status);
    const panelFailed = data?.panel != null
      && ['failed', 'interrupted'].includes(data.panel.taskStatus);
    const taskId = revisionFailed
      ? data.revisionTask!.taskId
      : panelFailed
        ? data.panel!.taskId
        : undefined;
    if (taskId === undefined || busy !== null) return;
    setBusy('retry'); setNotice(null);
    try {
      await retryTask(bookId, taskId);
      setNotice('任务会从已经保存的检查点继续，成功的成员不会重复调用。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '任务重试失败');
    } finally { setBusy(null); }
  };

  const resume = async (): Promise<void> => {
    const taskId = data?.revisionTask?.status === 'paused'
      ? data.revisionTask.taskId
      : data?.panel?.taskStatus === 'paused'
        ? data.panel.taskId
        : undefined;
    if (taskId === undefined || busy !== null) return;
    setBusy('resume'); setNotice(null);
    try {
      await resumeTask(bookId, taskId);
      setNotice('任务已从保留的检查点继续。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '任务继续失败');
    } finally { setBusy(null); }
  };

  const proposals = data?.panel?.proposals ?? [];
  const panelMembers = data?.panel?.members ?? [];
  const panelFailed = data?.panel != null && ['failed', 'interrupted'].includes(data.panel.taskStatus);
  const revisionFailed = data?.revisionTask != null && ['failed', 'interrupted'].includes(data.revisionTask.status);
  const paused = data?.panel?.taskStatus === 'paused' || data?.revisionTask?.status === 'paused';
  const blocked = data?.panel?.taskStatus === 'blocked' || data?.revisionTask?.status === 'blocked';
  const revisionRunning = data?.revisionTask != null && activeTaskStatuses.has(data.revisionTask.status);
  const candidateReady = (data?.item.status ?? item.status) === '候选待确认' && draft.trim().length > 0;

  return <section className="setting-collaboration" aria-labelledby={`setting-collaboration-${item.itemKey}`}>
    <header>
      <div><small>当前只处理这一项</small><h4 id={`setting-collaboration-${item.itemKey}`}>{item.label}</h4><p>{item.prompt}</p></div>
      <span>{data?.historyCount ?? 0} 轮记录</span>
    </header>

    {data === null ? <p className="setting-collaboration-state">正在读取当前进度……</p> : <>
      {data.panel === null && !candidateReady && <div className="setting-collaboration-start">
        <p>三名成员会读取同一份最小资料，各自给出真正推荐的方案。作者选择前不会自动合并或确认。</p>
        <details className="setting-collapsible-input"><summary>我有现成内容，展开补充（选填）</summary><label>已有设定原文<textarea aria-label="已有设定原文" rows={4} maxLength={10_000} value={source} onChange={(event) => setSource(event.target.value)} placeholder="可以粘贴以前写过的设定、零散想法或硬性边界；会保留原话并只作为本轮参考。" /></label></details>
        <footer><span>{source.length}/10000</span><button className="primary-button" type="button" disabled={busy !== null} onClick={() => void start()}>{busy === 'start' ? '正在启动…' : '让三名成员各自给方案'}</button></footer>
      </div>}
      {data.panel !== null && <section className="setting-member-statuses" aria-label="设定协作成员状态">
        <header><div><strong>本轮参与成员</strong><small>状态、上下文和输出都来自当前真实任务</small></div><span>{panelMembers.filter((member) => member.status === 'completed').length}/{panelMembers.length} 完成</span></header>
        <div>{panelMembers.map((member) => <article key={member.agentId} className={`member-${member.status}`}>
          <header><div><strong>{member.memberName}</strong><small>{roleLabel(member.roleKey)}</small></div><span>{memberStatusLabel(member.status)}</span></header>
          <dl><dt>本轮读取</dt><dd>{member.contextSummary}</dd><dt>当前输出</dt><dd>{member.outputSummary ?? memberPendingLabel(member.status)}</dd></dl>
          <footer>{member.modelProvider} · {member.modelId}</footer>
        </article>)}</div>
      </section>}
      {data.panel !== null && activeTaskStatuses.has(data.panel.taskStatus) && <p className="setting-collaboration-state">成员正在独立构思；已完成的结果会逐项保留。</p>}
      {(panelFailed || revisionFailed) && <div className="setting-collaboration-error"><p>这轮任务没有完成，已有方案和检查点仍然保留。</p><button type="button" disabled={busy !== null} onClick={() => void retry()}>{busy === 'retry' ? '正在恢复…' : '从检查点继续'}</button></div>}
      {paused && <div className="setting-collaboration-error"><p>任务已暂停，已有结果和检查点都已保留。</p><button type="button" disabled={busy !== null} onClick={() => void resume()}>{busy === 'resume' ? '正在继续…' : '继续这项任务'}</button></div>}
      {blocked && <p className="setting-collaboration-state">任务需要先处理阻塞原因；请在任务中心查看具体说明，现有方案不会丢失。</p>}
      {proposals.length > 0 && <div className="setting-proposal-grid">{proposals.map((proposal) => {
        const checked = selected.includes(proposal.number);
        return <button type="button" className={checked ? 'selected' : ''} key={proposal.proposalId} aria-pressed={checked} onClick={() => setSelected((current) => checked ? current.filter((number) => number !== proposal.number) : [...current, proposal.number])}>
          <span>方案 {proposal.number}</span><strong>{proposal.memberName}</strong><p>{proposal.content}</p><small>{checked ? '已选入整理' : '点击选择，可多选'}</small>
        </button>;
      })}</div>}
      {proposals.length > 0 && !candidateReady && <section className="setting-author-choice"><details className="setting-collapsible-input"><summary>我还想补充自己的想法</summary><label>你的补充想法<textarea rows={4} maxLength={4000} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：我喜欢方案1的世界规则，但人物关系想用方案2；这一点只是参考，不要写死。" /></label></details><footer><span>{selected.length === 0 ? '请先选择至少一份方案' : `已选择 ${[...selected].sort((a, b) => a - b).join('、')}`}</span><button className="primary-button" type="button" disabled={busy !== null || selected.length === 0} onClick={() => void synthesize()}>{busy === 'synthesize' ? '正在提交…' : '按我的选择整理'}</button></footer></section>}
      {revisionRunning && <p className="setting-collaboration-state">主编正在按你的选择或修改意见整理候选，完成前暂不覆盖当前编辑稿。</p>}
      {candidateReady && <section className="setting-candidate-editor"><header><div><small>待确认版本</small><strong>主编已整理，可直接修改</strong></div><span>确认后仍不直接进入正史</span></header><textarea aria-label="待确认设定内容" rows={10} maxLength={20_000} value={draft} disabled={revisionRunning} onChange={(event) => setDraft(event.target.value)} /><details className="setting-collapsible-input"><summary>还想让主编定点修改？</summary><label>修改意见<textarea rows={3} maxLength={4000} value={idea} disabled={revisionRunning} onChange={(event) => setIdea(event.target.value)} placeholder="写具体修改意见；只会让主编定点调整，不重复启动三人提案。" /></label></details><div className="setting-candidate-actions"><button type="button" disabled={busy !== null || revisionRunning || idea.trim().length === 0} onClick={() => void revise()}>{busy === 'revise' ? '正在提交…' : '让主编按意见修改'}</button><button type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('候选待确认')}>{busy === '候选待确认' ? '正在保存…' : '保存我的修改'}</button><button className="primary-button" type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('已确认')}>{busy === '已确认' ? '正在确认…' : '确认这一项'}</button></div></section>}
      <p className="setting-impact-note">这里的选择只影响设定大纲候选，不会改写已写正文或正史。全部必谈项完成后，系统才生成一份新的正式设定版本。</p>
    </>}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </section>;
}

function createClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `setting-idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function roleLabel(roleKey: string): string {
  return ({ chief_editor: '主编', lead_screenwriter: '快节奏编剧', second_screenwriter: '递进型编剧', deputy_editor: '副编' } as Record<string, string>)[roleKey] ?? roleKey;
}

function memberStatusLabel(status: NonNullable<SettingCollaborationData['panel']>['members'][number]['status']): string {
  return ({ preparing: '准备上下文', working: '构思中', completed: '方案已完成', failed: '需要处理', paused: '已暂停' } as const)[status];
}

function memberPendingLabel(status: NonNullable<SettingCollaborationData['panel']>['members'][number]['status']): string {
  return ({ preparing: '正在核对开书资料与当前设定项', working: '正在生成独立方案', completed: '方案已保存', failed: '本轮未产出，已有进度仍保留', paused: '等待继续' } as const)[status];
}
