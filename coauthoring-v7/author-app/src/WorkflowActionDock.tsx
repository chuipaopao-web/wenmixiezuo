import type { ReactNode } from 'react';

export function WorkflowActionDock({
  title,
  detail,
  primary,
  secondary,
  mode = 'page',
  ariaLabel = '当前步骤操作'
}: {
  title: string;
  detail?: string;
  primary: ReactNode;
  secondary?: ReactNode;
  mode?: 'page' | 'card';
  ariaLabel?: string;
}): React.JSX.Element {
  return <footer role={mode === 'card' ? 'group' : undefined} className={`workflow-action-dock workflow-action-dock-${mode}`} aria-label={ariaLabel}>
    <span className="workflow-action-dock-copy">
      <strong>{title}</strong>
      {detail !== undefined && <small>{detail}</small>}
    </span>
    <span className="workflow-action-dock-actions">
      {secondary}
      <span className="workflow-action-dock-primary">{primary}</span>
    </span>
  </footer>;
}
