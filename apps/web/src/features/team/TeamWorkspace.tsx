import { useCallback, useEffect, useState } from 'react';
import { EyeIcon, XIcon } from '@phosphor-icons/react';
import {
  fetchProtectedRolePrompt,
  fetchTeamConfig,
  saveAgentPromptPreference,
  type AgentData,
  type BookData,
  type ProtectedRolePromptData,
  type TaskData,
  type TeamConfigData,
  type TeamTemplateData,
  type WorkerData,
  type WorkspaceData
} from '../../lib/api/client';
import { toAuthorFacingText } from '../../app/author-presentation';
import { bookDisplayTitle } from '../../app/display-labels';
import { AgentAvatar } from '../shared/AgentAvatar';
import { WorkspaceSkeleton } from '../shared/WorkspaceSkeleton';
import { ImeTextarea } from '../shared/ImeSafeField';
import { memberIdentity } from '../shared/agent-presentation';
import {
  isActiveTask,
  phaseLabel,
  statusLabel,
  taskChapterFromBrief,
  taskCheckpointLabel,
  taskGoal
} from '../shared/task-presentation';

function ProtectedPromptViewer({ roleKey, configured, bookId, agentId }: {
  roleKey: string;
  configured: boolean;
  bookId?: string;
  agentId?: string;
}): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<ProtectedRolePromptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const unlock = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (password.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProtectedRolePrompt({
        password,
        roleKey,
        ...(bookId === undefined ? {} : { bookId }),
        ...(agentId === undefined ? {} : { agentId })
      });
      setResult(next);
      setPassword('');
    } catch (reason) {
      setResult(null);
      setPassword('');
      setError(reason instanceof Error ? reason.message : '完整提示词暂时无法查看');
    } finally {
      setLoading(false);
    }
  };

  if (result !== null) {
    return <section className="protected-prompt-view" aria-label={`${result.identity}完整提示词`}>
      <div className="protected-prompt-heading">
        <span><h3>完整运行提示词</h3><p>{result.note}</p></span>
        <button className="secondary-button" type="button" onClick={() => setResult(null)}>锁定</button>
      </div>
      <div className="protected-prompt-variants">
        {result.variants.map((variant) => <details key={variant.purpose} open={result.variants.length === 1}>
          <summary>{variant.label}</summary>
          <pre>{variant.prompt}</pre>
        </details>)}
      </div>
    </section>;
  }

  return <section className="protected-prompt-view locked">
    <div className="protected-prompt-heading">
      <span><h3><EyeIcon />查看完整提示词</h3><p>完整内容受密码保护，不会提前发送到浏览器，也不会保存查看密码。</p></span>
    </div>
    {!configured ? <p className="protected-prompt-unconfigured">管理员尚未设置查看密码，请先配置 WENMI_PROMPT_VIEW_PASSWORD 并重启应用。</p> : (
      <form className="protected-prompt-form" onSubmit={(event) => void unlock(event)}>
        <label htmlFor={`prompt-password-${roleKey}-${agentId ?? 'template'}`}>完整提示词查看密码</label>
        <div>
          <input
            id={`prompt-password-${roleKey}-${agentId ?? 'template'}`}
            type="password"
            autoComplete="off"
            value={password}
            maxLength={1024}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={loading || password.length === 0}>{loading ? '验证中…' : '解锁查看'}</button>
        </div>
      </form>
    )}
    {error !== null && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

export function TeamWorkspace({ bookId, workspace, onError }: {
  bookId: string;
  workspace: WorkspaceData | null;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const [config, setConfig] = useState<TeamConfigData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchTeamConfig(bookId, signal).then((next) => {
      setConfig(next);
      setSelectedId((current) => current !== null && next.members.some((member) => member.agentId === current)
        ? current
        : next.members[0]?.agentId ?? null);
    });
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : '团队配置加载失败');
    });
    return () => controller.abort();
  }, [load, onError]);

  const member = config?.members.find((item) => item.agentId === selectedId) ?? null;
  const memberTask = member === null ? null : activeTaskForAgent(workspace, member.agentId);
  useEffect(() => {
    setDraft(member?.promptPreference.content ?? '');
    setNotice(null);
  }, [member?.agentId, member?.promptPreference.version]);

  const save = async (content: string): Promise<void> => {
    if (member === null || config === null) return;
    setSaving(true);
    setNotice(null);
    try {
      const preference = await saveAgentPromptPreference(
        bookId,
        member.agentId,
        member.promptPreference.version,
        content
      );
      setConfig({
        ...config,
        members: config.members.map((item) => item.agentId === member.agentId
          ? { ...item, promptPreference: preference }
          : item)
      });
      setDraft(preference.content);
      setNotice(content.trim().length === 0 ? '已恢复默认要求，新任务开始生效。' : '已保存，新任务开始生效。');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '提示词保存失败');
      await load().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  if (config === null) return <WorkspaceSkeleton />;
  return (
    <section className="team-workspace" aria-labelledby="team-workspace-title">
      <header className="team-workspace-header">
        <h2 id="team-workspace-title" className="sr-only">团队配置</h2>
        <span className="team-count">{config.members.length} 名成员</span>
      </header>
      <div className="team-config-layout">
        <nav className="team-member-list" aria-label="团队成员">
          {config.members.map((item) => {
            const task = activeTaskForAgent(workspace, item.agentId);
            return <button className={item.agentId === selectedId ? 'team-member-card active' : 'team-member-card'} type="button" key={item.agentId} onClick={() => setSelectedId(item.agentId)}>
              <AgentAvatar roleKey={item.roleKey} roleName={memberIdentity(item)} />
              <span><strong>{memberIdentity(item)}</strong><small>{toAuthorFacingText(item.publicSummary ?? item.roleName)}</small></span>
              <i>{item.activationState === 'disabled'
                ? '成员已停用'
                : item.availability === 'unavailable'
                  ? (item.availabilityReason ?? '暂不能创作')
                : task === null
                  ? (item.activationState === 'standby' ? '在线·待命' : '在线·空闲')
                  : '有活动任务'}</i>
            </button>;
          })}
        </nav>
        {member !== null && (
          <article className="team-member-editor">
            <header>
              <div className="agent-dialog-identity"><AgentAvatar roleKey={member.roleKey} roleName={memberIdentity(member)} /><span><h3>{memberIdentity(member)}</h3><p>{toAuthorFacingText(member.publicSummary ?? '未记录')}</p></span></div>
            </header>
            <section className="team-live-task-card">
              <header><h3>当前工作状态</h3><span className={memberTask === null ? 'idle' : 'working'}>{memberTask === null ? '空闲' : statusLabel(memberTask.status)}</span></header>
              {memberTask === null
                ? <p>当前没有分配给这名成员的任务；成员保持在线待命。</p>
                : <dl>
                  <div><dt>正在做什么</dt><dd>{taskGoal(memberTask, taskChapterFromBrief(memberTask))}</dd></div>
                  <div><dt>当前阶段</dt><dd>{phaseLabel(memberTask.currentPhase)}</dd></div>
                  <div><dt>本轮参考</dt><dd>{memberContextSummary(memberTask)}</dd></div>
                  <div><dt>当前结果</dt><dd>{taskCheckpointLabel(memberTask.checkpoint)}</dd></div>
                </dl>}
            </section>
            <div className="agent-detail-groups">
              {([
                ['岗位职责', member.responsibilities ?? []],
                ['负责什么', member.boundaries ?? []],
                ['检索重点', member.retrievalFocus ?? []],
                ['交付内容', member.outputKinds ?? []]
              ] as const).map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length === 0 ? <p>暂无内容</p> : <ul>{items.map((item) => <li key={item}>{toAuthorFacingText(item)}</li>)}</ul>}</section>)}
            </div>
            <section className="default-prompt-view">
              <div>
                <h3>岗位表达</h3>
                <p>默认只显示容易理解的岗位身份和主要职责。</p>
              </div>
              <p>{toAuthorFacingText(member.roleStatement)}</p>
            </section>
            <ProtectedPromptViewer
              key={`${bookId}-${member.agentId}`}
              roleKey={member.roleKey}
              configured={config.promptPolicy.fullPromptAccess?.configured ?? false}
              bookId={bookId}
              agentId={member.agentId}
            />
            <section className="prompt-editor">
              <div className="prompt-editor-heading">
                <span><h3>{toAuthorFacingText(config.promptPolicy.editableLabel)}</h3><p>{toAuthorFacingText(config.promptPolicy.priority)}</p></span>
                <small>{member.promptPreference.version > 0 ? '已保存本书要求' : '使用默认要求'}</small>
              </div>
              <ImeTextarea
                value={draft}
                maxChars={config.promptPolicy.maxChars}
                aria-label={`${memberIdentity(member)}的本书岗位补充要求`}
                placeholder={`例如：为《${workspace === null ? '本书' : bookDisplayTitle(workspace.book.title)}》工作时，重点关注……`}
                onChange={setDraft}
              />
              <div className="prompt-editor-actions">
                <small>{draft.length}/{config.promptPolicy.maxChars} 字符　系统原始提示词和不能改变的安全要求不能在这里编辑。</small>
                <span>
                  <button className="secondary-button" type="button" disabled={saving || member.promptPreference.version === 0} onClick={() => void save('')}>恢复默认</button>
                  <button className="primary-button" type="button" disabled={saving || draft.trim() === member.promptPreference.content} onClick={() => void save(draft)}>{saving ? '保存中' : '保存提示词'}</button>
                </span>
              </div>
              {notice !== null && <p className="inline-success" role="status">{notice}</p>}
            </section>
          </article>
        )}
      </div>
    </section>
  );
}

