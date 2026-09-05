import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowActionDock } from './WorkflowActionDock';

describe('WorkflowActionDock', () => {
  it('keeps one primary action after optional secondary actions', () => {
    render(<WorkflowActionDock
      title="框架草案已完成"
      detail="确认后才会成为后续创作依据。"
      secondary={<button type="button">返回修改</button>}
      primary={<button type="button">确认采用框架</button>}
    />);

    const dock = screen.getByRole('contentinfo', { name: '当前步骤操作' });
    expect(dock).toHaveClass('workflow-action-dock-page');
    expect(dock.querySelectorAll('.workflow-action-dock-primary > button')).toHaveLength(1);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['返回修改', '确认采用框架']);
  });

  it('supports a non-sticky card action area', () => {
    render(<WorkflowActionDock
      mode="card"
      ariaLabel="设定清单操作"
      title="设定清单已经整理好"
      primary={<button type="button">查看并开始设计</button>}
    />);

    expect(screen.getByRole('group', { name: '设定清单操作' })).toHaveClass('workflow-action-dock-card');
    expect(screen.queryByRole('contentinfo', { name: '设定清单操作' })).not.toBeInTheDocument();
  });
});
