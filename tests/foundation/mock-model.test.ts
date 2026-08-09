import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '../../apps/api/src/infrastructure/models/deterministic-model.js';
import { DeterministicNovelWriterAdapter } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { parseMasterOutlineDepositOutput } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';

const request = {
  requestId: 'request-1',
  taskId: 'task-1',
  ownerId: 'owner-1',
  bookId: 'book-1',
  agentId: 'agent-1',
  prompt: '生成一个测试结果',
  maxOutputTokens: 100
};

describe('确定性假模型', () => {
  it('相同输入生成相同输出且现金费用为零', async () => {
    const adapter = new DeterministicModelAdapter();
    const first = await adapter.generate(request);
    const second = await adapter.generate(request);
    expect(first.output).toBe(second.output);
    expect(first.cashCostCny).toBe(0);
    expect(first.provider).toBe('local-deterministic');
  });

  it('尊重真实取消信号', async () => {
    const adapter = new DeterministicModelAdapter();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(adapter.generate(request, controller.signal)).rejects.toThrow('cancelled');
  });

  it('在零费用测试模式为不同规划阶段返回各自的结构合同', async () => {
    const adapter = new DeterministicModelAdapter();
    const master = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。剧情总纲落库 输出合同'
    });
    const chapters = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。规划落库 输出合同'
    });

    expect(master.output).toContain('剧情总纲落库');
    const parsedMaster = parseMasterOutlineDepositOutput(master.output);
    expect(parsedMaster?.outlineSchema).toBe('stage_master_v2');
    expect(parsedMaster?.majorStages[0]?.chapterRange).toEqual({ start: 1, end: 24 });
    expect(parsedMaster?.majorStages[0]?.pendingThreads).toBeDefined();
    expect(chapters.output).toContain('规划落库');
    expect(master.output).not.toBe(chapters.output);
  });

  it('按事件预计体量生成连续章链，不把测试模型硬编码为三章', async () => {
    const adapter = new DeterministicModelAdapter();
    const storyEvent = {
      title: '十章事件', startingState: '事件起点', requiredResult: '事件在第十章闭环', nextEventImpact: '下一事件被触发',
      endingConditions: ['核心问题解决', '人物关系变化'], estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 }
    };
    const generated = await adapter.generate({
      ...request,
      prompt: JSON.stringify({ operation: 'event_chapter_sequence_generation_v1', startChapterNumber: 1, sources: [
        { sourceType: 'planning:story_event', sourceId: 'event-1', content: JSON.stringify(storyEvent) }
      ] })
    });
    const sequence = JSON.parse(generated.output) as {
      chapters: Array<{ chapterNumber: number; openingState: string; endingState: string }>;
      closureCoverage: Array<{ evidenceChapterNumber: number }>
    };
    expect(sequence.chapters).toHaveLength(10);
    expect(sequence.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    sequence.chapters.slice(1).forEach((chapter, index) => {
      expect(chapter.openingState).toBe(sequence.chapters[index]!.endingState);
    });
    expect(sequence.closureCoverage.every((item) => item.evidenceChapterNumber === 10)).toBe(true);
  });

  it('正文写手不会把上一章机器状态JSON复制进可见正文，重写也会清除已有泄露', async () => {
    const adapter = new DeterministicNovelWriterAdapter();
    const previousState = JSON.stringify({ chapterNumber: 2, continuityAnchors: { identifiers: ['MV-SECRET'] } });
    const draft = await adapter.generate({ ...request, prompt: JSON.stringify({
      operation: 'draft', chapterNumber: 3, title: '继续追查', previousState
    }) });
    expect(draft.output).not.toContain('chapterNumber');
    expect(draft.output).not.toContain('continuityAnchors');
    expect(draft.output).not.toContain('MV-SECRET');

    const rewrite = await adapter.generate({ ...request, prompt: JSON.stringify({
      operation: 'rewrite',
      content: `雨声压低。${previousState}，林澈推门而入。`,
      requiredActions: ['删除正文中的内部工作流载荷']
    }) });
    expect(rewrite.output).not.toContain('chapterNumber');
    expect(rewrite.output).not.toContain('continuityAnchors');
    expect(rewrite.output).not.toContain('MV-SECRET');
  });
});