function memberContextSummary(task: TaskData): string {
  const purpose = typeof task.brief.purpose === 'string' ? task.brief.purpose : '';
  const settingItem = typeof task.brief.settingItemKey === 'string' ? task.brief.settingItemKey : '';
  const chapter = taskChapterFromBrief(task);
  if (settingItem.length > 0) return `本书开书资料、当前设定项（${settingItem}）、已确认前置设定和作者本项原话`;
  if (chapter !== '全书任务') return `分卷、事件链、事件大纲、完整${chapter}章纲和相关正式原文`;
  if (purpose.includes('volume')) return '本书开书资料、活动设定、当前卷目标、作者卷想法与相关已确认内容';
  if (purpose.includes('event')) return '活动卷纲、完整事件链、当前事件、作者想法与相关人物/因果证据';
  return '根据当前任务冻结的本书当前已确认内容和需要用到的前文资料';
}

export function TeamInspector({ workspace, worker, onSelectAgent }: { workspace: WorkspaceData | null; worker: WorkerData | null; onSelectAgent: (agent: AgentData) => void }): React.JSX.Element {
  const agents = workspace?.agents ?? [];
  return (
    <div className="inspector-content team-inspector">
      <section className="inspector-section">
        <div className="inspector-heading"><h2>团队</h2><span>{agents.length} 名成员</span></div>
        <div className="agent-list">{agents.map((agent) => <AgentRow key={agent.agentId} agent={agent} task={activeTaskForAgent(workspace, agent.agentId)} worker={worker} onSelect={() => onSelectAgent(agent)} />)}</div>
      </section>
    </div>
  );
}

