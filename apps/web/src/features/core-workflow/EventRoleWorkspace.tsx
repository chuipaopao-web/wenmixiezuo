import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, PlusIcon, UserCirclePlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import type {
  CharacterCardContent, CharacterCardView, CoreWorkflowV6View, EventChainVersion,
  EventRoleFunctionRequirement
} from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { fetchEventChains, fetchVolumePlans, type VolumePlanData } from '../../lib/api/client';
import { AiNodePanel, V6Dialog, V6Drawer, V6EmptyState, V6ErrorState, V6LoadingState } from './V6Shared';
import { createCharacterCard, fetchCoreWorkflow, upsertEventRoleAssignment } from './v6-api';

export function EventRoleWorkspace({ bookId, onChanged }: { bookId: string; onChanged?: () => void }): React.JSX.Element {
  const [workflow, setWorkflow] = useState<CoreWorkflowV6View | null>(null);
  const [plan, setPlan] = useState<VolumePlanData | null>(null);
  const [chain, setChain] = useState<EventChainVersion | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<EventRoleFunctionRequirement | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [matchSuggestion, setMatchSuggestion] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [core, plans] = await Promise.all([fetchCoreWorkflow(bookId, signal), fetchVolumePlans(bookId, signal)]);
      const activePlan = [...plans].reverse().find((item) => ['active', 'completed', 'planning'].includes(item.status)) ?? null;
      const chains = activePlan === null ? [] : await fetchEventChains(bookId, activePlan.volumePlanId, signal);
      const activeChain = [...chains].reverse().find((item) => item.status === 'active') ?? null;
      setWorkflow(core); setPlan(activePlan); setChain(activeChain);
      setSelectedNodeId((current) => activeChain?.content.events.some((event) => event.nodeId === current)
        ? current : activeChain?.content.events[0]?.nodeId ?? null);
      setError(null);
    } catch (reason) { if (signal?.aborted !== true) setError(authorErrorFromUnknown(reason, '角色安排加载失败')); }
  }, [bookId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  if (workflow === null && error === null) return <V6LoadingState label="正在读取事件骨架与本卷角色…" />;
  if (workflow === null) return <V6ErrorState message={error ?? '角色安排暂时无法打开'} onRetry={() => void load()} />;
  if (chain === null || plan === null) return <V6EmptyState title="确认事件骨架后安排角色" description="骨架阶段只保存角色功能，不生成具体人名；确认结构后，这里会逐项匹配已有角色或创建待完善角色卡。" />;
  const selectedNode = chain.content.events.find((event) => event.nodeId === selectedNodeId) ?? null;
  const assignments = workflow.eventRoleAssignments.filter((item) => item.eventChainVersionId === chain.id);
  const selectedAssignments = assignments.filter((item) => item.eventNodeId === selectedNode?.nodeId);
  const requiredRoles = selectedNode?.roleFunctions ?? [];
  const requiredKeys = new Set(requiredRoles.map((item) => item.roleFunctionKey));
  const extraAssignments = selectedAssignments.filter((item) => !requiredKeys.has(item.roleFunctionKey));
  const completed = chain.content.events.every((event) => (event.roleFunctions ?? []).every((role) => assignments.some((item) =>
    item.eventNodeId === event.nodeId && item.roleFunctionKey === role.roleFunctionKey && item.assignmentStatus === 'assigned')));
  const source = selectedNode === null ? null : {
    sourceType: 'event_skeleton', sourceId: chain.id, version: chain.version,
    content: JSON.stringify({ event: selectedNode, characters: workflow.characters.map((character) => character.content),
      storylines: workflow.storylines.map((line) => line.activeVersion?.content), authorAllowsNewCharacter: true }),
    reason: '已确认事件骨架、故事线和本卷角色卡', priority: 100, truthStatus: 'confirmed' as const,
    constraintStrength: 'hard_fact' as const, scopeType: 'event' as const, scopeId: selectedNode.nodeId,
    componentKind: 'EventResponsibilityPack' as const
  };
  const storylines = workflow.storylines.map((line) => ({ id: line.storylineId, title: line.activeVersion?.content.title ?? '未命名故事线' }));
  const changed = async (): Promise<void> => { await load(); onChanged?.(); };
  const saveAssignment = async (input: { roleFunctionKey: string; roleFunctionLabel: string; requirement: Record<string, unknown>; assignedCharacterId?: string | null }): Promise<void> => {
    if (selectedNode === null) return;
    await upsertEventRoleAssignment(bookId, { eventChainVersionId: chain.id, eventNodeId: selectedNode.nodeId, ...input });
    setRoleOpen(false); setSelectedRole(null); await changed();
  };

  return <section className="v6-event-roles">
    <header><div><span>02 · 角色安排</span><h3>先定功能，再决定由谁承担</h3><p>优先匹配本书已有角色；作者选择“不新增”时，团队不得强制造人。</p></div>
      <button type="button" className="v6-quiet-button" onClick={() => setCharactersOpen(true)}><UsersThreeIcon />本卷角色</button></header>
    <div className="v6-event-role-progress" aria-live="polite"><strong>{completed ? '全部角色功能已绑定' : '角色功能仍待安排'}</strong><span>{assignments.filter((item) => item.assignmentStatus === 'assigned').length} 项已绑定</span></div>
    <div className="v6-event-role-layout">
      <nav aria-label="事件骨架">{chain.content.events.map((event) => <button type="button" className={event.nodeId === selectedNodeId ? 'active' : ''}
        key={event.nodeId} onClick={() => setSelectedNodeId(event.nodeId)}><small>事件 {event.order}</small><strong>{event.title}</strong><span>{event.volumeResponsibility}</span>
        {(event.roleFunctions ?? []).length > 0 && (event.roleFunctions ?? []).every((role) => assignments.some((item) => item.eventNodeId === event.nodeId
          && item.roleFunctionKey === role.roleFunctionKey && item.assignmentStatus === 'assigned')) && <em><CheckCircleIcon weight="fill" />已安排角色</em>}</button>)}</nav>
      <section>{selectedNode === null ? null : <>
        <header><span>当前事件</span><h4>{selectedNode.title}</h4><p>{selectedNode.entryState} → {selectedNode.exitState}</p></header>
        <dl><div><dt>卷责任</dt><dd>{selectedNode.volumeResponsibility}</dd></div><div><dt>主角行动</dt><dd>{selectedNode.protagonistAction}</dd></div><div><dt>因果接口</dt><dd>{selectedNode.leadsToNext ?? '本卷事件链收束'}</dd></div></dl>
        <div className="v6-role-assignments">{requiredRoles.map((role) => {
          const assignment = selectedAssignments.find((item) => item.roleFunctionKey === role.roleFunctionKey);
          const character = workflow.characters.find((item) => item.characterId === assignment?.assignedCharacterId);
          return <button type="button" key={role.roleFunctionKey} onClick={() => { setSelectedRole(role); setRoleOpen(true); }}>
            <span><small>{role.roleFunctionLabel}</small><strong>{character?.content?.name ?? '待匹配角色'}</strong><p>{role.requirement}</p></span>
            <em>{assignment?.assignmentStatus === 'assigned' ? '已绑定 · 可更换' : '功能占位 · 去安排'}</em></button>;
        })}{extraAssignments.map((assignment) => {
          const character = workflow.characters.find((item) => item.characterId === assignment.assignedCharacterId);
          return <button type="button" key={assignment.eventRoleAssignmentId} onClick={() => { setSelectedRole({ roleFunctionKey: assignment.roleFunctionKey,
            roleFunctionLabel: assignment.roleFunctionLabel, requirement: String(assignment.requirement.description ?? ''), importance: 'supporting' }); setRoleOpen(true); }}>
            <span><small>{assignment.roleFunctionLabel}</small><strong>{character?.content?.name ?? '待匹配角色'}</strong></span><em>作者新增功能</em></button>;
        })}</div>
        <button type="button" className="v6-quiet-button" onClick={() => { setSelectedRole(null); setRoleOpen(true); }}><PlusIcon />添加自定义角色功能</button>
        {source !== null && <AiNodePanel bookId={bookId} nodeKind="event_role_match" objectId={selectedNode.nodeId} roleKey="screenwriter"
          title="让编剧提出角色方案" taskDescription="核心对手或关键新角色给 2—3 种实质不同方案；次级功能给一份可修改方案，并说明匹配原因。" source={source}
          templateVersion="event-role-match-v2" defaultMemberCount={2} onUseCandidate={setMatchSuggestion} />}
        {matchSuggestion !== null && <aside className="v6-role-match-note"><strong>结构化匹配建议</strong><p>{String(matchSuggestion.matchReason ?? matchSuggestion.reason ?? '请根据角色目标、边界和故事线责任核对后再绑定。')}</p>
          <button type="button" className="v6-quiet-button" onClick={() => setMatchSuggestion(null)}>收起建议</button></aside>}
      </>}</section>
    </div>
    {roleOpen && selectedNode !== null && <RoleAssignmentDialog storylines={storylines} characters={workflow.characters} initialRole={selectedRole}
      initialLeadingStorylineId={selectedNode.leadingStorylineId ?? ''} initialSupportingStorylineId={(selectedNode.supportingStorylineIds ?? [])[0] ?? ''}
      onClose={() => { setRoleOpen(false); setSelectedRole(null); }} onCreateCharacter={() => setCharacterOpen(true)}
      {...(selectedRole === null ? {} : { onCreatePending: async (name: string) => {
        try {
          const created = await createCharacterCard(bookId, { characterKind: 'volume_new', content: { name,
            roleSummary: `待完善：承担“${selectedRole.roleFunctionLabel}”`, desire: '', currentState: '', boundaries: [],
            storylineInfluences: selectedNode.leadingStorylineId == null ? [] : [{ storylineId: selectedNode.leadingStorylineId, influence: selectedRole.requirement }] } });
          await saveAssignment({ roleFunctionKey: selectedRole.roleFunctionKey, roleFunctionLabel: selectedRole.roleFunctionLabel,
            requirement: { description: selectedRole.requirement, leadingStorylineId: selectedNode.leadingStorylineId,
              supportingStorylineIds: selectedNode.supportingStorylineIds ?? [], allowNewCharacter: true, pendingCharacterCard: true },
            assignedCharacterId: created.characterId });
        } catch (reason) { setError(authorErrorFromUnknown(reason, '待完善角色卡创建失败')); }
      } })} onSave={async (input) => { try { await saveAssignment(input); } catch (reason) { setError(authorErrorFromUnknown(reason, '角色功能保存失败')); } }} />}
    {characterOpen && <CharacterEditor storylines={storylines} initialName="" onClose={() => setCharacterOpen(false)} onSave={async (kind, content) => {
      try { await createCharacterCard(bookId, { characterKind: kind, content }); setCharacterOpen(false); await changed(); }
      catch (reason) { setError(authorErrorFromUnknown(reason, '角色卡创建失败')); }
    }} />}
    {charactersOpen && <V6Drawer title="本卷角色" onClose={() => setCharactersOpen(false)}><CharacterGroups characters={workflow.characters} assignments={assignments} onPromote={async (character) => {
      if (character.content === null) return; await createCharacterCard(bookId, { characterKind: 'existing', content: character.content, promotedFromCharacterId: character.characterId }); await changed();
    }} /></V6Drawer>}
    {error !== null && <p className="v6-inline-error" role="alert">{error}</p>}
  </section>;
}

