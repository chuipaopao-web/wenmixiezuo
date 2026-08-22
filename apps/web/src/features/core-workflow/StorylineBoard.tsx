import { ArrowDownIcon, ArrowUpIcon, LinkSimpleIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import type { StorylineContent, StorylineView } from '@wenmi/contracts';

export function StorylineBoard({ lines, busy, onAdd, onRelations, onView, onMove, onEdit, onAbandon }: {
  lines: StorylineView[];
  busy: boolean;
  onAdd: () => void;
  onRelations: () => void;
  onView: (view: 'lines' | 'progress' | 'foreshadow') => void;
  onMove: (storylineId: string, offset: -1 | 1) => void;
  onEdit: (storylineId: string, content: StorylineContent) => void;
  onAbandon: (storylineId: string) => void;
}): React.JSX.Element {
  return <section className="v6-storyline-board" aria-label="故事线线路地图">
    <header>
      <div className="v6-storyline-view-tabs" aria-label="故事线查看方式">
        <button type="button" className="active" onClick={() => onView('lines')}>线路地图</button>
        <button type="button" onClick={() => onView('progress')}>推进轨道</button>
        <button type="button" onClick={() => onView('foreshadow')}>伏笔轨道</button>
      </div>
      <div className="v6-row-actions-wide">
        {lines.length >= 2 && <button type="button" className="v6-quiet-button" onClick={onRelations}><LinkSimpleIcon />线路关系</button>}
        <button type="button" className="v6-primary-button" onClick={onAdd}><PlusIcon />新增故事线</button>
      </div>
    </header>
    <div className="v6-storyline-board-head" aria-hidden="true">
      <span>故事线</span><span>起点</span><span>发展</span><span>转折</span><span>收束</span><span>操作</span>
    </div>
    <div className="v6-storyline-board-body">
      {lines.map((line, index) => {
        const content = line.activeVersion?.content;
        if (content === undefined) return null;
        const milestones = milestoneLabels(content);
        return <article key={line.storylineId} data-kind={content.lineKind}>
          <div className="v6-storyline-card">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{content.title}</strong><small>{lineKindLabel(content.lineKind)}</small></div>
            <p>{content.coreQuestion}</p>
            <em>{lifecycleLabel(line.lifecycleStatus)}</em>
          </div>
          <ol className="v6-storyline-milestones">
            {milestones.map((milestone, milestoneIndex) => <li key={`${line.storylineId}:${milestoneIndex}`}>
              <i /><span>{milestone}</span>{milestoneIndex === 2 && content.lineKind !== 'unit' && <b>交汇</b>}
            </li>)}
          </ol>
          <div className="v6-storyline-board-actions">
            <button type="button" disabled={busy || index === 0} aria-label={`上移${content.title}`} onClick={() => onMove(line.storylineId, -1)}><ArrowUpIcon /></button>
            <button type="button" disabled={busy || index === lines.length - 1} aria-label={`下移${content.title}`} onClick={() => onMove(line.storylineId, 1)}><ArrowDownIcon /></button>
            <button type="button" aria-label={`编辑${content.title}`} onClick={() => onEdit(line.storylineId, content)}><PencilSimpleIcon /></button>
            <button type="button" aria-label={`废弃${content.title}`} onClick={() => onAbandon(line.storylineId)}><TrashIcon /></button>
          </div>
        </article>;
      })}
    </div>
    <footer><span><i data-state="active" />推进中</span><span><i data-state="planned" />计划中</span><span><i data-state="pending" />待确认</span><span><b>交汇</b>两条故事线在这里互相影响</span></footer>
  </section>;
}

function milestoneLabels(content: StorylineContent): string[] {
  const expected = content.expectedStages.map((item) => item.trim()).filter(Boolean);
  return [
    expected[0] ?? '确定线路起点',
    expected[1] ?? '推进核心问题',
    expected[2] ?? '形成关键转折',
    content.stageGoal.trim() || '完成当前阶段'
  ];
}

function lineKindLabel(value: StorylineContent['lineKind']): string {
  return value === 'core' ? '全书核心线' : value === 'branch' ? '重要支线' : '单元故事线';
}

function lifecycleLabel(value: StorylineView['lifecycleStatus']): string {
  return ({ ideation: '构思中', active: '推进中', paused: '暂缓', completed: '已完成', abandoned: '已废弃' } as const)[value];
}
