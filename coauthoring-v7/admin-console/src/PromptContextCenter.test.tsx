// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptContextCenter } from './PromptContextCenter';
import type { V7PromptAssetVersion } from './platform-api';

const published = version({
  assetId: 'workstation.full_book_route@1', assetKey: 'workstation.full_book_route', kind: 'workstation_prompt',
  version: 1, status: 'published', title: '全书路线工位', summary: '规划全书粗路线。',
  content: { workstationKey: 'full_book_route', publicName: '全书路线', taskKinds: ['planning_context'],
    responsibility: '形成可展开的全书方向', requiredInputs: ['开书资料'], forbiddenInputs: ['旧候选'],
    qualityChecks: ['方向可展开'], stageBoundary: '只规划粗路线' }
});
const draft = version({ ...published, assetId: 'workstation.full_book_route@2', version: 2, status: 'draft',
  governanceRevision: 2, basedOnVersion: 1, basedOnAssetId: published.assetId,
  summary: '规划全书粗路线并明确每卷责任。' });

const rolePrompt = version({
  ...published, assetId: 'role.chief_editor@1', assetKey: 'role.chief_editor', kind: 'role_prompt',
  title: '全案策划主编', summary: '负责策划与审查。', content: { roleKey: 'chief_editor' }
});
const skill = version({
  ...published, assetId: 'skill.data-boundary@1', assetKey: 'skill.data-boundary', kind: 'skill',
  title: '资料边界检查', summary: '核对资料权限。', content: { skillKey: 'data-boundary' }
});

const manifest = {
  manifestId: 'manifest-1', ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1', memberKey: 'planner-1',
  roleKey: 'chief_editor', workstationKey: 'full_book_route', taskKind: 'planning_context', operationMode: 'fresh',
  modelProfileKey: 'glm-5.3', governanceRevision: 1, compiledPromptHash: 'prompt-hash', lifecycleStatus: 'active',
  createdAt: '2026-08-28T09:00:00.000Z',
  execution: { state: 'succeeded', summary: '任务已经完成，并保存了可核对的结果。', completedAt: '2026-08-28T09:01:00.000Z', sourceKind: 'planning', artifactType: '规划方案' }
} as const;