function RoleAssignmentDialog({ storylines, characters, initialRole, initialLeadingStorylineId, initialSupportingStorylineId,
  onClose, onCreateCharacter, onCreatePending, onSave }: {
  storylines: Array<{ id: string; title: string }>; characters: CharacterCardView[]; initialRole: EventRoleFunctionRequirement | null;
  initialLeadingStorylineId: string; initialSupportingStorylineId: string; onClose: () => void; onCreateCharacter: () => void;
  onCreatePending?: (name: string) => Promise<void>;
  onSave: (input: { roleFunctionKey: string; roleFunctionLabel: string; requirement: Record<string, unknown>; assignedCharacterId?: string | null }) => Promise<void>;
}): React.JSX.Element {
  const [label, setLabel] = useState(initialRole?.roleFunctionLabel ?? '关键推动者');
  const [requirement, setRequirement] = useState(initialRole?.requirement ?? '');
  const [leading, setLeading] = useState(initialLeadingStorylineId || storylines[0]?.id || '');
  const [supporting, setSupporting] = useState(initialSupportingStorylineId);
  const [characterId, setCharacterId] = useState(''); const [allowNew, setAllowNew] = useState(true); const [newName, setNewName] = useState('');
  return <V6Dialog title="安排角色功能" onClose={onClose}><div className="v6-field-grid">
    <label><span>角色功能</span><input value={label} disabled={initialRole !== null} onChange={(event) => setLabel(event.target.value)} placeholder="例如：核心对手、线索提供者" /></label>
    <label><span>优先匹配</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)}><option value="">稍后完善，先保留功能占位</option>{characters.map((character) => <option key={character.characterId} value={character.characterId}>{character.content?.name ?? '待完善角色'}</option>)}</select></label>
    <label><span>主导故事线</span><select value={leading} onChange={(event) => setLeading(event.target.value)}>{storylines.map((line) => <option key={line.id} value={line.id}>{line.title}</option>)}</select></label>
    <label><span>辅助故事线</span><select value={supporting} onChange={(event) => setSupporting(event.target.value)}><option value="">无</option>{storylines.filter((line) => line.id !== leading).map((line) => <option key={line.id} value={line.id}>{line.title}</option>)}</select></label>
    <label className="wide"><span>这个角色必须做到什么</span><textarea rows={3} value={requirement} onChange={(event) => setRequirement(event.target.value)} /></label>
    <label className="wide v6-checkbox"><input type="checkbox" checked={allowNew} onChange={(event) => setAllowNew(event.target.checked)} />没有合适角色时允许提出新角色；取消后团队只能匹配已有角色</label>
  </div>
    {onCreatePending !== undefined && <div className="v6-pending-character"><label><span>已有名字但角色卡不存在</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="输入作者指定的角色名" /></label>
      <button type="button" className="v6-quiet-button" disabled={newName.trim() === ''} onClick={() => void onCreatePending(newName.trim())}><UserCirclePlusIcon />创建待完善角色卡并绑定</button></div>}
    <button type="button" className="v6-quiet-button" onClick={onCreateCharacter}><UserCirclePlusIcon />作者完整填写新角色</button>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={label.trim() === '' || requirement.trim() === ''}
      onClick={() => void onSave({ roleFunctionKey: initialRole?.roleFunctionKey ?? `role-${Date.now()}`, roleFunctionLabel: label,
        requirement: { description: requirement, leadingStorylineId: leading, supportingStorylineIds: supporting === '' ? [] : [supporting], allowNewCharacter: allowNew },
        assignedCharacterId: characterId || null })}>{characterId === '' ? '保留功能占位' : '绑定这个角色'}</button></footer>
  </V6Dialog>;
}

