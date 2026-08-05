import { describe, expect, it } from 'vitest';
import {
  compactStageSettlementContext,
  stageResultSummary,
  stageTitleFromKey
} from '../../../apps/api/src/application/continuity/stage-settlement-presentation.js';

describe('阶段结算展示与主笔胶囊', () => {
  const irreversibleResults = [
    { factId: 'hidden-1', relationKey: 'ordinary.fact', value: '普通背景事实' },
    { factId: 'hidden-2', relationKey: 'protagonist_delta.investigation.decision', value: '林澄决定只按可复核证据推进调查' },
    { factId: 'hidden-3', relationKey: 'relationship.trust', value: '林澄与罗知建立有限协作' },
    { factId: 'hidden-4', relationKey: 'protagonist_delta.counter', value: '+1' }
  ];

  it('从阶段键提取作者可读标题', () => {
    expect(stageTitleFromKey('story-arc:1-10:明日归还单')).toBe('明日归还单');
  });

  it('从结构化事实中提炼高价值变化，不泄露内部ID和键名', () => {
    const summary = stageResultSummary(irreversibleResults);
    expect(summary).toContain('林澄决定只按可复核证据推进调查');
    expect(summary).toContain('林澄与罗知建立有限协作');
    expect(summary).not.toContain('hidden-');
    expect(summary).not.toContain('protagonist_delta');
    expect(summary).not.toContain('+1');
  });

  it('把阶段记忆压缩在600字符内并保留来源下钻提示', () => {
    const capsule = compactStageSettlementContext([{
      stageKey: 'story-arc:1-10:明日归还单',
      chapterStart: 1,
      chapterEnd: 10,
      payload: { irreversibleResults, openThreads: [{ title: '匿名信息源' }] }
    }], 600);
    expect(capsule).toContain('已定稿阶段《明日归还单》（第1—10章）');
    expect(capsule).toContain('仍有1项开放线索');
    expect(capsule.length).toBeLessThanOrEqual(600);
    expect(capsule).not.toContain('factId');
  });
});
