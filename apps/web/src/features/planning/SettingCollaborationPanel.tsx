import { useCallback, useEffect, useRef, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import {
  createAuthorPlanningInput,
  fetchSettingCollaboration,
  redesignSettingCollaborationMember,
  resumeTask,
  retryTask,
  saveSettingOutlineItem,
  startSettingCollaboration,
  restartSettingCollaboration,
  retrySettingCollaborationMember,
  reviseSettingCollaboration,
  synthesizeSettingCollaboration,
  type SettingCollaborationData,
  type SettingOutlineWorkspaceData
} from '../../lib/api/client';
import { useMembershipGate } from '../shared/membership-gate';
import { AgentAvatar } from '../shared/AgentAvatar';
import { ImeTextarea } from '../shared/ImeSafeField';

const activeTaskStatuses = new Set(['pending', 'queued', 'working']);

type Proposal = NonNullable<SettingCollaborationData['panel']>['proposals'][number];
const compatibleScreenwriters: SettingCollaborationData['screenwriters'] = [
  { agentId: null, memberName: '婉儿', roleKey: 'lead_screenwriter', availability: 'available', availabilityReason: null, highCompute: false },
  { agentId: null, memberName: '红玉', roleKey: 'second_screenwriter', availability: 'available', availabilityReason: null, highCompute: false },
  { agentId: null, memberName: '幼薇', roleKey: 'third_screenwriter', availability: 'available', availabilityReason: null, highCompute: false }
];


export function SettingCollaborationPanel({
  bookId,
  item,
  onSnapshot
}: {
  bookId: string;
  item: Pick<SettingOutlineWorkspaceData, 'itemKey' | 'groupTitle' | 'label' | 'prompt' | 'sourceLabel' | 'status' | 'custom' | 'sortOrder' | 'content' | 'pendingCandidate' | 'confirmedAt'>;
  onSnapshot: (item: SettingOutlineWorkspaceData) => void;
}): React.JSX.Element {
  const [data, setData] = useState<SettingCollaborationData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedRoleKeys, setSelectedRoleKeys] = useState<string[]>([]);
  const [pickedFragments, setPickedFragments] = useState<string[]>([]);
  const [source, setSource] = useState('');
  const [sourceStrength, setSourceStrength] = useState<'must' | 'preference'>('preference');
  const [draft, setDraft] = useState(item.pendingCandidate ?? item.content ?? '');
  const [draftEdited, setDraftEdited] = useState(false);
  const [selfWriting, setSelfWriting] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const proposalAnchor = useRef<HTMLDivElement | null>(null);
  const sourceKey = useRef<string | null>(null);
  const startKey = useRef<string | null>(null);
  const fusionKey = useRef<string | null>(null);
  const organizeInputKey = useRef<string | null>(null);
  const organizeTaskKey = useRef<string | null>(null);
  const { guardAi } = useMembershipGate();

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const next = await fetchSettingCollaboration(bookId, item.itemKey, signal);
    setData(next);
    const storedSelection = readStoredSettingSelection(bookId, item.itemKey);
    const validProposalIds = new Set(next.panel?.proposals.map((proposal) => proposal.proposalId) ?? []);
    const validFragmentIds = new Set(next.panel?.proposals.flatMap((proposal) => proposal.fragments.map((fragment) => fragment.fragmentId)) ?? []);
    const restoredSelected = storedSelection.selected.filter((proposalId) => validProposalIds.has(proposalId));
    const restoredFragments = storedSelection.pickedFragments.filter((fragmentId) => validFragmentIds.has(fragmentId));
    storeSettingSelection(bookId, item.itemKey, restoredSelected, restoredFragments);
    setSelected(restoredSelected);
    setPickedFragments(restoredFragments);
    setDraft((current) => {
      const nextDraft = next.item.pendingCandidate ?? next.item.content;
      return nextDraft === null ? current : nextDraft;
    });
    onSnapshot(next.item);
  }, [bookId, item.itemKey, onSnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    const restoredSelection = readStoredSettingSelection(bookId, item.itemKey);
    setSelected(restoredSelection.selected);
    setPickedFragments(restoredSelection.pickedFragments);
    setSource('');
    setSelfWriting(false);
    setBlankOpen(false);
    setSelectedRoleKeys([]);
    setDraft(item.pendingCandidate ?? item.content ?? '');
    setDraftEdited(false);
    void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setNotice(authorErrorFromUnknown(reason, '协作状态读取失败'));
    });
    return () => controller.abort();
  }, [item.content, item.pendingCandidate, refresh]);

  const panelStatus = data?.panel?.taskStatus ?? null;
  const revisionStatus = data?.revisionTask?.status ?? null;
  const polling = (panelStatus !== null && activeTaskStatuses.has(panelStatus))
    || (revisionStatus !== null && activeTaskStatuses.has(revisionStatus));
  useEffect(() => {
    if (!polling) return undefined;
    const timer = window.setInterval(() => {
      void refresh().catch((reason: unknown) => setNotice(authorErrorFromUnknown(reason, '协作状态刷新失败')));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  // 目标导向兜底：方案或升级前的历史整理任务意外失败时，20 秒后自动续跑一次
  //（检查点复用只补未完成的部分，不重复消耗），作者无需守着页面手动点。
  const autoRetriedTaskRef = useRef<string | null>(null);
  const failedAutoTaskId = data?.panel != null && ['failed', 'interrupted'].includes(data.panel.taskStatus)
    ? recoveryKeyOf(data.panel)
    : data?.revisionTask != null && ['failed', 'interrupted'].includes(data.revisionTask.status)
      ? recoveryKeyOf(data.revisionTask)
      : null;
  useEffect(() => {
    if (failedAutoTaskId === null || busy !== null) return undefined;
    const taskId = failedAutoTaskId;
    if (autoRetriedTaskRef.current === taskId) return undefined;
    const timer = window.setTimeout(() => {
      autoRetriedTaskRef.current = taskId;
      setBusy('retry');
      void retryTask(bookId, taskId)
        .then(() => refresh())
        .catch(() => undefined)
        .finally(() => { setBusy(null); });
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [failedAutoTaskId, busy, bookId, refresh]);

  const start = async (): Promise<void> => {
    if (busy !== null || selectedRoleKeys.length === 0) return;
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
        idempotencyKey: startKey.current,
        screenwriterRoleKeys: selectedRoleKeys
      });
      setSource('');
      clearStoredSettingSelection(bookId, item.itemKey);
      setSelected([]);
      setPickedFragments([]);
      sourceKey.current = null;
      startKey.current = null;
      setNotice(`已请 ${selectedRoleKeys.length} 位成员独立设计，完成的方案会逐份保留。`);
      setDraftEdited(false);
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '启动协作失败'));
    } finally { setBusy(null); }
  };

  const redesign = async (): Promise<void> => {
    if (busy !== null || selectedRoleKeys.length === 0) return;
    if (!guardAi()) return;
    setBusy('redesign'); setNotice(null);
    try {
      startKey.current = createClientKey();
      await restartSettingCollaboration(bookId, item.itemKey, {
        authorInputId: null,
        idempotencyKey: startKey.current,
        screenwriterRoleKeys: selectedRoleKeys
      });
      startKey.current = null;
      clearStoredSettingSelection(bookId, item.itemKey);
      setSelected([]);
      setPickedFragments([]);
      setSelectedRoleKeys([]);
      setNotice(`已请 ${selectedRoleKeys.length} 位成员重新设计，上一轮记录会保留。`);
      setDraftEdited(false);
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '重新设计失败'));
    } finally { setBusy(null); }
  };

  const redesignProposal = async (proposal: Proposal): Promise<void> => {
    if (busy !== null || proposal.roleKey === null) return;
    if (!guardAi()) return;
    const busyId = 'redesign-proposal-' + proposal.proposalId;
    setBusy(busyId);
    setNotice(null);
    try {
      await redesignSettingCollaborationMember(bookId, item.itemKey, proposal.roleKey, {
        proposalId: proposal.proposalId,
        idempotencyKey: createClientKey()
      });
      clearStoredSettingSelection(bookId, item.itemKey);
      setSelected([]);
      setPickedFragments([]);
      setNotice('已根据最新资料重新设计；新方案会与上一份实质不同，其他成功方案仍会保留。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '重新设计这份方案失败'));
    } finally {
      setBusy(null);
    }
  };

  const synthesizeSelection = async (): Promise<void> => {
    if (busy !== null) return;
    if (!guardAi()) return;
    const proposalIds = proposals
      .filter((proposal) => selected.includes(proposal.proposalId)
        || proposal.fragments.some((fragment) => pickedFragments.includes(fragment.fragmentId)))
      .map((proposal) => proposal.proposalId);
    if (proposalIds.length === 0) return;
    setBusy('fusion');
    setNotice(null);
    try {
      fusionKey.current ??= createClientKey();
      await synthesizeSettingCollaboration(bookId, item.itemKey, {
        proposalIds,
        wholeProposalIds: selected,
        fragmentIds: pickedFragments,
        authorInputId: null,
        idempotencyKey: fusionKey.current
      });
      fusionKey.current = null;
      clearStoredSettingSelection(bookId, item.itemKey);
      setSelected([]);
      setPickedFragments([]);
      setDraftEdited(false);
      setNotice('已交由主编融合。主编只会使用你选中的整案和片段，完成后形成可编辑稿。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '交由主编融合失败'));
    } finally {
      setBusy(null);
    }
  };

  const organizeDraft = async (): Promise<void> => {
    if (busy !== null || draft.trim().length === 0 || !candidateReady) return;
    if (!guardAi()) return;
    setBusy('organize');
    setNotice(null);
    try {
      organizeInputKey.current ??= createClientKey();
      const saved = await createAuthorPlanningInput(bookId, {
        surface: 'setting',
        subjectType: 'setting_module',
        subjectId: item.itemKey,
        intentStrength: 'must',
        originalText: draft.trim(),
        attachmentRefs: [],
        mentionedAgentIds: [],
        scopeNotes: `作者在“${item.label}”主编编辑稿上修改后的完整底稿；按此整理时必须保留作者修改。`,
        idempotencyKey: organizeInputKey.current
      });
      organizeTaskKey.current ??= createClientKey();
      await reviseSettingCollaboration(bookId, item.itemKey, {
        authorInputId: saved.authorInputId,
        idempotencyKey: organizeTaskKey.current
      });
      organizeInputKey.current = null;
      organizeTaskKey.current = null;
      setDraftEdited(false);
      setNotice('主编正在按你修改后的编辑稿专业化整理，不会恢复已删除内容或混入未选方案。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '按此整理失败'));
    } finally {
      setBusy(null);
    }
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
      setBlankOpen(false);
      setNotice(status === '已确认'
        ? (item.pendingCandidate != null
          ? '新方案已替换旧定稿，旧稿保留在历史版本里。'
          : '这一项已确认。它不会改写正文或已确认内容；完成全部必谈项后才生成新的正式设定稿。')
        : '修改已保存为待确认内容。');
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '设定内容保存失败'));
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
      setBlankOpen(false);
      setSelfWriting(false);
      setNotice('这一项先留白，以后随时可以回来定。');
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '操作没有完成'));
    } finally { setBusy(null); }
  };

  const retry = async (): Promise<void> => {
    const revisionFailed = data?.revisionTask != null
      && ['failed', 'interrupted'].includes(data.revisionTask.status);
    const panelFailed = data?.panel != null
      && ['failed', 'interrupted'].includes(data.panel.taskStatus);
    const taskId = revisionFailed
      ? recoveryKeyOf(data.revisionTask)
      : panelFailed
        ? recoveryKeyOf(data.panel)
        : null;
    if (taskId === null || busy !== null) return;
    setBusy('retry'); setNotice(null);
    try {
      await retryTask(bookId, taskId);
      setNotice('将继续完成尚未结束的部分，已经完成的方案会保留。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '任务重试失败'));
    } finally { setBusy(null); }
  };

  const resume = async (): Promise<void> => {
    const taskId = data?.revisionTask?.status === 'paused'
      ? recoveryKeyOf(data.revisionTask)
      : data?.panel?.taskStatus === 'paused'
        ? recoveryKeyOf(data.panel)
        : null;
    if (taskId === null || busy !== null) return;
    setBusy('resume'); setNotice(null);
    try {
      await resumeTask(bookId, taskId);
      setNotice('已经继续处理，现有结果会保留。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '任务继续失败'));
    } finally { setBusy(null); }
  };

  const visibleScreenwriters = data === null || data.screenwriters.length === 0
    ? compatibleScreenwriters
    : data.screenwriters;

  const toggleScreenwriter = (roleKey: string): void => {
    const member = visibleScreenwriters.find((candidate) => candidate.roleKey === roleKey);
    if (member?.availability !== 'available' || busy !== null) return;
    setSelectedRoleKeys((current) => current.includes(roleKey)
      ? current.filter((value) => value !== roleKey)
      : [...current, roleKey]);
  };

  const retryMember = async (roleKey: string): Promise<void> => {
    if (busy !== null) return;
    if (!guardAi()) return;
    setBusy(`retry-${roleKey}`);
    setNotice(null);
    try {
      await retrySettingCollaborationMember(bookId, item.itemKey, roleKey, createClientKey());
      setNotice('已只重试这位成员，其他已完成方案不会重跑。');
      await refresh();
    } catch (reason) {
      setNotice(authorErrorFromUnknown(reason, '单个编剧重试失败'));
    } finally {
      setBusy(null);
    }
  };

  const toggleFragment = (fragmentId: string): void => {
    setPickedFragments((current) => {
      const next = current.includes(fragmentId) ? current.filter((id) => id !== fragmentId) : [...current, fragmentId];
      storeSettingSelection(bookId, item.itemKey, selected, next);
      return next;
    });
  };

  const pickWholeProposal = (proposal: Proposal): void => {
    setSelected((current) => {
      const next = current.includes(proposal.proposalId)
        ? current.filter((proposalId) => proposalId !== proposal.proposalId)
        : [...current, proposal.proposalId];
      storeSettingSelection(bookId, item.itemKey, next, pickedFragments);
      return next;
    });
  };
  const proposals = data?.panel?.proposals ?? [];
  const panelMembers = data?.panel?.members ?? [];
  const panelFailed = data?.panel != null && ['failed', 'interrupted'].includes(data.panel.taskStatus);
  const revisionFailed = data?.revisionTask != null && ['failed', 'interrupted'].includes(data.revisionTask.status);
  const paused = data?.panel?.taskStatus === 'paused' || data?.revisionTask?.status === 'paused';
  const blocked = data?.panel?.taskStatus === 'blocked' || data?.revisionTask?.status === 'blocked';
  const revisionRunning = data?.revisionTask != null && activeTaskStatuses.has(data.revisionTask.status);
  const currentItem = data?.item ?? item;
  const hasPendingCandidate = (currentItem.pendingCandidate ?? null) !== null;
  const candidateReady = ((currentItem.status) === '候选待确认' || hasPendingCandidate) && draft.trim().length > 0;
  const fusionDraft = data?.fusionDraft ?? null;
  // 已确认条目：确认时间之前那一轮的方案和融合稿全部收起，只留"已有定稿"摘要，
  // 避免作者误以为没确认成功而重复点击；重新设计开启的新一轮（晚于确认时间）照常显示。
  const confirmedAt = currentItem.status === '已确认' ? currentItem.confirmedAt : null;
  const roundIsStale = (createdAt: string | null | undefined): boolean =>
    confirmedAt !== null && (createdAt == null || createdAt <= confirmedAt);
  const proposalsStale = roundIsStale(data?.panel?.createdAt);
  const fusionStale = roundIsStale(fusionDraft?.createdAt);
  const selectionCount = pickedFragments.length + selected.length;
  const completedMemberCount = panelMembers.filter((member) => member.status === 'completed').length;
  const failedMemberCount = panelMembers.filter((member) => ['failed', 'unavailable'].includes(member.status)).length;
  const settledMemberCount = completedMemberCount + failedMemberCount;
  const processingMemberCount = Math.max(0, panelMembers.length - settledMemberCount);
  const memberProgress = panelMembers.length === 0 ? 0 : Math.round((settledMemberCount / panelMembers.length) * 100);
  const completedMemberProgress = panelMembers.length === 0 ? 0 : (completedMemberCount / panelMembers.length) * 100;
  const failedMemberProgress = panelMembers.length === 0 ? 0 : (failedMemberCount / panelMembers.length) * 100;
  const panelActive = data?.panel !== null && data?.panel !== undefined && activeTaskStatuses.has(data.panel.taskStatus);
  const showPanelProgress = data?.panel !== null && data?.panel !== undefined && panelMembers.length > 0 && !candidateReady && !proposalsStale;
  const priorRoleKeys = new Set(panelMembers.map((member) => member.roleKey));
  const replacementScreenwriters = visibleScreenwriters.filter((member) => !priorRoleKeys.has(member.roleKey));
  const canChooseReplacement = !panelActive && proposals.length === 0 && failedMemberCount > 0
    && !candidateReady && !proposalsStale
    && replacementScreenwriters.some((member) => member.availability === 'available');
  const panelProgressTitle = panelActive
    ? `团队正在设计「${item.label}」`
    : completedMemberCount === panelMembers.length && panelMembers.length > 0
      ? `团队方案已完成「${item.label}」`
      : `团队设计进度「${item.label}」`;
  const draftChanged = candidateReady && draftEdited;
  const proposalPickedCount = (proposal: Proposal): number => proposal.fragments.filter((fragment) => pickedFragments.includes(fragment.fragmentId)).length;
  const screenwriterSelector = (members = visibleScreenwriters, title = '选择成员'): React.JSX.Element | null => data === null ? null : <div className="setting-writer-picker" aria-label={title}>
    <div className="setting-writer-picker-head">
      <strong>{title}</strong>
      <span>{selectedRoleKeys.length === 0 ? '至少选择 1 位' : `已选 ${selectedRoleKeys.length} 位，每人独立出一份方案`}</span>
    </div>
    <div className="setting-writer-options">
      {members.map((member) => {
        const picked = selectedRoleKeys.includes(member.roleKey);
        const unavailable = member.availability === 'unavailable';
        const runningMember = panelMembers.find((candidate) => candidate.roleKey === member.roleKey);
        const workStatus = runningMember === undefined
          ? unavailable ? '不可用' : picked ? '已选择' : '待命'
          : memberStatusLabel(runningMember.status);
        return <button type="button" key={member.roleKey}
          className={`setting-writer-option${picked ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}
          disabled={unavailable || busy !== null}
          aria-pressed={picked}
          onClick={() => toggleScreenwriter(member.roleKey)}>
          <AgentAvatar roleKey={member.roleKey} roleName={member.memberName} />
          <span><b>{member.memberName}<i>（{screenwriterRoleLabel(member.roleKey)}{member.highCompute ? '·高消耗' : ''}）</i></b><small>{workStatus}</small></span>
          <em>{unavailable ? '不可用' : picked ? '已选择' : '选择'}</em>
          {unavailable && member.availabilityReason !== null && <mark>{member.availabilityReason}</mark>}
        </button>;
      })}
    </div>
  </div>;

  const manualOptions = <div className="setting-manual-options">
    <div className="setting-manual-actions">
      <button type="button" aria-expanded={selfWriting} disabled={busy !== null} onClick={() => {
        setSelfWriting((open) => !open);
        setBlankOpen(false);
      }}>{selfWriting ? '收起自己写一份' : '自己写一份'}</button>
      <button type="button" aria-expanded={blankOpen} disabled={busy !== null} onClick={() => {
        setBlankOpen((open) => !open);
        setSelfWriting(false);
      }}>{blankOpen ? '收起先留白' : '先留白，以后再定'}</button>
    </div>
    {blankOpen && <div className="setting-inline-choice" role="group" aria-label="先留白，以后再定">
      <p>这一项会标记为刻意留白，之后仍可回来重新讨论。</p>
      <footer>
        <button type="button" disabled={busy !== null} onClick={() => setBlankOpen(false)}>取消</button>
        <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void leaveBlank()}>{busy === 'blank' ? '正在保存…' : '确认先留白'}</button>
      </footer>
    </div>}
  </div>;


  return <section className="setting-collaboration setting-discussion" aria-labelledby={`setting-collaboration-${item.itemKey}`}>
    <div className="setting-crumb">设定 / {item.groupTitle} / <b>{item.label}</b></div>
    <header className="setting-discussion-head">
      <h4 id={`setting-collaboration-${item.itemKey}`}>{item.label}<small>{item.prompt}</small></h4>
      <span>{data?.historyCount ?? 0} 轮记录</span>
    </header>

    {data === null ? <p className="setting-collaboration-state">正在读取当前进度……</p> : <>
      {data.panel !== null && <div className="setting-member-chips" aria-label="本轮参与成员">
        {panelMembers.map((member) => <div key={member.agentId} className={`setting-member-chip status-${member.status}`}>
          <span>
            <AgentAvatar roleKey={member.roleKey} roleName={member.memberName} />
            <b>{member.memberName}<i>（{screenwriterRoleLabel(member.roleKey)}{member.roleKey === 'senior_screenwriter' ? '·高消耗' : ''}）</i></b>
            <em className={`setting-dot dot-${member.status === 'completed' ? 'done' : ['failed', 'unavailable'].includes(member.status) ? 'failed' : 'work'}`} />
            <small>{memberStatusLabel(member.status)}</small>
          </span>
          {member.errorSummary !== null && <p>{memberRecoveryMessage(member.errorSummary)}</p>}
          {member.retryable && <button type="button" disabled={busy !== null} onClick={() => void retryMember(member.roleKey)}>
            {busy === `retry-${member.roleKey}` ? '正在补写…' : '重试这位'}
          </button>}
        </div>)}
      </div>}
      {(data.panel === null || proposalsStale) && !candidateReady && (data?.item.status ?? item.status) === '已确认' && <div className="setting-collaboration-start">
        <p className="setting-collaboration-state">这一项已定稿。需要换方向时，先选择编剧再重新设计；确认新方案前旧定稿一直有效。</p>
        {screenwriterSelector()}
        <footer><button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>{busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : '重新设计'}</button></footer>
        {manualOptions}
      </div>}
      {data.panel === null && !candidateReady && (data?.item.status ?? item.status) !== '已确认' && <div className="setting-collaboration-start">
        <p className="setting-collaboration-state">选择一位或多位成员，每位都会独立完成这一项。</p>
        {screenwriterSelector()}
        <details className="setting-collapsible-input"><summary>我已有现成内容（参考建议）</summary><label>已有设定原文<ImeTextarea aria-label="已有设定原文" rows={4} maxChars={800} value={source} onChange={setSource} placeholder="可以粘贴以前写过的设定、零散想法或硬性边界；在下面选择这段话怎么用。" /></label>
          <div className="setting-idea-strength" role="radiogroup" aria-label="这段内容怎么用">
            <label className={sourceStrength === 'preference' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'preference'} onChange={() => setSourceStrength('preference')} /> <b>仅供参考</b><small>团队以专业设计为主，你的想法占两到五成</small></label>
            <label className={sourceStrength === 'must' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'must'} onChange={() => setSourceStrength('must')} /> <b>必须遵守</b><small>团队的方案不得与它冲突</small></label>
          </div>
        </details>
        <footer><span>{source.length}/800</span><button className="primary-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void start()}>{busy === 'start' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : `请 ${selectedRoleKeys.length} 位成员出方案`}</button></footer>
        {manualOptions}
      </div>}
      {showPanelProgress && <div className="setting-design-progress" role="status">
        <strong>{panelProgressTitle}<span>已完成 {completedMemberCount}/{panelMembers.length} 份{failedMemberCount > 0 ? ` · 已失败 ${failedMemberCount}` : ''}</span></strong>
        <div className="setting-progress-track" role="progressbar" aria-label="成员方案进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={memberProgress}
          aria-valuetext={`已完成 ${completedMemberCount} 份，已失败 ${failedMemberCount} 份，处理中 ${processingMemberCount} 份`}>
          <i className="setting-progress-bar" style={{ width: `${completedMemberProgress}%` }} />
          {failedMemberProgress > 0 && <i className="setting-progress-failed" style={{ width: `${failedMemberProgress}%` }} />}
          {panelActive && processingMemberCount > 0 && <i className="setting-progress-active" aria-hidden="true" />}
        </div>
      </div>}
      {canChooseReplacement && <div className="setting-collaboration-start setting-member-replacement">
        <p className="setting-collaboration-state">原成员没有生成可用方案。可以改选其他成员继续，本轮失败记录会保留。</p>
        {screenwriterSelector(replacementScreenwriters, '改选其他成员')}
        <footer><button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>
          {busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : `请 ${selectedRoleKeys.length} 位其他成员出方案`}
        </button></footer>
      </div>}
      {(panelFailed || revisionFailed) && <div className="setting-collaboration-error">
        <p>本轮有成员没有成功返回方案。失败状态已经保存，已有结果不会被清空。</p>
        <button type="button" disabled={busy !== null} onClick={() => void retry()}>{busy === 'retry' ? '正在继续…' : '继续完成'}</button>
      </div>}
      {paused && <div className="setting-collaboration-error"><p>任务已暂停，已有结果会保留。</p><button type="button" disabled={busy !== null} onClick={() => void resume()}>{busy === 'resume' ? '正在继续…' : '继续这项任务'}</button></div>}
      {blocked && <p className="setting-collaboration-state">任务需要先处理阻塞原因；请在任务中心查看具体说明，现有方案不会丢失。</p>}

      {proposals.length > 0 && !candidateReady && !proposalsStale && !revisionRunning && <div className="setting-proposal-grid" ref={proposalAnchor}>
        {proposals.map((proposal) => {
          const fragmentCount = proposalPickedCount(proposal);
          const benefits = proposal.benefits ?? [];
          const costs = proposal.costs ?? [];
          const wholePicked = selected.includes(proposal.proposalId);
          const picked = fragmentCount > 0 || wholePicked;
          return <details className={`setting-proposal-card${picked ? ' picked' : ''}`} key={proposal.proposalId}>
            <summary>
              <span className="setting-proposal-who">
                <AgentAvatar roleKey={proposal.roleKey ?? ''} roleName={proposal.memberName} />
                <b>{proposal.memberName}<i>（{screenwriterRoleLabel(proposal.roleKey)}{proposal.roleKey === 'senior_screenwriter' ? '·高消耗' : ''}）</i></b>
                <small>{wholePicked ? '已整份选用' : fragmentCount > 0 ? `已选 ${fragmentCount} 段` : '方案已完成'}</small>
              </span>
              <span className="setting-proposal-toggle"><em className="open-label">查看方案</em><em className="close-label">收起方案</em></span>
            </summary>
            <div className="setting-proposal-body">
              <p>{proposal.content}</p>
              {(benefits.length > 0 || costs.length > 0) && <details className="setting-proposal-tradeoffs">
                <summary>这份方案的好处与取舍</summary>
                {benefits.length > 0 && <div><b>可能带来</b><ul>{benefits.map((value) => <li key={value}>{value}</li>)}</ul></div>}
                {costs.length > 0 && <div><b>需要接受</b><ul>{costs.map((value) => <li key={value}>{value}</li>)}</ul></div>}
              </details>}
              <div className="setting-fragment-list">
                {proposal.fragments.map((fragment) => <label className="setting-frag" key={fragment.fragmentId}>
                  <input type="checkbox" checked={pickedFragments.includes(fragment.fragmentId)} onChange={() => toggleFragment(fragment.fragmentId)} />
                  <span>{fragment.text}</span>
                </label>)}
              </div>
              <div className="setting-proposal-actions">
                <button type="button" className="setting-card-button primary" onClick={() => pickWholeProposal(proposal)}>
                  {wholePicked ? '取消整份' : '整份选用'}
                </button>
                <button
                  type="button"
                  className="setting-card-button ghost setting-proposal-redesign"
                  disabled={busy !== null || proposal.roleKey === null}
                  onClick={() => void redesignProposal(proposal)}
                >{busy === 'redesign-proposal-' + proposal.proposalId ? '正在重新设计…' : '重新设计'}</button>
              </div>
            </div>
          </details>;
        })}
      </div>}
      {proposals.length > 0 && !candidateReady && !proposalsStale && !revisionRunning && <section className="setting-author-choice">
        <footer><span>{selectionCount === 0 ? '展开方案后，可选整份，也可只勾喜欢的段落' : `已选 ${selected.length} 份整案、${pickedFragments.length} 段内容`}</span><button className="primary-button" type="button" disabled={busy !== null || selectionCount === 0} onClick={() => void synthesizeSelection()}>{busy === 'fusion' ? '主编正在融合…' : '交由主编融合'}</button></footer>
        <small>主编只融合你明确选中的整案和片段，形成一份可编辑稿；未选内容不会混入。</small>
        <details className="setting-redesign-box"><summary>都不满意，重新选择成员</summary>
          {screenwriterSelector()}
          <button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>{busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : '重新设计'}</button>
        </details>
        {manualOptions}
      </section>}
      {revisionRunning && <div className="setting-design-progress" role="status">
        <strong>主编正在整理「{item.label}」</strong>
        <div className="setting-progress-track" aria-hidden="true"><i className="setting-progress-bar indeterminate" /></div>
        <small>可以离开本页，已选方案和作者修改稿都会保留；完成后会生成新的可编辑稿。</small>
      </div>}

      {fusionDraft !== null && !candidateReady && !revisionRunning && !fusionStale && <details className="setting-fusion" aria-label="上次主编编辑稿">
        <summary><span><b>上次主编编辑稿</b><small>按您勾选的 {fusionDraft.selectedFragmentIds.length} 段融合</small></span><em>查看</em></summary>
        <div className="setting-fusion-body">{fusionDraft.segments.map((segment, index) => segment.source === 'stitch'
          ? <mark key={index}>{segment.text}</mark>
          : <span key={index}>{segment.text}</span>)}</div>
        <div className="setting-fusion-actions">
          <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void saveCandidate('已确认', fusionDraft.content)}>{busy === '已确认' ? '正在确认…' : '确认这份'}</button>
          <button type="button" disabled={busy !== null} onClick={() => { setDraft(fusionDraft.content); setDraftEdited(true); setSelfWriting(true); }}>我再改改</button>
          <button type="button" disabled={busy !== null} onClick={() => {
            setPickedFragments([]);
            storeSettingSelection(bookId, item.itemKey, selected, []);
            proposalAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>返回重新选择</button>
        </div>
      </details>}

      {(candidateReady || selfWriting) && !revisionRunning && <section className="setting-candidate-editor">
        <header><div><small>{candidateReady ? '主编编辑稿' : '自己写一份'}</small><strong>{candidateReady ? '可直接修改，也可以让主编按修改稿再整理一次' : '直接写出本项设定'}</strong></div><span>{hasPendingCandidate ? '确认后才替换现有定稿，旧稿留在历史版本里' : '确认前只属于本项临时编辑稿'} · {draft.length}/800</span></header>
        <ImeTextarea aria-label="待确认设定内容" rows={10} maxChars={800} value={draft} disabled={revisionRunning} onChange={(value) => { setDraft(value); setDraftEdited(true); }} />
        <div className="setting-candidate-actions">
          {selfWriting && !candidateReady && <button type="button" disabled={busy !== null} onClick={() => setSelfWriting(false)}>收起</button>}
          <button type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('候选待确认')}>{busy === '候选待确认' ? '正在保存…' : '保存修改'}</button>
          {draftChanged && <button className="primary-button" type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void organizeDraft()}>{busy === 'organize' ? '主编正在整理…' : '按此整理'}</button>}
          <button className={draftChanged ? '' : 'primary-button'} type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('已确认')}>{busy === '已确认' ? '正在确认…' : draftChanged ? '直接确认' : '确认这一项'}</button>
        </div>
      </section>}
    </>}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </section>;
}

type StoredSettingSelection = { selected: string[]; pickedFragments: string[] };

function settingSelectionStorageKey(bookId: string, itemKey: string): string {
  return `wenmi-setting-proposal-selection-v1-${bookId}-${itemKey}`;
}

function readStoredSettingSelection(bookId: string, itemKey: string): StoredSettingSelection {
  try {
    const raw = window.sessionStorage.getItem(settingSelectionStorageKey(bookId, itemKey));
    if (raw === null) return { selected: [], pickedFragments: [] };
    const parsed = JSON.parse(raw) as Partial<StoredSettingSelection>;
    return {
      selected: Array.isArray(parsed.selected) ? parsed.selected.filter((value): value is string => typeof value === 'string') : [],
      pickedFragments: Array.isArray(parsed.pickedFragments) ? parsed.pickedFragments.filter((value): value is string => typeof value === 'string') : []
    };
  } catch {
    return { selected: [], pickedFragments: [] };
  }
}

function storeSettingSelection(bookId: string, itemKey: string, selected: string[], pickedFragments: string[]): void {
  try {
    window.sessionStorage.setItem(settingSelectionStorageKey(bookId, itemKey), JSON.stringify({ selected, pickedFragments }));
  } catch { /* 私密模式或存储满时不阻断当前选择 */ }
}

function clearStoredSettingSelection(bookId: string, itemKey: string): void {
  try { window.sessionStorage.removeItem(settingSelectionStorageKey(bookId, itemKey)); } catch { /* 无持久存储时忽略 */ }
}
function createClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `setting-idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


function memberRecoveryMessage(errorSummary: string): string {
  return errorSummary.replace('请只重试这位。', '可重试这位，也可改选其他成员。');
}

function screenwriterRoleLabel(roleKey: string | null): string {
  return roleKey === 'senior_screenwriter' ? '高级编剧' : '编剧';
}
function memberStatusLabel(status: NonNullable<SettingCollaborationData['panel']>['members'][number]['status']): string {
  return ({ preparing: '工作中', working: '工作中', completed: '已完成', failed: '已失败', unavailable: '已失败', paused: '已暂停' } as const)[status];
}

function recoveryKeyOf(value: { recoveryKey?: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const compatible = value as { recoveryKey?: string; taskId?: string };
  return compatible.recoveryKey ?? compatible.taskId ?? null;
}
