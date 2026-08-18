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
import { useMembershipGate } from '../shared/membership-gate';

const activeTaskStatuses = new Set(['pending', 'queued', 'working']);

type Proposal = NonNullable<SettingCollaborationData['panel']>['proposals'][number];

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
  const [pickedFragments, setPickedFragments] = useState<string[]>([]);
  const [source, setSource] = useState('');
  const [idea, setIdea] = useState('');
  const [sourceStrength, setSourceStrength] = useState<'must' | 'preference'>('preference');
  const [ideaStrength, setIdeaStrength] = useState<'must' | 'preference'>('preference');
  const [draft, setDraft] = useState(item.content ?? '');
  const [selfWriting, setSelfWriting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const proposalAnchor = useRef<HTMLDivElement | null>(null);
  const ideaKey = useRef<string | null>(null);
  const sourceKey = useRef<string | null>(null);
  const startKey = useRef<string | null>(null);
  const synthesisKey = useRef<string | null>(null);
  const revisionKey = useRef<string | null>(null);
  const { guardAi } = useMembershipGate();

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
    setPickedFragments([]);
    setSource('');
    setSelfWriting(false);
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
    if (!guardAi()) return;
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
          intentStrength: sourceStrength,
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
      setNotice('团队已开始设计，稍等片刻就能看到方案。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '启动协作失败');
    } finally { setBusy(null); }
  };

  const synthesize = async (): Promise<void> => {
    const panel = data?.panel;
    if (busy !== null || panel === null || panel === undefined) return;
    if (!guardAi()) return;
    const fragmentMode = pickedFragments.length > 0;
    const proposalIds = fragmentMode
      ? [...new Set(panel.proposals
        .filter((proposal) => proposal.fragments.some((fragment) => pickedFragments.includes(fragment.fragmentId)))
        .map((proposal) => proposal.proposalId))]
      : panel.proposals
        .filter((proposal) => selected.includes(proposal.number))
        .map((proposal) => proposal.proposalId);
    if (proposalIds.length === 0) return;
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
          intentStrength: ideaStrength,
          originalText: authorIdea,
          attachmentRefs: [],
          mentionedAgentIds: [],
          scopeNotes: `用于“${item.label}”方案整理`,
          idempotencyKey: ideaKey.current
        });
        authorInputId = saved.authorInputId;
      }
      synthesisKey.current ??= createClientKey();
      await synthesizeSettingCollaboration(bookId, item.itemKey, {
        proposalIds,
        ...(fragmentMode ? { fragmentIds: pickedFragments } : {}),
        authorInputId,
        idempotencyKey: synthesisKey.current
      });
      ideaKey.current = null;
      synthesisKey.current = null;
      setNotice('主编正在按你的勾选融合一份通顺的设定稿。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '提交选择失败');
    } finally { setBusy(null); }
  };

  const saveCandidate = async (status: '候选待确认' | '已确认', explicitContent?: string): Promise<void> => {
    const content = explicitContent ?? draft;
    if (busy !== null || content.trim().length === 0) return;
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
        content
      });
      onSnapshot(saved);
      setData((current) => current === null ? current : { ...current, item: saved });
      setSelfWriting(false);
      setNotice(status === '已确认'
        ? '这一项已确认。它不会改写正文或已确认内容；完成全部必谈项后才生成新的正式设定稿。'
        : '修改已保存为待确认内容。');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '设定内容保存失败');
    } finally { setBusy(null); }
  };

  const leaveBlank = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy('blank'); setNotice(null);
    try {
      const saved = await saveSettingOutlineItem(bookId, {
        itemKey: item.itemKey,
        groupTitle: item.groupTitle,
        label: item.label,
        prompt: item.prompt,
        sourceLabel: item.sourceLabel,
        status: '刻意留白',
        custom: item.custom,
        sortOrder: item.sortOrder,
        content: null
      });
      onSnapshot(saved);
      setData((current) => current === null ? current : { ...current, item: saved });
      setNotice('这一项先留白，以后随时可以回来定。');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '操作没有完成');
    } finally { setBusy(null); }
  };

  const revise = async (): Promise<void> => {
    if (busy !== null || idea.trim().length === 0) return;
    if (!guardAi()) return;
    setBusy('revise'); setNotice(null);
    try {
      ideaKey.current ??= createClientKey();
      const saved = await createAuthorPlanningInput(bookId, {
        surface: 'setting',
        subjectType: 'setting_module',
        subjectId: item.itemKey,
        intentStrength: 'must',
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
      setNotice('修改意见已交给主编，现有稿件和三份原始方案都会保留。');
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
      setNotice('将继续完成尚未结束的部分，已经完成的方案会保留。');
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
      setNotice('已经继续处理，现有结果会保留。');
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '任务继续失败');
    } finally { setBusy(null); }
  };

  const toggleFragment = (fragmentId: string): void => {
    setPickedFragments((current) => current.includes(fragmentId)
      ? current.filter((id) => id !== fragmentId)
      : [...current, fragmentId]);
  };

  const pickWholeProposal = (proposal: Proposal): void => {
    if (proposal.fragments.length > 0) {
      const ids = proposal.fragments.map((fragment) => fragment.fragmentId);
      const allPicked = ids.every((id) => pickedFragments.includes(id));
      setPickedFragments((current) => allPicked
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])]);
      return;
    }
    setSelected((current) => selected.includes(proposal.number)
      ? current.filter((number) => number !== proposal.number)
      : [...current, proposal.number]);
  };

  const proposals = data?.panel?.proposals ?? [];
  const panelMembers = data?.panel?.members ?? [];
  const panelFailed = data?.panel != null && ['failed', 'interrupted'].includes(data.panel.taskStatus);
  const revisionFailed = data?.revisionTask != null && ['failed', 'interrupted'].includes(data.revisionTask.status);
  const paused = data?.panel?.taskStatus === 'paused' || data?.revisionTask?.status === 'paused';
  const blocked = data?.panel?.taskStatus === 'blocked' || data?.revisionTask?.status === 'blocked';
  const revisionRunning = data?.revisionTask != null && activeTaskStatuses.has(data.revisionTask.status);
  const candidateReady = (data?.item.status ?? item.status) === '候选待确认' && draft.trim().length > 0;
  const fusionDraft = data?.fusionDraft ?? null;
  const selectionCount = pickedFragments.length > 0 ? pickedFragments.length : selected.length;
  const proposalPickedCount = (proposal: Proposal): number => proposal.fragments.filter((fragment) => pickedFragments.includes(fragment.fragmentId)).length;

  return <section className="setting-collaboration setting-discussion" aria-labelledby={`setting-collaboration-${item.itemKey}`}>
    <div className="setting-crumb">设定 / {item.groupTitle} / <b>{item.label}</b></div>
    <header className="setting-discussion-head">
      <h4 id={`setting-collaboration-${item.itemKey}`}>{item.label}<small>{item.prompt}</small></h4>
      <span>{data?.historyCount ?? 0} 轮记录</span>
    </header>

    {data === null ? <p className="setting-collaboration-state">正在读取当前进度……</p> : <>
      {data.panel !== null && <div className="setting-member-chips" aria-label="本轮参与成员">
        {panelMembers.map((member) => <span key={member.agentId} className="setting-member-chip">
          <i className={`setting-avatar seat-${member.roleKey}`}>{seatMark(member.roleKey)}</i>
          {member.memberName}
          <em className={`setting-dot dot-${member.status === 'completed' ? 'done' : member.status === 'failed' ? 'failed' : 'work'}`} title={memberStatusLabel(member.status)} />
        </span>)}
      </div>}
      {data.panel === null && !candidateReady && !selfWriting && <div className="setting-collaboration-start">
        <p className="setting-collaboration-state">婉儿、红玉、文姬待命，随时可以开始。</p>
        <details className="setting-collapsible-input"><summary>我有现成内容，展开补充（选填）</summary><label>已有设定原文<textarea aria-label="已有设定原文" rows={4} maxLength={10_000} value={source} onChange={(event) => setSource(event.target.value)} placeholder="可以粘贴以前写过的设定、零散想法或硬性边界；在下面选择这段话怎么用。" /></label>
          <div className="setting-idea-strength" role="radiogroup" aria-label="这段内容怎么用">
            <label className={sourceStrength === 'preference' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'preference'} onChange={() => setSourceStrength('preference')} /> <b>仅供参考</b><small>团队以专业设计为主，你的想法占两到五成</small></label>
            <label className={sourceStrength === 'must' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'must'} onChange={() => setSourceStrength('must')} /> <b>必须遵守</b><small>团队的方案不得与它冲突</small></label>
          </div>
        </details>
        <footer><span>{source.length}/10000</span><button className="primary-button" type="button" disabled={busy !== null} onClick={() => void start()}>{busy === 'start' ? '正在召集…' : '团队设计'}</button></footer>
        <div className="setting-mine-line">不想用团队的？<button type="button" onClick={() => setSelfWriting(true)}>自己写一份</button> · <button type="button" disabled={busy !== null} onClick={() => void leaveBlank()}>先留白，以后再定</button></div>
      </div>}
      {data.panel !== null && activeTaskStatuses.has(data.panel.taskStatus) && <p className="setting-collaboration-state">团队正在设计；已完成的内容会自动保留。</p>}
      {(panelFailed || revisionFailed) && <div className="setting-collaboration-error"><p>这轮没有完成，已有方案仍然保留。</p><button type="button" disabled={busy !== null} onClick={() => void retry()}>{busy === 'retry' ? '正在继续…' : '继续完成'}</button></div>}
      {paused && <div className="setting-collaboration-error"><p>任务已暂停，已有结果会保留。</p><button type="button" disabled={busy !== null} onClick={() => void resume()}>{busy === 'resume' ? '正在继续…' : '继续这项任务'}</button></div>}
      {blocked && <p className="setting-collaboration-state">任务需要先处理阻塞原因；请在任务中心查看具体说明，现有方案不会丢失。</p>}

      {proposals.length > 0 && !candidateReady && <div className="setting-proposal-grid" ref={proposalAnchor}>
        {proposals.map((proposal) => {
          const fragmentCount = proposalPickedCount(proposal);
          const wholePicked = proposal.fragments.length === 0 && selected.includes(proposal.number);
          const picked = fragmentCount > 0 || wholePicked;
          return <article className={`setting-proposal-card${picked ? ' picked' : ''}`} key={proposal.proposalId}>
            <div className="setting-proposal-who">
              <b><i className={`setting-avatar seat-${proposal.roleKey ?? ''}`}>{seatMark(proposal.roleKey)}</i>{proposal.memberName} 的方案</b>
            </div>
            <p>{proposal.content}</p>
            {proposal.fragments.map((fragment) => <label className="setting-frag" key={fragment.fragmentId}>
              <input type="checkbox" checked={pickedFragments.includes(fragment.fragmentId)} onChange={() => toggleFragment(fragment.fragmentId)} />
              <span>{fragment.text}</span>
            </label>)}
            <button type="button" className="setting-card-button primary" onClick={() => pickWholeProposal(proposal)}>
              {proposal.fragments.length > 0
                ? (fragmentCount === proposal.fragments.length && proposal.fragments.length > 0 ? '取消整份' : '整份都要')
                : (wholePicked ? '取消选用' : '整份选用')}
            </button>
            {fragmentCount > 0 && <div className="setting-picked-label">✓ 您勾选了这份里的 {fragmentCount} 段</div>}
          </article>;
        })}
      </div>}
      {proposals.length > 0 && !candidateReady && <section className="setting-author-choice">
        <details className="setting-collapsible-input"><summary>我还想补充自己的想法</summary><label>你的补充想法<textarea rows={4} maxLength={4000} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：我喜欢方案1的世界规则，但人物关系想用方案2。" /></label>
          <div className="setting-idea-strength" role="radiogroup" aria-label="这段话怎么用">
            <label className={ideaStrength === 'preference' ? 'selected' : ''}><input type="radio" name={`idea-strength-${item.itemKey}`} checked={ideaStrength === 'preference'} onChange={() => setIdeaStrength('preference')} /> <b>仅供参考</b><small>主编以专业判断为主，你的想法占两到五成</small></label>
            <label className={ideaStrength === 'must' ? 'selected' : ''}><input type="radio" name={`idea-strength-${item.itemKey}`} checked={ideaStrength === 'must'} onChange={() => setIdeaStrength('must')} /> <b>必须遵守</b><small>融合稿不得与它冲突</small></label>
          </div>
        </details>
        <footer><span>{selectionCount === 0 ? '勾选方案里的段落，或整份选用' : pickedFragments.length > 0 ? `已勾选 ${pickedFragments.length} 段` : `已选用 ${[...selected].sort((a, b) => a - b).join('、')}`}</span><button className="primary-button" type="button" disabled={busy !== null || selectionCount === 0} onClick={() => void synthesize()}>{busy === 'synthesize' ? '正在提交…' : '按我的勾选融合'}</button></footer>
      </section>}
      {revisionRunning && <p className="setting-collaboration-state">主编正在按你的勾选或修改意见融合，完成前暂不覆盖当前编辑稿。</p>}

      {fusionDraft !== null && !revisionRunning && <section className="setting-fusion" aria-label="主编融合稿">
        <div className="setting-proposal-who"><b>主编融合稿</b><span className="setting-style-tag tag-fusion">按您的勾选整理</span></div>
        <div className="setting-fusion-note">您勾了 {fusionDraft.selectedFragmentIds.length} 段，主编把它们揉成了一份通顺的设定；绿色部分是主编补的衔接。</div>
        <div className="setting-fusion-body">{fusionDraft.segments.map((segment, index) => segment.source === 'stitch'
          ? <mark key={index}>{segment.text}</mark>
          : <span key={index}>{segment.text}</span>)}</div>
        <div className="setting-fusion-actions">
          <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void saveCandidate('已确认', fusionDraft.content)}>{busy === '已确认' ? '正在确认…' : '确认这份'}</button>
          <button type="button" disabled={busy !== null} onClick={() => setSelfWriting(true)}>我再改改</button>
          <button type="button" disabled={busy !== null} onClick={() => {
            setPickedFragments([]);
            proposalAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>退回重融</button>
        </div>
        <div className="setting-mine-line">不想用团队的？<button type="button" onClick={() => { setDraft(''); setSelfWriting(true); }}>自己写一份</button> · <button type="button" disabled={busy !== null} onClick={() => void leaveBlank()}>先留白，以后再定</button></div>
      </section>}

      {(candidateReady || selfWriting) && !revisionRunning && <section className="setting-candidate-editor">
        <header><div><small>{candidateReady ? '待确认稿' : '自己写'}</small><strong>{candidateReady ? '主编已整理，可直接修改' : '写完保存或确认'}</strong></div><span>确认后仍不会直接改动已确认内容</span></header>
        <textarea aria-label="待确认设定内容" rows={10} maxLength={20_000} value={draft} disabled={revisionRunning} onChange={(event) => setDraft(event.target.value)} />
        {candidateReady && <details className="setting-collapsible-input"><summary>还想让主编定点修改？</summary><label>修改意见<textarea rows={3} maxLength={4000} value={idea} disabled={revisionRunning} onChange={(event) => setIdea(event.target.value)} placeholder="写具体修改意见；主编只按意见调整这份内容。" /></label></details>}
        <div className="setting-candidate-actions">
          {candidateReady && <button type="button" disabled={busy !== null || revisionRunning || idea.trim().length === 0} onClick={() => void revise()}>{busy === 'revise' ? '正在提交…' : '让主编按意见修改'}</button>}
          <button type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('候选待确认')}>{busy === '候选待确认' ? '正在保存…' : '保存我的修改'}</button>
          <button className="primary-button" type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('已确认')}>{busy === '已确认' ? '正在确认…' : '确认这一项'}</button>
        </div>
      </section>}
      <p className="setting-impact-note">这里的选择只影响设定候选，不会改写已写正文或已确认内容。全部必谈项完成后，系统才生成一份新的正式设定稿。</p>
    </>}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </section>;
}

function createClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `setting-idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function seatMark(roleKey: string | null): string {
  return ({ lead_screenwriter: 'A', second_screenwriter: 'B', setting: '设', chief_editor: '主', deputy_editor: '副' } as Record<string, string>)[roleKey ?? ''] ?? '·';
}

function memberStatusLabel(status: NonNullable<SettingCollaborationData['panel']>['members'][number]['status']): string {
  return ({ preparing: '准备资料', working: '构思中', completed: '方案已完成', failed: '需要处理', paused: '已暂停' } as const)[status];
}