describe('提示词与上下文中心', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let revision: number;
  let currentVersions: Array<ReturnType<typeof version>>;

  beforeEach(() => {
    revision = 1;
    currentVersions = [published];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/prompt-context/summary')) return json(summary(revision, currentVersions));
      if (url.endsWith('/prompt-context/assets')) return json([assetListItem(currentVersions)]);
      if (url.endsWith('/assets/workstation.full_book_route/versions')) return json(currentVersions);
      if (url.endsWith('/assets/workstation.full_book_route/drafts') && init?.method === 'POST') {
        revision = 2; currentVersions = [draft, published]; return json(draft);
      }
      if (url.endsWith('/assets/workstation.full_book_route/preview')) return json({
        asset: pickPreviewAsset(draft),
        preview: { contextMode: 'historical', contextLabel: '基于历史任务 manifest-1 的真实冻结上下文；仅替换当前配置版本。',
          baseManifestId: 'manifest-1', compiledPrompt: '全书路线任务规则', compiledPromptHash: 'preview-hash',
          characterCount: 8, estimatedTokens: 4, limitations: ['不会修改历史任务。'], checks: [
          { key: 'structure', passed: true }, { key: 'secretBoundary', passed: true }, { key: 'reasoningBoundary', passed: true }
        ] }
      });
      if (url.endsWith('/assets/workstation.full_book_route/publish')) {
        revision = 3;
        const nextPublished = { ...draft, status: 'published' as const, publishedBy: 'admin-1', publishedAt: '2026-08-28T10:00:00.000Z' };
        currentVersions = [nextPublished, { ...published, status: 'retired' as const }];
        return json(nextPublished);
      }
      if (url.endsWith('/assets/workstation.full_book_route/restore-draft')) {
        revision = 2; currentVersions = [draft, published]; return json(draft);
      }
      if (url.includes('/prompt-context/manifests?')) return json([manifest]);
      if (url.endsWith('/prompt-context/manifests/manifest-1')) return json({
        manifest: {
          ...manifest, rolePromptVersionId: rolePrompt.assetId, workstationPromptVersionId: published.assetId,
          genreProfileId: 'genre-1', genreProfileVersion: 1, skillVersionIds: [skill.assetId],
          taskContractId: 'contract-1', taskContractVersion: 1, contextPackId: 'context-1', contextPackHash: 'context-hash',
          temperature: .64, allowedTools: ['读取正式资料'], compiledBlocks: { contract: '...' }, compiledPrompt: '请设计三种全书粗路线。'
        },
        execution: manifest.execution,
        taskContract: {
          contractId: 'contract-1', version: 1, ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1',
          taskKind: 'planning_context', workstationKey: 'full_book_route', objective: '设计三种全书粗路线',
          operationMode: 'fresh', mustPreserve: ['主角张三'], allowedChanges: ['卷数'], forbiddenChanges: ['时代背景'],
          successCriteria: ['路线可展开'], outputContract: { type: 'route_options' }, authorInstructionVersion: 1,
          basedOnTaskId: null, lifecycleStatus: 'active', contentHash: 'contract-hash', createdAt: manifest.createdAt
        },
        contextPack: {
          contextPackId: 'context-1', ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1', policyVersion: 'policy-1',
          tokenBudget: 12000, estimatedTokens: 5400, content: { opening: '...' }, contentHash: 'context-hash',
          lifecycleStatus: 'active', createdAt: manifest.createdAt, sources: [
            { ownerId: 'owner-1', bookId: 'book-1', sourceKey: 'opening-confirmed', sourceType: 'book_profile', sourceId: 'opening-3', sourceVersion: '3',
              authority: 'confirmed', decision: 'included', reason: '本次全书规划的正式起点', contentHash: 'source-1', estimatedTokens: 2100 },
            { ownerId: 'owner-1', bookId: 'book-1', sourceKey: 'old-plan', sourceType: 'planning', sourceId: 'plan-1', sourceVersion: '1',
              authority: 'candidate', decision: 'excluded', reason: '已经被作者否决', contentHash: 'source-2', estimatedTokens: 800 }
          ]
        },
        promptAssets: { rolePrompt, workstationPrompt: published, skills: [skill] },
        genreProfile: {
          profileId: 'genre-1', ownerId: 'owner-1', bookId: 'book-1', version: 1, status: 'active',
          primaryGenreKey: 'history', supportingGenreKeys: ['transmigration'], sourceAssetVersionIds: [], sourceBookVersion: 3,
          publicLabel: '历史穿越', workingIdentity: '历史穿越商业长篇', primaryPromise: '乱世崛起',
          supportingFunctions: [], writingPriorities: [], authenticityChecks: [], avoidPatterns: [], conflictResolutions: [],
          compiledByTaskId: 'task-genre', contentHash: 'genre-hash', createdAt: manifest.createdAt
        }
      });
      if (url.endsWith('/prompt-context/manifests/manifest-1/verify-rebuild') && init?.method === 'POST') return json({
        manifestId: 'manifest-1', matched: true, storedHash: 'prompt-hash', rebuiltHash: 'prompt-hash',
        checkedAt: '2026-08-28T10:00:00.000Z', summary: '已用冻结来源重建，结果与历史快照一致。',
        components: { taskContract: 'frozen', contextPack: 'frozen', rolePrompt: 'frozen', workstationPrompt: 'frozen', skills: '1/1', genreProfile: 'frozen' }
      });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('按真实资产键动作契约完成草稿保存、预览和发布，不打开弹窗', async () => {
    render(<PromptContextCenter />);
    expect(await screen.findByRole('tab', { name: '配置来源' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: '全书路线工位' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('用途说明'), { target: { value: draft.summary } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/assets/workstation.full_book_route/drafts'))).toBe(true));
    expect(await screen.findByText(/草稿已保存/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '检查编译结果' }));
    expect(await screen.findByText('可以发布')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '发布此版本' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/assets/workstation.full_book_route/publish'))).toBe(true));
    expect(await screen.findByText(/新版本已发布/)).toBeVisible();

    const draftCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/drafts'));
    expect(JSON.parse(String(draftCall?.[1]?.body))).toMatchObject({
      expectedRevision: 1, basedOnAssetId: published.assetId, kind: 'workstation_prompt'
    });
    const previewCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/preview'));
    expect(JSON.parse(String(previewCall?.[1]?.body))).toEqual({ assetId: draft.assetId, manifestId: 'manifest-1' });
    const publishCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/publish'));
    expect(JSON.parse(String(publishCall?.[1]?.body))).toMatchObject({ assetId: draft.assetId, expectedRevision: 2 });
  });

  it('运行追溯按真实嵌套结构展示任务合同、配置版本和资料来源', async () => {
    render(<PromptContextCenter />);
    fireEvent.click(await screen.findByRole('tab', { name: '运行追溯' }));
    expect(await screen.findByText('本次 PromptManifest')).toBeVisible();
    expect(screen.getByText('manifest-1')).toBeVisible();
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getByText(/任务已经完成，并保存了可核对的结果/)).toBeVisible();
    expect(screen.getByText('规划方案')).toBeVisible();
    expect(screen.getByText(/只证明本次下发内容已经留档/)).toBeVisible();
    expect(await screen.findByText('本次任务合同')).toBeVisible();
    expect(screen.getByText('设计三种全书粗路线')).toBeVisible();
    expect(screen.getByText('本书题材工作档案')).toBeVisible();
    expect(screen.getByText('历史穿越商业长篇')).toBeVisible();
    expect(screen.getByText('history；transmigration')).toBeVisible();
    expect(screen.getByText('opening-confirmed')).toBeVisible();
    fireEvent.click(screen.getByText(/查看未采用的资料/));
    expect(screen.getByText('old-plan')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重建核对历史快照' }));
    expect(await screen.findByText(/结果与历史快照一致/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/verify-rebuild'))).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('历史发布版本只能恢复成新草稿，不直接覆盖当前版本', async () => {
    render(<PromptContextCenter />);
    fireEvent.click(await screen.findByText(/查看版本记录/));
    fireEvent.click(screen.getByRole('button', { name: '恢复为草稿' }));
    expect(await screen.findByText(/已把第 1 版恢复成新草稿/)).toBeVisible();
    const restoreCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/restore-draft'));
    expect(JSON.parse(String(restoreCall?.[1]?.body))).toMatchObject({
      sourceAssetId: published.assetId, expectedRevision: 1
    });
    expect(screen.getByRole('heading', { name: '全书路线工位' })).toBeVisible();
  });

  it('当前编辑内容可与任一历史版本并排比较名称、说明和结构化规则', async () => {
    const currentDraft = version({
      ...draft, assetId: 'workstation.full_book_route@3', version: 3, governanceRevision: 3,
      title: '第三版全书路线工位', summary: '第三版用途说明。',
      content: { workstationKey: 'full_book_route', responsibility: '第三版路线责任', qualityChecks: ['第三版检查'] }
    });
    const secondVersion = version({
      ...published, assetId: 'workstation.full_book_route@2', version: 2, status: 'published',
      title: '第二版全书路线工位', summary: '第二版用途说明。',
      content: { workstationKey: 'full_book_route', responsibility: '第二版路线责任', qualityChecks: ['第二版检查'] }
    });
    const firstVersion = version({
      ...published, status: 'retired', title: '第一版全书路线工位', summary: '第一版用途说明。'
    });
    currentVersions = [currentDraft, secondVersion, firstVersion];

    render(<PromptContextCenter />);
    fireEvent.click(await screen.findByText(/查看版本记录/));

    expect(await screen.findByRole('region', { name: '版本并排比较' })).toBeVisible();
    expect(screen.getByText('当前编辑 · 第 3 版')).toBeVisible();
    expect(screen.getByText('历史对照 · 第 2 版')).toBeVisible();
    expect(screen.getAllByText('有变化')).toHaveLength(6);
    expect(screen.getByLabelText('当前编辑 · 第 3 版的结构化规则')).toHaveTextContent('第三版路线责任');
    expect(screen.getByLabelText('历史对照 · 第 2 版的结构化规则')).toHaveTextContent('第二版路线责任');

    fireEvent.change(screen.getByLabelText('选择要比较的历史版本'), { target: { value: firstVersion.assetId } });
    expect(screen.getByText('历史对照 · 第 1 版')).toBeVisible();
    expect(screen.getByText('第一版全书路线工位')).toBeVisible();
    expect(screen.getByText('第一版用途说明。')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('切换配置与运行结果筛选时只选择当前可见对象，并正确显示取消状态', async () => {
    const cancelledManifest = {
      ...manifest,
      manifestId: 'manifest-2',
      taskId: 'task-2',
      execution: { ...manifest.execution, state: 'cancelled', summary: '任务已由管理员取消。', completedAt: null }
    };
    const mixedAssets = [assetListItem([published]), assetListItem([rolePrompt])];
    const scopedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/prompt-context/summary')) return json(summary(1, [published, rolePrompt]));
      if (url.endsWith('/prompt-context/assets')) return json(mixedAssets);
      if (url.endsWith('/assets/workstation.full_book_route/versions')) return json([published]);
      if (url.endsWith('/assets/role.chief_editor/versions')) return json([rolePrompt]);
      if (url.includes('/prompt-context/manifests?')) return json([manifest, cancelledManifest]);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', scopedFetch);

    render(<PromptContextCenter />);
    expect(await screen.findByRole('heading', { name: '全书路线工位' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '固定岗位提示词' }));
    expect(await screen.findByRole('heading', { name: '全案策划主编' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '全书路线工位' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '运行追溯' }));
    fireEvent.change(screen.getByLabelText('任务结果'), { target: { value: 'cancelled' } });
    const cancelledBadge = await screen.findByText('已取消', { selector: 'em' });
    expect(cancelledBadge.closest('button')).toHaveClass('active');
    expect(screen.queryByText('状态未知')).not.toBeInTheDocument();
  });
});

function version(overrides: Partial<V7PromptAssetVersion>): V7PromptAssetVersion {
  return {
    assetId: 'asset@1', assetKey: 'asset', kind: 'workstation_prompt' as const, version: 1, status: 'published' as const,
    title: '配置', summary: '说明', content: {}, contentHash: 'hash-1', basedOnVersion: null, basedOnAssetId: null,
    governanceRevision: 1, createdAt: '2026-08-28T08:00:00.000Z', createdBy: 'admin-1', publishedBy: 'admin-1',
    publishedAt: '2026-08-28T08:00:00.000Z', retiredBy: null, retiredAt: null, ...overrides
  };
}

function summary(governanceRevision: number, versions: Array<ReturnType<typeof version>>) {
  return {
    revision: governanceRevision, assetKeyCount: 1, versionCount: versions.length,
    draftCount: versions.filter((item) => item.status === 'draft').length,
    publishedCount: versions.filter((item) => item.status === 'published').length,
    retiredCount: versions.filter((item) => item.status === 'retired').length,
    genreProfileCount: 1, taskContractCount: 1, contextPackCount: 1, manifestCount: 1,
    safeguards: { immutableHistory: true, optimisticRevision: true, secretPersistenceBlocked: true,
      hiddenReasoningPersistenceBlocked: true, runtimeBundleScopeBound: true }
  };
}

function assetListItem(versions: Array<ReturnType<typeof version>>) {
  const latest = versions[0] ?? published;
  return {
    assetKey: latest.assetKey, kind: latest.kind, latestVersion: Math.max(...versions.map((item) => item.version)),
    published: versions.find((item) => item.status === 'published') ?? null,
    latestDraft: versions.find((item) => item.status === 'draft') ?? null,
    versionCount: versions.length
  };
}

function pickPreviewAsset(item: ReturnType<typeof version>) {
  const { assetId, assetKey, kind, version: itemVersion, status, title, summary: itemSummary, contentHash, basedOnAssetId } = item;
  return { assetId, assetKey, kind, version: itemVersion, status, title, summary: itemSummary, contentHash, basedOnAssetId };
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}
