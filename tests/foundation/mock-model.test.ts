import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '../../apps/api/src/infrastructure/models/deterministic-model.js';
import {
  countNovelCharacters, DeterministicNovelWriterAdapter
} from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { parseMasterOutlineDepositOutput } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { parseSettingOutlineDeposit } from '../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { parseModelJsonFields, parseSettingQualityAudit } from '../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { parseVolumePlanContent } from '../../apps/contracts/src/workflow.js';

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

  it('第一卷确定性方案带具体路线和爆款开局约束', async () => {
    const adapter = new DeterministicModelAdapter();
    const generated = await adapter.generate({
      ...request,
      prompt: JSON.stringify({
        operation: 'volume_plan_generation_v1',
        book: { volumeNumber: 1 },
        seat: { roleKey: 'lead_screenwriter', mode: 'independent' }
      })
    });
    const volume = parseVolumePlanContent(JSON.parse(generated.output));
    expect(volume.routeCard?.escalationPath.length).toBeGreaterThanOrEqual(3);
    expect(volume.storySpine?.protectedOpenSpace.length).toBeGreaterThan(0);
    expect(volume.firstVolumeLaunch?.goldenThree.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3]);
    expect(volume.firstVolumeLaunch?.majorClimax.latestEffectiveCharacters).toBeLessThanOrEqual(100_000);
  });

  it('按事件预计体量生成连续章链，不把测试模型硬编码为三章', async () => {
    const adapter = new DeterministicModelAdapter();
    const storyEvent = {
      title: '十章事件', startingState: '事件起点', requiredResult: '事件在第十章闭环', nextEventImpact: '下一事件被触发',
      endingConditions: ['核心问题解决', '人物关系变化'], estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 },
      localProgression: [
        '试训压力落到主角身上并迫使表态', '试训确认规则与第一处异常', '试训让同伴主动加入并提出不同判断', '试训第一次执行受阻并暴露真实代价', '试训对手根据主角行动调整策略',
        '试训队伍因目标差异发生分歧', '试训用可核验证据找到新路径', '试训付出代价完成中段反制', '试训多名角色并行完成决战准备', '试训兑现事件结果并形成下一事件接口'
      ]
    };
    const generated = await adapter.generate({
      ...request,
      prompt: JSON.stringify({ operation: 'event_chapter_sequence_generation_v1', startChapterNumber: 1, sources: [
        { sourceType: 'planning:story_event', sourceId: 'event-1', content: JSON.stringify(storyEvent) }
      ] })
    });
    const sequence = JSON.parse(generated.output) as {
      chapters: Array<{ chapterNumber: number; title: string; openingState: string; endingState: string }>;
      closureCoverage: Array<{ evidenceChapterNumber: number }>
    };
    expect(sequence.chapters).toHaveLength(10);
    expect(sequence.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sequence.chapters[0]?.title).toBe('试训·局势逼人');
    expect(sequence.chapters[9]?.title).toBe('试训·结果兑现');
    sequence.chapters.slice(1).forEach((chapter, index) => {
      expect(chapter.openingState).toBe(sequence.chapters[index]!.endingState);
    });
    expect(sequence.closureCoverage.every((item) => item.evidenceChapterNumber === 10)).toBe(true);
  });

  it('为整份设定质检返回可通过真实门禁的结构', async () => {
    const adapter = new DeterministicModelAdapter();
    const generated = await adapter.generate({
      ...request,
      prompt: '你是当前书籍的活动主编。\n【整份设定质检资料包】\n全部已确认设定：[]'
    });

    expect(parseSettingQualityAudit(parseModelJsonFields(generated.output))).toEqual(expect.objectContaining({
      verdict: 'pass', issues: []
    }));
  });

  it('为设定对象融合返回可落库结构，不依赖已删除的聊天确认流程', async () => {
    const adapter = new DeterministicModelAdapter();
    const generated = await adapter.generate({
      ...request,
      prompt: [
        '你是当前书籍的活动主编。',
        '老板的问题：【设定大纲成组讨论资料包】',
        '本批设定项JSON：[{"itemKey":"creative-concept","label":"策划理念"}]',
        '作者本轮原话：每卷围绕一件普通失物展开，所有结论必须来自现实证据。'
      ].join('\n')
    });

    expect(parseSettingOutlineDeposit(generated.output)).toEqual([{
      itemKey: 'creative-concept',
      content: '每卷围绕一件普通失物展开，所有结论必须来自现实证据。'
    }]);
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

  it('正文验收写手读取正式上下文包，不会把修仙书写成固定的旧城悬疑样稿', async () => {
    const adapter = new DeterministicNovelWriterAdapter();
    const draft = await adapter.generate({ ...request, bookId: 'xianxia-context-book', prompt: JSON.stringify({
      phase: 'draft', contextPackHash: 'hash',
      sources: [
        { sourceType: 'chapter_work_order', content: '第1章：沈砚在试剑台拒签做过手脚的生死状，必须以阵纹借力而不是修为暴涨。' },
        { sourceType: 'opening_profile', content: JSON.stringify({
          title: '烬骨问天', category: '东方仙侠',
          protagonists: [{ name: '沈砚' }],
          storyDirection: '沈砚与许小川在试剑台对抗韩烈，追查宗门阵法与灵矿黑账。',
          mustFollow: ['残缺阵盘只能看见阵纹破绽，不能提供无限力量']
        }) }
      ],
      taskInput: { operation: 'draft', chapterNumber: 1, title: '生死状锁命', previousState: '故事刚刚开始' }
    }) });
    expect(draft.output).toContain('沈砚');
    expect(draft.output).toContain('试剑台');
    expect(draft.output).toContain('韩烈');
    expect(draft.output).not.toContain('林澈');
    expect(draft.output).not.toContain('铜钥匙');
    expect(countNovelCharacters(draft.output)).toBeGreaterThanOrEqual(2_500);
    expect(countNovelCharacters(draft.output)).toBeLessThanOrEqual(3_500);
  });
});
