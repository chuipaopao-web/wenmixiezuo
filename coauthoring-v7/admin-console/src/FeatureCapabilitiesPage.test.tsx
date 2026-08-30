// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FeatureCapabilitiesPage } from './FeatureCapabilitiesPage';
import { fetchFeatureCapabilities, type AdminFeatureCapabilitiesData } from './platform-api';

vi.mock('./platform-api', async () => {
  const actual = await vi.importActual<typeof import('./platform-api')>('./platform-api');
  return { ...actual, fetchFeatureCapabilities: vi.fn() };
});

const DATA: AdminFeatureCapabilitiesData = {
  registry: {
    version: '2026.08.30',
    updatedAt: '2026-08-30',
    current: { label: 'V7 当前版本', revision: 'v7' },
    baseline: { key: 'stable-baseline', label: '稳定能力基线', revision: 'stable-1', purpose: '核对商业必需能力是否完整承接。' },
    availableBaselines: [
      { key: 'stable-baseline', label: '稳定能力基线', revision: 'stable-1', purpose: '核对商业必需能力是否完整承接。' },
      { key: 'previous-production', label: '上一生产版本', revision: 'legacy', purpose: '查看旧功能在 V7 的去向。' }
    ],
    statusLabels: { added: '新增', retained: '保留', relocated: '迁移', replaced: '替代', retired: '明确下线', suspected_missing: '疑似遗漏' },
    surfaceLabels: { author: '作者端', admin: '独立后台', system: '系统能力' }
  },
  summary: {
    modules: 1,
    capabilities: 2,
    currentAvailable: 1,
    filteredCapabilities: 2,
    statuses: { added: 0, retained: 1, relocated: 0, replaced: 0, retired: 0, suspected_missing: 1 }
  },
  moduleOptions: [{ id: 'author-books', name: '书籍管理', surface: 'author' }],
  modules: [{
    id: 'author-books',
    name: '书籍管理',
    surface: 'author',
    capabilities: [
      {
        id: 'book-archive', moduleId: 'author-books', moduleName: '书籍管理', surface: 'author', name: '书籍归档',
        description: '作者可以归档不再创作的书籍。', status: 'retained', currentAvailable: true,
        currentEntry: '书架 / 已归档', evidence: ['coauthoring-v7/web/src/App.tsx']
      },
      {
        id: 'book-export', moduleId: 'author-books', moduleName: '书籍管理', surface: 'author', name: '书籍导出',
        description: '旧版只有服务器目录导出，不是浏览器闭环。', status: 'suspected_missing', currentAvailable: false,
        currentEntry: null, previousEntry: '设置 / 导出', impact: '作者当前不能自行下载备份。',
        decision: '尚未正式下线。', recommendation: '补浏览器安全下载。', evidence: ['apps/api/src/http/domain-routes.ts']
      }
    ]
  }],
  losses: [{
    id: 'book-export', moduleId: 'author-books', moduleName: '书籍管理', surface: 'author', name: '书籍导出',
    description: '旧版只有服务器目录导出，不是浏览器闭环。', status: 'suspected_missing', currentAvailable: false,
    currentEntry: null, previousEntry: '设置 / 导出', impact: '作者当前不能自行下载备份。',
    decision: '尚未正式下线。', recommendation: '补浏览器安全下载。', evidence: ['apps/api/src/http/domain-routes.ts']
  }]
};

describe('V7 独立后台功能台账', () => {
  beforeEach(() => {
    vi.mocked(fetchFeatureCapabilities).mockReset();
    vi.mocked(fetchFeatureCapabilities).mockResolvedValue(DATA);
  });

  test('显示当前能力、疑似遗漏和折叠证据，不伪装完整', async () => {
    render(<FeatureCapabilitiesPage />);

    expect(screen.getByText('正在核对功能台账…')).toBeInTheDocument();
    await screen.findByRole('heading', { name: '功能台账' });

    expect(screen.getByText('当前可用')).toBeInTheDocument();
    expect(screen.getByText('需要核查的疑似遗漏')).toBeInTheDocument();
    expect(screen.getAllByText('书籍导出').length).toBeGreaterThan(0);
    expect(screen.getByText('书架 / 已归档')).toBeInTheDocument();
    expect(screen.getAllByText('查看判定与代码证据')).toHaveLength(2);
    expect(screen.getByText('2 项结果')).toBeInTheDocument();
  });

  test('默认使用稳定能力基线且请求可以取消', async () => {
    render(<FeatureCapabilitiesPage />);
    await waitFor(() => expect(fetchFeatureCapabilities).toHaveBeenCalledTimes(1));
    expect(fetchFeatureCapabilities).toHaveBeenCalledWith({ baseline: 'stable-baseline' }, expect.any(AbortSignal));
  });
});
