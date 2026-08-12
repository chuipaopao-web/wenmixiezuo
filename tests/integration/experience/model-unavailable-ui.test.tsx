// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../../../apps/web/src/app/workspace-preferences';
import { SettingsDialog } from '../../../apps/web/src/features/settings/SettingsDialog';
import type { CapabilityData } from '../../../apps/web/src/lib/api/client';

afterEach(() => cleanup());

describe('author-facing model availability', () => {
  it('pauses creative actions without exposing deterministic fixture identifiers', () => {
    const capabilities: CapabilityData = {
      releaseId: 'test-release',
      checkedAt: '2026-08-12T00:00:00.000Z',
      runtime: {
        platform: 'win32', architecture: 'x64', nodeVersion: '24.16.0', logicalCpuCount: 8,
        totalMemoryBytes: 16_000_000_000, freeMemoryBytes: 8_000_000_000, dataVolumeFreeBytes: 100_000_000_000
      },
      sqlite: { version: '3', foreignKeys: true, trustedSchema: false, json: true, fts5: true },
      dependencies: [],
      modelAssets: [],
      modelRuntime: {
        requestedMode: 'deterministic', activeMode: 'deterministic', strictPlanOnly: true,
        cashFallbackAllowed: false, missingCredentials: ['agent-plan'],
        profiles: [{
          provider: 'local-deterministic', modelId: 'wenmi-fixture-v1', plan: 'deterministic',
          roles: ['writer'], credentialConfigured: true
        }]
      },
      degradation: { active: true, missingCapabilities: ['creative-model'], vectorSearchAvailable: true, localModelAssetsReady: true }
    };

    render(<SettingsDialog
      preferences={DEFAULT_WORKSPACE_PREFERENCES}
      capabilities={capabilities}
      bookId="book-1"
      bindings={null}
      operations={null}
      onBindingsChanged={vi.fn()}
      onBooksChanged={vi.fn()}
      onChange={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('\u521b\u4f5c\u6a21\u578b\u5c1a\u672a\u8fde\u63a5')).toBeInTheDocument();
    expect(screen.getByText('\u0041\u0049\u521b\u4f5c\u5165\u53e3\u5df2\u6682\u505c\uff0c\u4e0d\u4f1a\u751f\u6210\u6d4b\u8bd5\u6a21\u677f')).toBeInTheDocument();
    expect(screen.getByText(/\u8bbe\u5b9a\u3001\u5206\u5377\u3001\u89c4\u5212/)).toBeInTheDocument();
    expect(screen.queryByText(/local-deterministic|wenmi-fixture/i)).not.toBeInTheDocument();
  });
});
