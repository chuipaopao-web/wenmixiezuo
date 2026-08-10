// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createAuthorPlanningInput: vi.fn(),
  discardAuthorAttachment: vi.fn(),
  fetchAuthorPlanningInputs: vi.fn(),
  uploadAuthorAttachment: vi.fn()
}));

vi.mock('../../../apps/web/src/lib/api/client', () => api);

import { AuthorIdeaComposer } from '../../../apps/web/src/features/creation-desk/AuthorIdeaComposer';

const savedIdea = {
  ownerId: 'owner-1', bookId: 'book-1', authorInputId: 'idea-1',
  surface: 'event' as const, subjectType: 'story_event', subjectId: 'event-1',
  intentStrength: 'inspiration' as const, originalText: '让主角用旧线索取胜。',
  originalTextHash: 'a'.repeat(64), attachmentRefs: [], mentionedAgentIds: ['agent-1'],
  scopeNotes: '只影响当前事件。', status: 'new' as const, appliedToRefs: [],
  handlingReason: null, links: [], createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z', decidedAt: null
};

beforeEach(() => {
  api.fetchAuthorPlanningInputs.mockResolvedValue([]);
  api.createAuthorPlanningInput.mockResolvedValue(savedIdea);
  api.discardAuthorAttachment.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('作者想法输入', () => {
  it('切换必须遵守时不再聚焦隐藏控件或让页面跳走', async () => {
    render(<AuthorIdeaComposer bookId="book-1" surface="book_profile" subjectType="book" subjectId="book-1" />);
    await screen.findByRole('textbox', { name: '你的原话' });

    const mustFollow = screen.getByRole('radio', { name: '必须遵守' });
    expect(mustFollow.tagName).toBe('BUTTON');
    expect(document.querySelector('.author-intent-options input[type="radio"]')).toBeNull();
    fireEvent.click(mustFollow);

    expect(mustFollow).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: '你的原话' })).toBeVisible();
    expect(screen.getByText('只影响哪里？（可不填）')).toBeVisible();
  });
  it('在规划中保留原话、意图、作用范围和点名成员', async () => {
    render(<AuthorIdeaComposer
      bookId="book-1"
      surface="event"
      subjectType="story_event"
      subjectId="event-1"
      agents={[{ agentId: 'agent-1', displayName: '编剧甲', roleName: '编剧' }]}
    />);

    await waitFor(() => expect(api.fetchAuthorPlanningInputs).toHaveBeenCalledWith(
      'book-1', { surface: 'event', subjectType: 'story_event', subjectId: 'event-1' }, expect.any(AbortSignal)
    ));
    fireEvent.change(screen.getByRole('textbox', { name: '你的原话' }), {
      target: { value: '让主角用旧线索取胜。' }
    });
    fireEvent.click(screen.getByRole('radio', { name: '灵感参考' }));
    fireEvent.change(screen.getByRole('textbox', { name: '只影响哪里？（可不填）' }), {
      target: { value: '只影响当前事件。' }
    });
    fireEvent.click(screen.getByText('点名成员（可不选）'));
    fireEvent.click(screen.getByRole('checkbox', { name: '编剧甲 · 编剧' }));
    fireEvent.click(screen.getByRole('button', { name: '保存给AI参考' }));

    await waitFor(() => expect(api.createAuthorPlanningInput).toHaveBeenCalledTimes(1));
    expect(api.createAuthorPlanningInput).toHaveBeenCalledWith('book-1', expect.objectContaining({
      surface: 'event', subjectType: 'story_event', subjectId: 'event-1',
      intentStrength: 'inspiration', originalText: '让主角用旧线索取胜。',
      scopeNotes: '只影响当前事件。', attachmentRefs: [], mentionedAgentIds: ['agent-1'],
      idempotencyKey: expect.stringMatching(/^author-idea:/u)
    }), expect.any(AbortSignal));
  });

  it('取消保存后沿用同一幂等键重试，避免重复记录', async () => {
    api.createAuthorPlanningInput
      .mockImplementationOnce((_bookId: string, _input: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      }))
      .mockResolvedValueOnce(savedIdea);
    render(<AuthorIdeaComposer bookId="book-1" surface="event" subjectType="story_event" subjectId="event-1" />);
    await screen.findByRole('textbox', { name: '你的原话' });
    fireEvent.change(screen.getByRole('textbox', { name: '你的原话' }), { target: { value: '保留这条想法。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存给AI参考' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('再次点击保存会沿用同一请求');
    fireEvent.click(screen.getByRole('button', { name: '保存给AI参考' }));

    await waitFor(() => expect(api.createAuthorPlanningInput).toHaveBeenCalledTimes(2));
    const firstInput = api.createAuthorPlanningInput.mock.calls[0]?.[1] as { idempotencyKey: string };
    const secondInput = api.createAuthorPlanningInput.mock.calls[1]?.[1] as { idempotencyKey: string };
    expect(secondInput.idempotencyKey).toBe(firstInput.idempotencyKey);
  });
});
