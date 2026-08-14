import { describe, expect, it } from 'vitest';
// Executable validation helpers are plain ESM modules and do not need declarations.
// @ts-expect-error test-only JavaScript helper
import { selectResumableChapterTask } from '../../scripts/evaluation/lib/resumable-chapter-task.mjs';

const task = (overrides: Record<string, unknown>) => ({
  taskId: 'task', chapterId: 'chapter-3', taskType: 'chapter_creation',
  status: 'blocked', currentPhase: 'review', attemptCount: 1, ...overrides
});

describe('resumable chapter task selection', () => {
  it('prefers a new working rewrite over an older blocked review', () => {
    const selected = selectResumableChapterTask([
      task({ taskId: 'old-blocked' }),
      task({ taskId: 'new-rewrite', status: 'working', currentPhase: 'draft' })
    ], 'chapter-3');
    expect(selected?.taskId).toBe('new-rewrite');
  });

  it('prefers a manuscript waiting for confirmation over a terminal task', () => {
    const selected = selectResumableChapterTask([
      task({ taskId: 'failed', status: 'failed', currentPhase: 'review' }),
      task({ taskId: 'waiting', status: 'waiting_confirmation', currentPhase: 'owner_confirmation' })
    ], 'chapter-3');
    expect(selected?.taskId).toBe('waiting');
  });

  it('uses the later API row when otherwise tied', () => {
    const selected = selectResumableChapterTask([
      task({ taskId: 'older', status: 'working', currentPhase: 'draft' }),
      task({ taskId: 'newer', status: 'working', currentPhase: 'draft' })
    ], 'chapter-3');
    expect(selected?.taskId).toBe('newer');
  });

  it('ignores tasks for other chapters and completed work', () => {
    const selected = selectResumableChapterTask([
      task({ taskId: 'other', chapterId: 'chapter-2', status: 'working' }),
      task({ taskId: 'done', status: 'succeeded', currentPhase: 'completed' })
    ], 'chapter-3');
    expect(selected).toBeNull();
  });
});
