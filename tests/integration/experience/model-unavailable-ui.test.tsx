// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../../../apps/web/src/app/workspace-preferences';
import { SettingsDialog } from '../../../apps/web/src/features/settings/SettingsDialog';

afterEach(() => cleanup());

describe('author-facing model availability', () => {
  it('设置页不再展示任何模型信息或确定性假模型标识', () => {
    render(<SettingsDialog
      preferences={DEFAULT_WORKSPACE_PREFERENCES}
      bookId="book-1"
      operations={null}
      onBooksChanged={vi.fn()}
      onChange={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('界面设置')).toBeInTheDocument();
    expect(screen.queryByText(/local-deterministic|wenmi-fixture|deepseek|doubao|glm|kimi|火山方舟|模型绑定|成员模型/iu)).not.toBeInTheDocument();
  });
});