function AgentRow({ agent, task, worker, onSelect }: { agent: AgentData; task: TaskData | null; worker: WorkerData | null; onSelect: () => void }): React.JSX.Element {
  const presence = agentPresence(agent, task, worker);
  const identity = memberIdentity(agent);
  return (
    <button type="button" className="agent-row" title={`${identity}，${agent.publicSummary ?? ''}`} aria-label={`${identity}，${presence.label}，打开岗位详情`} onClick={onSelect}>
      <AgentAvatar roleKey={agent.roleKey} roleName={identity} />
      <span className="agent-copy"><strong>{identity}</strong><small>{agent.publicSummary ?? roleSummary(agent.roleKey)}</small><em className={presence.className}><span className="agent-state" aria-hidden="true" />{presence.label}</em></span>
    </button>
  );
}

export function activeTaskForAgent(workspace: WorkspaceData | null, agentId: string): TaskData | null {
  if (workspace === null) return null;
  const tasks = workspace.tasks.filter((task) => task.assignedAgentId === agentId && isActiveTask(task.status));
  return tasks.find((task) => task.status === 'working')
    ?? tasks.find((task) => task.status === 'queued' || task.status === 'pending')
    ?? tasks[0]
    ?? null;
}

function agentPresence(agent: AgentData, task: TaskData | null, worker: WorkerData | null): { label: string; className: string } {
  if (agent.activationState === 'disabled') return { label: '成员已停用', className: 'offline' };
  if (agent.availability === 'unavailable') return { label: agent.availabilityReason ?? '暂不能创作', className: 'offline' };
  if (agent.activationState === 'paused') return { label: '在线·暂停', className: 'standby' };
  if (task === null) return agent.activationState === 'standby'
    ? { label: '在线·待命', className: 'standby' }
    : { label: '在线·空闲', className: 'standby' };
  // P0-2 / R02: blocked/interrupted 不表示成员正在工作，只显示在任务中心，
  // 不把成员伪装成持续工作或“需要处理”；waiting_confirmation 显示等待老板。
  if (task.status === 'waiting_confirmation') return { label: '在线·待老板确认', className: 'standby' };
  if (task.status === 'blocked' || task.status === 'interrupted') return { label: '在线·任务待恢复', className: 'blocked' };
  if (task.status === 'queued' || task.status === 'pending') return { label: '在线·排队中', className: 'queued' };
  if (task.status === 'working' && worker?.status === 'ready' && worker.worker?.currentTaskId === task.taskId) {
    return { label: '后台工作中', className: 'working' };
  }
  return { label: '在线·任务待恢复', className: 'blocked' };
}

