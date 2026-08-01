import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowClockwiseIcon, CheckIcon, CopyIcon, MagicWandIcon } from '@phosphor-icons/react';
import {
  NAMING_TARGET_GROUPS,
  generateNamingCandidates,
  getNamingTarget,
  type NamingContext,
  type NamingGroupId
} from './naming-assistant';

interface NamingAssistantPanelProps {
  context?: NamingContext;
  initialTargetId?: string;
  exclude?: string[];
  action: 'fill' | 'copy';
  onSelect?: (name: string) => void;
  compact?: boolean;
}

export function NamingAssistantPanel({
  context = {},
  initialTargetId = 'character-neutral',
  exclude = [],
  action,
  onSelect,
  compact = false
}: NamingAssistantPanelProps): React.JSX.Element {
  const headingId = useId();
  const initialTarget = getNamingTarget(initialTargetId) ?? NAMING_TARGET_GROUPS[0]!.targets[0]!;
  const [groupId, setGroupId] = useState<NamingGroupId>(initialTarget.groupId);
  const [targetId, setTargetId] = useState(initialTarget.id);
  const [hint, setHint] = useState('');
  const [count, setCount] = useState(compact ? 8 : 12);
  const [batch, setBatch] = useState(0);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const next = getNamingTarget(initialTargetId);
    if (next === null) return;
    setGroupId(next.groupId);
    setTargetId(next.id);
    setBatch(0);
  }, [initialTargetId]);

  const activeGroup = NAMING_TARGET_GROUPS.find((group) => group.id === groupId) ?? NAMING_TARGET_GROUPS[0]!;
  const activeTarget = getNamingTarget(targetId) ?? activeGroup.targets[0]!;
  const candidates = useMemo(() => generateNamingCandidates({
    targetId: activeTarget.id,
    context,
    count,
    batch,
    exclude,
    hint
  }), [activeTarget.id, batch, context, count, exclude, hint]);

  const switchGroup = (nextGroupId: NamingGroupId): void => {
    const nextGroup = NAMING_TARGET_GROUPS.find((group) => group.id === nextGroupId);
    if (nextGroup === undefined) return;
    setGroupId(nextGroupId);
    setTargetId(nextGroup.targets[0]!.id);
    setBatch(0);
    setFeedback(null);
  };

  const useCandidate = async (name: string): Promise<void> => {
    if (action === 'fill') {
      onSelect?.(name);
      setFeedback(`已填入“${name}”，您仍可继续修改。`);
      return;
    }
    try {
      await copyText(name);
      setCopiedName(name);
      setFeedback(`已复制“${name}”。`);
    } catch {
      setFeedback('复制没有成功，请直接选中文字复制。');
    }
  };

  return (
    <section className={`naming-assistant-panel${compact ? ' compact' : ''}`} aria-labelledby={headingId}>
      <header className="naming-assistant-heading">
        <div className="naming-assistant-title-mark"><MagicWandIcon aria-hidden="true" /></div>
        <div>
          <h2 id={headingId}>取名助手</h2>
          <p>按本书题材推荐，也可以自由切换类型。候选不会自动写入设定、正文或正史。</p>
        </div>
      </header>

      <div className="naming-group-tabs" role="tablist" aria-label="取名对象分组">
        {NAMING_TARGET_GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={group.id === groupId}
            className={group.id === groupId ? 'active' : ''}
            onClick={() => switchGroup(group.id)}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div className="naming-assistant-layout">
        <aside className="naming-target-list" aria-label={`${activeGroup.label}取名类型`}>
          <p>{activeGroup.description}</p>
          {activeGroup.targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={target.id === activeTarget.id ? 'active' : ''}
              aria-pressed={target.id === activeTarget.id}
              onClick={() => { setTargetId(target.id); setBatch(0); setFeedback(null); }}
            >
              <strong>{target.label}</strong>
              {!compact && <small>{target.description}</small>}
            </button>
          ))}
        </aside>

        <div className="naming-candidate-area">
          <div className="naming-candidate-toolbar">
            <label>
              <span>字数或题材语感（可选）</span>
              <input
                value={hint}
                onChange={(event) => { setHint(event.target.value); setBatch(0); }}
                placeholder="例如：两个字、西幻、仙侠或科幻"
                maxLength={80}
              />
            </label>
            <label className="naming-count-control">
              <span>每批数量</span>
              <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {[8, 12, 16, 24].map((value) => <option key={value} value={value}>{value}个</option>)}
              </select>
            </label>
            <button
              className="secondary-button naming-refresh-button"
              type="button"
              onClick={() => { setBatch((value) => value + 1); setCopiedName(null); setFeedback(null); }}
            >
              <ArrowClockwiseIcon aria-hidden="true" />换一批
            </button>
          </div>

          <div className="naming-candidate-summary">
            <span>正在取：<strong>{activeTarget.label}</strong></span>
            <small>第 {batch + 1} 批 · 本地生成 · 不消耗Token</small>
          </div>

          {candidates.length === 0 ? (
            <div className="naming-empty" role="status">当前条件没有生成可用候选，请换一个类型或减少排除项。</div>
          ) : (
            <div className="naming-candidate-grid">
              {candidates.map((candidate) => {
                const completed = action === 'copy' && copiedName === candidate.name;
                return (
                  <article key={candidate.name} className="naming-candidate-card">
                    <div>
                      <strong>{candidate.name}</strong>
                      {!compact && <small>{candidate.note}</small>}
                    </div>
                    <button
                      type="button"
                      aria-label={`${action === 'fill' ? '填入候选' : '复制候选'}：${candidate.name}`}
                      onClick={() => void useCandidate(candidate.name)}
                    >
                      {completed ? <CheckIcon aria-hidden="true" /> : action === 'copy' ? <CopyIcon aria-hidden="true" /> : <MagicWandIcon aria-hidden="true" />}
                      <span>{completed ? '已复制' : action === 'copy' ? '复制' : '填入'}</span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {feedback !== null && <p className="naming-feedback" role="status">{feedback}</p>}
        </div>
      </div>
    </section>
  );
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand?.('copy') ?? false;
  field.remove();
  if (!copied) throw new Error('copy_failed');
}
