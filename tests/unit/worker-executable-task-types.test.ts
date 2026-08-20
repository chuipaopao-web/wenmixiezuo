import { expect, it } from 'vitest';
import { EXECUTABLE_TASK_TYPES } from '../../apps/worker/src/runtime/worker-loop.js';

it('Worker 注册全部由内部执行接口支持的创作任务', () => {
  expect(EXECUTABLE_TASK_TYPES).toEqual(new Set([
    'chapter_creation', 'discussion', 'continuation_analysis', 'volume_plan_generation',
    'event_chain_generation', 'book_branding_design', 'story_event_generation',
    'event_chapter_sequence_generation', 'event_chapter_detail_generation',
    'event_chapter_sequence_challenge', 'event_chapter_detail_challenge', 'settlement_follow_up'
  ]));
});