export function TeamTemplateWorkspace({ data, books, onManageBook }: { data: TeamTemplateData | null; books: BookData[]; onManageBook: (bookId: string) => void }): React.JSX.Element {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const selected = data?.members.find((member) => member.roleKey === selectedRole) ?? data?.members[0] ?? null;
  if (data === null) return <WorkspaceSkeleton />;
  return <section className="team-template-workspace" aria-labelledby="team-template-title">
    <header><h2 id="team-template-title" className="sr-only">创作团队</h2><strong>{data.members.length} 名成员</strong></header>
    {books.length > 0 && <div className="team-book-shortcuts"><span>管理某本书的成员补充要求：</span>{books.map((book) => <button type="button" key={book.bookId} onClick={() => onManageBook(book.bookId)}>{bookDisplayTitle(book.title)}</button>)}</div>}
    <div className="team-template-layout">
      <nav aria-label="团队岗位模板">{data.members.map((member) => <button className={selected?.roleKey === member.roleKey ? 'active' : ''} type="button" key={member.roleKey} onClick={() => setSelectedRole(member.roleKey)}><AgentAvatar roleKey={member.roleKey} roleName={`${member.memberName}（${member.shortTitle}）`} /><span><strong>{member.memberName}（{member.shortTitle}）</strong><small>{toAuthorFacingText(member.publicSummary)}</small></span></button>)}</nav>
      {selected !== null && <article className="team-template-detail">
        <header><div><AgentAvatar roleKey={selected.roleKey} roleName={`${selected.memberName}（${selected.shortTitle}）`} /><div><h3>{selected.memberName}（{selected.shortTitle}）</h3><p>{toAuthorFacingText(selected.publicSummary)}</p></div></div><span>{selected.defaultActivation === 'resident' ? '一直参与' : '需要时参与'}</span></header>
        <DetailList title="岗位职责" values={selected.responsibilities} />
        <DetailList title="负责什么" values={selected.boundaries} />
        <DetailList title="检索重点" values={selected.retrievalFocus} />
        <section><h4>岗位表达</h4><p>{toAuthorFacingText(selected.roleStatement)}</p></section>
        <ProtectedPromptViewer key={selected.roleKey} roleKey={selected.roleKey} configured={data.fullPromptAccess?.configured ?? false} />
      </article>}
    </div>
  </section>;
}

function DetailList({ title, values }: { title: string; values: string[] }): React.JSX.Element {
  return <section><h4>{title}</h4><ul>{values.map((value) => <li key={value}>{toAuthorFacingText(value)}</li>)}</ul></section>;
}

export function AgentDetailsDialog({ agent, task, onClose }: { agent: AgentData; task: TaskData | null; onClose: () => void }): React.JSX.Element {
  const groups = [
    ['负责', agent.responsibilities ?? []], ['不负责', agent.boundaries ?? []], ['检索重点', agent.retrievalFocus ?? []], ['交付物', agent.outputKinds ?? []]
  ] as const;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-detail-title">
      <header><div className="agent-dialog-identity"><AgentAvatar roleKey={agent.roleKey} roleName={memberIdentity(agent)} /><span><h2 id="agent-detail-title">{memberIdentity(agent)}</h2><p>{agent.publicSummary ?? roleSummary(agent.roleKey)}</p></span></div><button className="icon-button" type="button" aria-label="关闭岗位详情" onClick={onClose}><XIcon /></button></header>
      <div className="agent-detail-groups">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length === 0 ? <p>暂无公开条目</p> : <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}</div>
      <section className="agent-evidence"><h3>当前任务</h3><p>{task === null ? '当前没有分配给该成员的活动任务。' : `${taskChapterFromBrief(task)}，${phaseLabel(task.currentPhase)}，${statusLabel(task.status)}`}</p><small>进度会根据成员的实际工作自动更新。</small></section>
      <footer><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

export function roleSummary(roleKey: string): string {
  return ({
    chief_editor: '主持讨论、安排任务并汇总结果', deputy_editor: '编译资料、维护摘要，必要时接替主编',
    lead_screenwriter: '独立设计剧情、因果和章节跨度', second_screenwriter: '提出重因果的剧情方案',
    third_screenwriter: '提出脑洞与反套路方案',
    setting: '整理世界规则、时间线和人物状态', lead_writer: '按照确认要求写出完整章节', backup_writer: '接替主笔或按要求写待确认稿',
    fact_reviewer: '核对设定、正史与因果事实',
    literary_reviewer: '点评文学表达、语言和AI腔风险', experience_reviewer: '评估追读体验与政治情色风险',
    experience_challenger: '以挑剔读者视角找毒点与弃读风险',
    researcher: '按需核对现实资料和来源', copyright: '检查原创和版权风险',
    plot_architect: '设计剧情结构与因果', continuity: '维护设定与连续性', writer: '完成正式章节', reviewer: '检查逻辑与文风',
    reader_experience: '评估读者体验', style_editor: '精修对白与语言'
  } as Record<string, string>)[roleKey] ?? '按岗位合同完成本书任务';
}
