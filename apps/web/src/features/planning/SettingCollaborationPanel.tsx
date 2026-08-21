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
  const [selfWriting, setSelfWriting] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const proposalAnchor = useRef<HTMLDivElement | null>(null);
  const sourceKey = useRef<string | null>(null);
  const startKey = useRef<string | null>(null);
  const { guardAi } = useMembershipGate();

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const next = await fetchSettingCollaboration(bookId, item.itemKey, signal);
    setData(next);
    setDraft((current) => {
      const nextDraft = next.item.pendingCandidate ?? next.item.content;
      return nextDraft === null ? current : nextDraft;
    });
    onSnapshot(next.item);
  }, [bookId, item.itemKey, onSnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected([]);
    setPickedFragments([]);
    setSource('');
    setSelfWriting(false);
    setBlankOpen(false);
    setSelectedRoleKeys([]);
    setDraft(item.pendingCandidate ?? item.content ?? '');
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
      sourceKey.current = null;
      startKey.current = null;
      setNotice(`已请 ${selectedRoleKeys.length} 位成员独立设计，完成的方案会逐份保留。`);
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
      setSelected([]);
      setPickedFragments([]);
      setNotice(`已请 ${selectedRoleKeys.length} 位成员重新设计，旧定稿仍然有效。`);
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

  const composeSelection = (): void => {
    if (busy !== null) return;
    const parts: string[] = [];
    for (const proposal of proposals) {
      if (selected.includes(proposal.proposalId)) {
        parts.push(proposal.content.trim());
        continue;
      }
      for (const fragment of proposal.fragments) {
        if (pickedFragments.includes(fragment.fragmentId)) parts.push(fragment.text.trim());
      }
    }
    const content = [...new Set(parts.filter((value) => value.length > 0))].join('\n\n');
    if (content.length === 0) return;
    setDraft(content);
    setSelfWriting(true);
    setNotice('已把你选中的内容放进可编辑稿。你可以直接删改，确认前不会写入正式设定。');
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
    setPickedFragments((current) => current.includes(fragmentId)
      ? current.filter((id) => id !== fragmentId)
      : [...current, fragmentId]);
  };

  const pickWholeProposal = (proposal: Proposal): void => {
    setSelected((current) => current.includes(proposal.proposalId)
      ? current.filter((proposalId) => proposalId !== proposal.proposalId)
      : [...current, proposal.proposalId]);
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
  const proposalPickedCount = (proposal: Proposal): number => proposal.fragments.filter((fragment) => pickedFragments.includes(fragment.fragmentId)).length;
  const screenwriterSelector = data === null ? null : <div className="setting-writer-picker" aria-label="选择成员">
    <div className="setting-writer-picker-head">
      <strong>选择成员</strong>
      <span>{selectedRoleKeys.length === 0 ? '至少选择 1 位' : `已选 ${selectedRoleKeys.length} 位，每人独立出一份方案`}</span>
    </div>
    <div className="setting-writer-options">
      {visibleScreenwriters.map((member) => {
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
          <span><b>{member.memberName}</b><small>{workStatus}</small></span>
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
            <b>{member.memberName}</b>
            <em className={`setting-dot dot-${member.status === 'completed' ? 'done' : ['failed', 'unavailable'].includes(member.status) ? 'failed' : 'work'}`} />
            <small>{memberStatusLabel(member.status)}</small>
          </span>
          {member.errorSummary !== null && <p>{member.errorSummary}</p>}
          {member.retryable && <button type="button" disabled={busy !== null} onClick={() => void retryMember(member.roleKey)}>
            {busy === `retry-${member.roleKey}` ? '正在补写…' : '只重试这位'}
          </button>}
        </div>)}
      </div>}
      {(data.panel === null || proposalsStale) && !candidateReady && (data?.item.status ?? item.status) === '已确认' && <div className="setting-collaboration-start">
        <p className="setting-collaboration-state">这一项已定稿。需要换方向时，先选择编剧再重新设计；确认新方案前旧定稿一直有效。</p>
        {screenwriterSelector}
        <footer><button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>{busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : '重新设计'}</button></footer>
        {manualOptions}
      </div>}
      {data.panel === null && !candidateReady && (data?.item.status ?? item.status) !== '已确认' && <div className="setting-collaboration-start">
        <p className="setting-collaboration-state">选择一位或多位成员，每位都会独立完成这一项。</p>
        {screenwriterSelector}
        <details className="setting-collapsible-input"><summary>我已有现成内容（参考建议）</summary><label>已有设定原文<ImeTextarea aria-label="已有设定原文" rows={4} maxChars={800} value={source} onChange={setSource} placeholder="可以粘贴以前写过的设定、零散想法或硬性边界；在下面选择这段话怎么用。" /></label>
          <div className="setting-idea-strength" role="radiogroup" aria-label="这段内容怎么用">
            <label className={sourceStrength === 'preference' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'preference'} onChange={() => setSourceStrength('preference')} /> <b>仅供参考</b><small>团队以专业设计为主，你的想法占两到五成</small></label>
            <label className={sourceStrength === 'must' ? 'selected' : ''}><input type="radio" name={`source-strength-${item.itemKey}`} checked={sourceStrength === 'must'} onChange={() => setSourceStrength('must')} /> <b>必须遵守</b><small>团队的方案不得与它冲突</small></label>
          </div>
        </details>
        <footer><span>{source.length}/800</span><button className="primary-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void start()}>{busy === 'start' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : `请 ${selectedRoleKeys.length} 位成员出方案`}</button></footer>
        {manualOptions}
      </div>}
      {data.panel !== null && activeTaskStatuses.has(data.panel.taskStatus) && <div className="setting-design-progress" role="status">
        <strong>团队正在设计「{item.label}」</strong>
        <div className="setting-progress-track" aria-hidden="true"><i className="setting-progress-bar indeterminate" /></div>
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
          return <article className={`setting-proposal-card${picked ? ' picked' : ''}`} key={proposal.proposalId}>
            <div className="setting-proposal-who">
              <b><AgentAvatar roleKey={proposal.roleKey ?? ''} roleName={proposal.memberName} />{proposal.memberName}方案</b>
            </div>
            <p>{proposal.content}</p>
            {(benefits.length > 0 || costs.length > 0) && <details className="setting-proposal-tradeoffs">
              <summary>这份方案的好处与取舍</summary>
              {benefits.length > 0 && <div><b>可能带来</b><ul>{benefits.map((value) => <li key={value}>{value}</li>)}</ul></div>}
              {costs.length > 0 && <div><b>需要接受</b><ul>{costs.map((value) => <li key={value}>{value}</li>)}</ul></div>}
            </details>}
            {proposal.fragments.map((fragment) => <label className="setting-frag" key={fragment.fragmentId}>
              <input type="checkbox" checked={pickedFragments.includes(fragment.fragmentId)} onChange={() => toggleFragment(fragment.fragmentId)} />
              <span>{fragment.text}</span>
            </label>)}
            <button type="button" className="setting-card-button primary" onClick={() => pickWholeProposal(proposal)}>
              {wholePicked ? '取消整份' : '整份选用'}
            </button>
            <button
              type="button"
              className="setting-card-button ghost setting-proposal-redesign"
              disabled={busy !== null || proposal.roleKey === null}
              onClick={() => void redesignProposal(proposal)}
            >{busy === 'redesign-proposal-' + proposal.proposalId ? '正在重新设计…' : '重新设计'}</button>
            {fragmentCount > 0 && <div className="setting-picked-label">✓ 您勾选了这份里的 {fragmentCount} 段</div>}
          </article>;
        })}
      </div>}
      {proposals.length > 0 && !candidateReady && !proposalsStale && !revisionRunning && <section className="setting-author-choice">
        <footer><span>{selectionCount === 0 ? '可选整份，也可只勾喜欢的段落' : `已选 ${selected.length} 份整案、${pickedFragments.length} 段内容`}</span><button className="primary-button" type="button" disabled={busy !== null || selectionCount === 0} onClick={composeSelection}>整理成可编辑稿</button></footer>
        <small>这里不调用主编。系统只把你选中的原文放进编辑稿，由你直接删改和确认；主编会在全部设定完成后统一审查。</small>
        <details className="setting-redesign-box"><summary>都不满意，重新选择成员</summary>
          {screenwriterSelector}
          <button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>{busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : '重新设计'}</button>
        </details>
        {manualOptions}
      </section>}      {revisionRunning && <div className="setting-design-progress" role="status">
        <strong>正在恢复旧版整理任务</strong>
        <div className="setting-progress-track" aria-hidden="true"><i className="setting-progress-bar indeterminate" /></div>
        <small>这是升级前已经开始的旧任务，完成前不会覆盖当前编辑稿。</small>
      </div>}

      {fusionDraft !== null && !revisionRunning && !fusionStale && <section className="setting-fusion" aria-label="历史整理稿">
        <div className="setting-proposal-who"><b>历史整理稿</b><span className="setting-style-tag tag-fusion">按您的勾选整理</span></div>
        <div className="setting-fusion-note">您勾了 {fusionDraft.selectedFragmentIds.length} 段，旧版流程曾把它们整理成一份设定；绿色部分是主编补的衔接。</div>
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
        <details className="setting-redesign-box"><summary>都不满意，重新设计</summary>
          {screenwriterSelector}
          <button className="primary-button setting-redesign-button" type="button" disabled={busy !== null || selectedRoleKeys.length === 0} onClick={() => void redesign()}>{busy === 'redesign' ? '正在召集…' : selectedRoleKeys.length === 0 ? '请先选择成员' : '重新设计'}</button>
        </details>
        {proposals.length === 0 && manualOptions}
      </section>}

      {(candidateReady || selfWriting) && !revisionRunning && <section className="setting-candidate-editor">
        <header><div><small>{candidateReady ? '待确认稿' : '可编辑稿'}</small><strong>{candidateReady ? '方案已放入编辑稿，可直接修改' : '直接修改后保存或确认'}</strong></div><span>{hasPendingCandidate ? '确认后才替换现有定稿，旧稿留在历史版本里' : '确认后仍不会直接改动已确认内容'}</span></header>
        <ImeTextarea aria-label="待确认设定内容" rows={10} maxChars={20_000} value={draft} disabled={revisionRunning} onChange={setDraft} />
        <div className="setting-candidate-actions">
          {selfWriting && !candidateReady && <button type="button" disabled={busy !== null} onClick={() => setSelfWriting(false)}>收起</button>}
          <button type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('候选待确认')}>{busy === '候选待确认' ? '正在保存…' : '保存我的修改'}</button>
          <button className="primary-button" type="button" disabled={busy !== null || revisionRunning || draft.trim().length === 0} onClick={() => void saveCandidate('已确认')}>{busy === '已确认' ? '正在确认…' : '确认这一项'}</button>
        </div>
      </section>}
    </>}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </section>;
}

function createClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `setting-idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


function memberStatusLabel(status: NonNullable<SettingCollaborationData['panel']>['members'][number]['status']): string {
  return ({ preparing: '等待开始', working: '设计中', completed: '方案已完成', failed: '设计失败', unavailable: '当前不可用', paused: '已暂停' } as const)[status];
}

function recoveryKeyOf(value: { recoveryKey?: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const compatible = value as { recoveryKey?: string; taskId?: string };
  return compatible.recoveryKey ?? compatible.taskId ?? null;
}