function CharacterEditor({ storylines, initialName, onClose, onSave }: { storylines: Array<{ id: string; title: string }>; initialName: string; onClose: () => void;
  onSave: (kind: CharacterCardView['characterKind'], content: CharacterCardContent) => Promise<void> }): React.JSX.Element {
  const [kind, setKind] = useState<CharacterCardView['characterKind']>('volume_new'); const [name, setName] = useState(initialName); const [summary, setSummary] = useState('');
  const [desire, setDesire] = useState(''); const [state, setState] = useState(''); const [lineId, setLineId] = useState(storylines[0]?.id ?? ''); const [influence, setInfluence] = useState('');
  return <V6Dialog title="创建角色卡" onClose={onClose}><div className="v6-field-grid">
    <label><span>角色姓名</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>角色类型</span><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="existing">已有角色</option><option value="volume_new">本卷新角色</option><option value="temporary">临时角色</option></select></label>
    <label className="wide"><span>角色功能概述 <small>可稍后完善</small></span><textarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    <label><span>当前欲望</span><input value={desire} onChange={(event) => setDesire(event.target.value)} /></label><label><span>当前状态</span><input value={state} onChange={(event) => setState(event.target.value)} /></label>
    <label><span>关联故事线</span><select value={lineId} onChange={(event) => setLineId(event.target.value)}><option value="">稍后关联</option>{storylines.map((line) => <option key={line.id} value={line.id}>{line.title}</option>)}</select></label><label><span>如何影响这条线</span><input value={influence} onChange={(event) => setInfluence(event.target.value)} /></label>
  </div><footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={name.trim() === ''}
    onClick={() => void onSave(kind, { name: name.trim(), roleSummary: summary.trim() || '待完善角色功能', desire, currentState: state, boundaries: [],
      storylineInfluences: lineId === '' ? [] : [{ storylineId: lineId, influence: influence.trim() || '影响方式待完善' }] })}>创建角色卡</button></footer></V6Dialog>;
}

