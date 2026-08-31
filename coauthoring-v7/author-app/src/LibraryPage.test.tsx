import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryPage } from './LibraryPage';

function response<T>(data: T): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('按卷链章展示正式资料，并在当前页面展开正文', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/creation-library')) return response({ volumes: [{
      volumeScopeId: 'volume-1', status: 'completed', latestWorkflowId: 'workflow-1', chains: [{
        chainScopeId: 'chain-1', workflowId: 'workflow-1', status: 'completed', outline: {
          sequenceId: 'outline-1', revision: 1, status: 'confirmed', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1', review: null,
          content: { publicSummary: '主角完成第一次守粮任务。', chapterStart: 1, chapterEnd: 1, chapters: [] },
          chapters: [{
            chapter: {
              chapterNumber: 1, title: '雪夜守粮', objective: '守住第一批粮食。', openingHook: '粮仓外突然起火。',
              sceneSetup: '雪夜粮仓', protagonistChoice: '主动组织灭火', opposition: '内应破坏', turn: '火只是诱饵',
              emotionalMovement: '紧张到振奋', payoff: '保住粮食并找到内应', continuity: '承接流民求生', openQuestions: [], nextChapterInterface: '追查幕后人'
            },
            manuscript: { manuscriptVersionId: 'manuscript-1', revision: 1, status: 'final', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1', review: null }
          }]
        }
      }]
    }] });
    if (url.endsWith('/manuscripts/manuscript-1')) return response({
      manuscriptVersionId: 'manuscript-1', workflowId: 'workflow-1', sequenceId: 'outline-1', chapterNumber: 1,
      revision: 1, status: 'final', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1',
      content: '雪落得很密，粮仓外的火光却越来越亮。', review: null, createdAt: '2026-08-30T00:00:00Z', finalizedAt: '2026-08-30T00:10:00Z'
    });
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<LibraryPage bookId="book-1" />);
  expect(await screen.findByRole('heading', { name: '资料库' })).toBeVisible();
  expect(screen.getByText('主角完成第一次守粮任务。')).toBeVisible();
  expect(screen.getByText('雪夜守粮')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '查看正文' }));
  expect(await screen.findByText('雪落得很密，粮仓外的火光却越来越亮。')).toBeVisible();
  expect(screen.getByText('已定稿')).toBeVisible();
});

it('单章正文打开失败后可以原位重新打开', async () => {
  let manuscriptAttempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/creation-library')) return response({ volumes: [{
      volumeScopeId: 'volume-1', status: 'completed', latestWorkflowId: 'workflow-1', chains: [{
        chainScopeId: 'chain-1', workflowId: 'workflow-1', status: 'completed', outline: {
          sequenceId: 'outline-1', revision: 1, status: 'confirmed', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1', review: null,
          content: { publicSummary: '主角守住粮仓。', chapterStart: 1, chapterEnd: 1, chapters: [] },
          chapters: [{
            chapter: {
              chapterNumber: 1, title: '雪夜守粮', objective: '守住第一批粮食。', openingHook: '粮仓外突然起火。',
              sceneSetup: '雪夜粮仓', protagonistChoice: '主动组织灭火', opposition: '内应破坏', turn: '火只是诱饵',
              emotionalMovement: '紧张到振奋', payoff: '保住粮食', continuity: '承接流民求生', openQuestions: [], nextChapterInterface: '追查幕后人'
            },
            manuscript: { manuscriptVersionId: 'manuscript-retry-1', revision: 1, status: 'final', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1', review: null }
          }]
        }
      }]
    }] });
    if (url.endsWith('/manuscripts/manuscript-retry-1')) {
      manuscriptAttempts += 1;
      if (manuscriptAttempts === 1) throw new TypeError('network down');
      return response({
        manuscriptVersionId: 'manuscript-retry-1', workflowId: 'workflow-1', sequenceId: 'outline-1', chapterNumber: 1,
        revision: 1, status: 'final', memberKey: 'writer-1', reviewerMemberKey: 'reviewer-1',
        content: '第二次已安全打开正文。', review: null,
        createdAt: '2026-08-30T00:00:00Z', finalizedAt: '2026-08-30T00:10:00Z'
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<LibraryPage bookId="book-1" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看正文' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请检查网络后重试');
  fireEvent.click(screen.getByRole('button', { name: '重新打开正文' }));

  expect(await screen.findByText('第二次已安全打开正文。')).toBeVisible();
  expect(manuscriptAttempts).toBe(2);
});

it('没有正式资料时明确告诉作者从哪里产生内容', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ volumes: [] })));
  render(<LibraryPage bookId="book-empty" />);
  expect(await screen.findByText('还没有正式创作资料')).toBeVisible();
  expect(screen.getByText('确认卷、链和章后，这里会自动形成目录。')).toBeVisible();
});
