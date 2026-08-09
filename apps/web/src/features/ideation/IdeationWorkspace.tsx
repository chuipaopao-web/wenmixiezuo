import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, LightbulbIcon, PaperPlaneTiltIcon, UsersThreeIcon } from '@phosphor-icons/react';
import {
  fetchIdeationMembers,
  fetchIdeationRounds,
  promoteIdeationOpinion,
  startIdeationRound,
  type IdeationMemberData,
  type IdeationRoundData
} from '../../lib/api/client';
import type { AuthorInputSurface } from '@wenmi/contracts';

type CreationLocation = 'framework' | 'basic' | 'master' | 'event' | 'chapter' | 'manuscript' | 'library' | 'naming';

export function IdeationWorkspace({
  bookId,
  currentLocation,
  onError
}: {
  bookId: string;
  currentLocation: CreationLocation;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const [members, setMembers] = useState<IdeationMemberData[]>([]);
  const [rounds, setRounds] = useState<IdeationRoundData[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [promotedOpinionIds, setPromotedOpinionIds] = useState<string[]>([]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [nextMembers, nextRounds] = await Promise.all([
      fetchIdeationMembers(bookId, signal), fetchIdeationRounds(bookId, signal)
    ]);
    setMembers(nextMembers);
    setRounds(nextRounds);
    setSelectedIds((current) => {
      const valid = current.filter((id) => nextMembers.some((member) => member.agentId === id));
      if (valid.length > 0) return valid;
      const host = nextMembers.find((member) => member.host);
      return [host, ...nextMembers.filter((member) => member.agentId !== host?.agentId).slice(0, 2)]
        .filter((member): member is IdeationMemberData => member !== undefined)
        .map((member) => member.agentId);
    });
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : '灵感讨论加载失败');
    });
    const timer = window.setInterval(() => {
      if (rounds.some((round) => ['pending', 'queued', 'working'].includes(round.status))) {
        void refresh().catch(() => undefined);
      }
    }, 2500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [onError, refresh, rounds]);

  const selectedMembers = useMemo(
    () => members.filter((member) => selectedIds.includes(member.agentId)),
    [members, selectedIds]
  );

  const toggleMember = (member: IdeationMemberData): void => {
    if (member.host) return;
    setSelectedIds((current) => {
      if (current.includes(member.agentId)) return current.filter((id) => id !== member.agentId);
      if (current.length >= 3) return current;
      return [...current, member.agentId];
    });
  };

  const send = async (): Promise<void> => {
    if (message.trim().length === 0 || selectedIds.length < 2) return;
    setBusy(true);
    try {
      await startIdeationRound(bookId, {
        message: message.trim(),
        participantAgentIds: selectedIds,
        idempotencyKey: `web-${crypto.randomUUID()}`
      });
      setMessage('');
      await refresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '无法发起讨论');
    } finally {
      setBusy(false);
    }
  };

  const promote = async (roundId: string, opinionId: string): Promise<void> => {
    const target = promotionTarget(bookId, currentLocation);
    setBusy(true);
    try {
      await promoteIdeationOpinion(bookId, roundId, {
        opinionId,
        ...target,
        intentStrength: 'inspiration',
        scopeNotes: `作者在“${locationLabel(currentLocation)}”查看时选中`,
        idempotencyKey: `ideation-promote-${opinionId}-${target.surface}`
      });
      setPromotedOpinionIds((current) => [...new Set([...current, opinionId])]);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '无法转为作者意见');
    } finally {
      setBusy(false);
    }
  };

  return <section className="ideation-workspace">
    <header className="ideation-hero">
      <div><span className="eyebrow"><LightbulbIcon />独立灵感空间</span><h2>和成员分身聊剧情</h2>
        <p>这里只讨论，不会修改正式内容。需要的建议必须由你明确选中，才会挂到当前创作阶段。</p></div>
      <div className="ideation-safety-note"><CheckCircleIcon /><span><strong>生产隔离已开启</strong><small>讨论内容不会自动进入设定、卷纲、事件、章纲或正文</small></span></div>
    </header>

    <div className="ideation-layout">
      <aside className="ideation-member-panel">
        <div className="section-heading"><span><UsersThreeIcon />本轮成员</span><small>{selectedIds.length}/3</small></div>
        <p className="muted-copy">主编分身固定主持，再选1—2名成员。成员使用本书资料，但没有正式写入权限。</p>
        <div className="ideation-member-list">{members.map((member) => {
          const selected = selectedIds.includes(member.agentId);
          return <button type="button" key={member.agentId} className={selected ? 'selected' : ''}
            onClick={() => toggleMember(member)} aria-pressed={selected}>
            <span className="member-monogram">{member.displayName.slice(0, 1)}</span>
            <span><strong>{member.displayName}{member.host ? ' · 主持' : ''}</strong><small>{member.roleName}</small><em>{member.provider} / {member.modelId}</em></span>
            <i>{selected ? '已选' : '选择'}</i>
          </button>;
        })}</div>
      </aside>

      <div className="ideation-conversation">
        <div className="ideation-rounds">{rounds.length === 0
          ? <div className="ideation-empty"><LightbulbIcon /><h3>先说说你正在琢磨什么</h3><p>例如：主角第一次反击怎样既爽又不显得降智？</p></div>
          : rounds.map((round) => <article className="ideation-round" key={round.roundId}>
              <div className="author-bubble"><small>你的想法</small><p>{round.authorMessage}</p></div>
              {round.responses.length === 0
                ? <div className="ai-thinking"><span />{round.status === 'failed' ? `讨论失败：${round.errorCode ?? '未知原因'}` : `${round.phase === 'collecting' ? '成员正在独立思考' : '正在整理建议'}…`}</div>
                : <div className="ideation-responses">{round.responses.map((response) => {
                    const promoted = promotedOpinionIds.includes(response.opinionId);
                    return <section className="idea-response-card" key={response.opinionId}>
                      <header><span className="member-monogram">{response.memberName.slice(0, 1)}</span><span><strong>{response.memberName}</strong><small>{response.provider} / {response.modelId}</small></span></header>
                      <p>{response.content}</p>
                      <button type="button" disabled={busy || promoted} onClick={() => void promote(round.roundId, response.opinionId)}>
                        {promoted ? <><CheckCircleIcon />已转为作者意见</> : `选中这段，挂到${locationLabel(currentLocation)}`}
                      </button>
                    </section>;
                  })}</div>}
            </article>)}</div>
        <footer className="ideation-composer">
          <div className="selected-member-summary">本轮：{selectedMembers.map((member) => member.displayName).join('、') || '尚未选择成员'}</div>
          <div><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={6000}
            placeholder="输入你的剧情疑问或灵感……只讨论，不会自动改书。" />
            <button className="primary-button" type="button" disabled={busy || message.trim().length === 0 || selectedIds.length < 2} onClick={() => void send()}>
              <PaperPlaneTiltIcon />{busy ? '处理中…' : '召集讨论'}
            </button></div>
        </footer>
      </div>
    </div>
  </section>;
}

function promotionTarget(bookId: string, location: CreationLocation): {
  surface: AuthorInputSurface; subjectType: string; subjectId: string | null;
} {
  if (location === 'basic') return { surface: 'setting', subjectType: 'setting', subjectId: null };
  if (location === 'master') return { surface: 'volume_plan', subjectType: 'volume_plan', subjectId: null };
  if (location === 'event') return { surface: 'event', subjectType: 'story_event', subjectId: null };
  if (location === 'chapter') return { surface: 'chapter_outline', subjectType: 'chapter_outline', subjectId: null };
  if (location === 'manuscript') return { surface: 'manuscript', subjectType: 'manuscript', subjectId: null };
  return { surface: 'book_profile', subjectType: 'book', subjectId: bookId };
}

function locationLabel(location: CreationLocation): string {
  return ({
    framework: '本书资料', basic: '设定大纲', master: '当前卷纲', event: '事件设计',
    chapter: '章纲', manuscript: '正文', library: '故事资料库', naming: '取名'
  })[location];
}