function CharacterGroups({ characters, assignments, onPromote }: { characters: CharacterCardView[]; assignments: CoreWorkflowV6View['eventRoleAssignments']; onPromote: (character: CharacterCardView) => Promise<void> }): React.JSX.Element {
  const groups: Array<[CharacterCardView['characterKind'], string]> = [['protagonist', '主角'], ['existing', '已有角色'], ['volume_new', '本卷新角色'], ['temporary', '临时角色']];
  return <div className="v6-character-groups">{groups.map(([kind, label]) => <section key={kind}><h4>{label}</h4>{characters.filter((item) => item.characterKind === kind).length === 0 ? <p>暂无</p>
    : characters.filter((item) => item.characterKind === kind).map((character) => {
      const used = assignments.filter((item) => item.assignedCharacterId === character.characterId).length;
      const recommend = kind === 'temporary' && used > 1;
      return <article key={character.characterId}><span><strong>{character.content?.name ?? '待完善角色'}</strong><small>{character.content?.roleSummary ?? '尚未完善'}</small>
        {character.content?.storylineInfluences.map((item) => <em key={item.storylineId}>关联故事线 · {item.influence}</em>)}{recommend && <b>重复出现，建议升级为正式角色</b>}</span>
        {kind === 'temporary' && <button type="button" className="v6-quiet-button" onClick={() => void onPromote(character)}>升级为正式角色</button>}</article>;
    })}</section>)}</div>;
}