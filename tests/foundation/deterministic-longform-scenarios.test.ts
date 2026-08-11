import { describe, expect, it } from 'vitest';
import {
  countNovelCharacters,
  DeterministicNovelCandidateBAdapter,
  DeterministicNovelWriterAdapter,
  deterministicFactCandidates
} from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';

const baseRequest = {
  requestId: 'longform-request',
  taskId: 'longform-task',
  ownerId: 'owner-1',
  bookId: 'book-1',
  agentId: 'agent-1',
  maxOutputTokens: 4_000
};

function draftPrompt(chapterNumber: number, title: string, sources: Array<{ sourceType: string; content: string }>): string {
  return JSON.stringify({
    phase: 'draft', contextPackHash: `hash-${chapterNumber}`, sources,
    taskInput: { operation: 'draft', chapterNumber, title, previousState: '上一章结果已经进入当前人物状态' }
  });
}

describe('确定性长篇题材场景', () => {
  it('仅凭首章标题也能把新领主与斗罗场景路由到专用写手', async () => {
    const adapter = new DeterministicNovelWriterAdapter();
    const lord = await adapter.generate({
      ...baseRequest,
      bookId: 'game-lord-title-route',
      prompt: draftPrompt(1, '接管晨星领·压力落地', [])
    });
    const douluo = await adapter.generate({
      ...baseRequest,
      bookId: 'douluo-title-route',
      prompt: draftPrompt(1, '武魂觉醒战·压力落地', [])
    });

    expect(lord.output).toContain('苏砚');
    expect(lord.output).toContain('晨星领');
    expect(lord.output).toContain('领主面板');
    expect(lord.output).not.toContain('林澈');
    expect(douluo.output).toContain('顾星河');
    expect(douluo.output).toContain('银羽');
    expect(douluo.output).toContain('斗罗大陆');
    expect(douluo.output).not.toContain('林澈');
  });

  it('修仙正文超过二十章后继续推进新事件，不重复猎场终章', async () => {
    const adapter = new DeterministicNovelWriterAdapter();
    const sources = [{
      sourceType: 'opening_profile',
      content: JSON.stringify({
        category: '东方仙侠', protagonists: [{ name: '沈砚' }],
        direction: '沈砚与许小川、苏青萝、阿九追查魏长庚、韩烈与灵矿黑账，百章卷末在九峰公审翻案。'
      })
    }];
    const chapter21 = await adapter.generate({ ...baseRequest, bookId: 'xianxia-100', prompt: draftPrompt(21, '灵矿门前', sources) });
    const chapter100 = await adapter.generate({ ...baseRequest, bookId: 'xianxia-100', prompt: draftPrompt(100, '九峰公审', sources) });

    expect(chapter21.output).toContain('灵矿总阵');
    expect(chapter100.output).toContain('九峰公审台');
    expect(chapter21.output).not.toBe(chapter100.output);
    expect(chapter100.output).not.toContain('林澈');
    expect(chapter100.output).not.toContain('铜钥匙');
    expect(countNovelCharacters(chapter21.output)).toBeGreaterThanOrEqual(2_500);
    expect(countNovelCharacters(chapter100.output)).toBeLessThanOrEqual(3_500);
  });

  it('游戏电竞数据流正文使用独立人物、规则和百章事件，不落入旧城悬疑样稿', async () => {
    const adapter = new DeterministicNovelWriterAdapter();
    const sources = [{
      sourceType: 'opening_profile',
      content: JSON.stringify({
        category: '游戏体育', tags: ['电子竞技', '数据流', '战队群像'],
        protagonists: [{ name: '顾野' }],
        direction: '顾野与唐梨、陆沉舟、乔麦从零帧战队打入联赛总决赛，对抗邵锋并追查罗放的数据篡改链。'
      })
    }];
    const chapter1 = await adapter.generate({ ...baseRequest, bookId: 'esports-100', prompt: draftPrompt(1, '公开试训', sources) });
    const chapter100 = await adapter.generate({ ...baseRequest, bookId: 'esports-100', prompt: draftPrompt(100, '全球总决赛', sources) });

    for (const name of ['顾野', '唐梨', '陆沉舟', '乔麦', '邵锋', '罗放']) expect(chapter100.output).toContain(name);
    for (const term of ['帧率', '经济曲线', '视野', '总决赛']) expect(chapter100.output).toContain(term);
    expect(chapter1.output).toContain('零帧公开试训室');
    expect(chapter100.output).toContain('全球总决赛与联盟听证会');
    expect(chapter100.output).not.toContain('林澈');
    expect(chapter100.output).not.toContain('铜钥匙');
    expect(chapter100.output).not.toContain('沈砚');
    expect(countNovelCharacters(chapter1.output)).toBeGreaterThanOrEqual(2_500);
    expect(countNovelCharacters(chapter100.output)).toBeLessThanOrEqual(3_500);
  });

  it('备选写手重写既保留人物称谓，也清除内部载荷', async () => {
    const adapter = new DeterministicNovelCandidateBAdapter();
    const payload = JSON.stringify({ chapterNumber: 7, sourceId: 'secret-source' });
    const rewritten = await adapter.generate({
      ...baseRequest,
      prompt: JSON.stringify({
        operation: 'rewrite',
        content: `顾野说他会先核对数据。${payload}唐梨没有替他做决定。`,
        requiredActions: ['删除内部载荷并保持人物不变']
      })
    });
    expect(rewritten.output).toContain('顾野');
    expect(rewritten.output).toContain('唐梨');
    expect(rewritten.output).not.toContain('林澈');
    expect(rewritten.output).not.toContain('sourceId');
    expect(rewritten.output).not.toContain('secret-source');
  });

  it('事实审查为仙侠和电竞正文沉淀人物、势力、地点、道具资源、章节行动与关系', () => {
    const xianxia = deterministicFactCandidates('第21章 灵矿门前\n\n晨雾落下，灵矿总阵的灵灯逐一亮起。沈砚与许小川带着残缺阵盘和灵石进入青霄宗灵矿，苏青萝留在阵外接应。');
    const esports = deterministicFactCandidates('第61章 季后赛\n\n灯带亮起，季后赛败者组还没喧闹起来。顾野与唐梨代表零帧核对比赛记录和设备合同，陆沉舟负责先手。');

    expect(xianxia).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectName: '沈砚', relationKey: 'event.chapter_021', storyTimeStart: '第21章' }),
      expect.objectContaining({ subjectName: '灵矿总阵', entityType: 'location' }),
      expect.objectContaining({ subjectName: '青霄宗', entityType: 'organization' }),
      expect.objectContaining({ subjectName: '残缺阵盘', entityType: 'item' }),
      expect.objectContaining({ subjectName: '灵石', entityType: 'resource' }),
      expect.objectContaining({ subjectName: '沈砚', relationKey: 'relationship.许小川.cooperation', value: '许小川' })
    ]));
    expect(esports).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectName: '顾野', relationKey: 'event.chapter_061', storyTimeStart: '第61章' }),
      expect.objectContaining({ subjectName: '季后赛败者组', entityType: 'location' }),
      expect.objectContaining({ subjectName: '零帧', entityType: 'organization' }),
      expect.objectContaining({ subjectName: '合同', entityType: 'item' }),
      expect.objectContaining({ subjectName: '比赛记录', entityType: 'resource' }),
      expect.objectContaining({ subjectName: '顾野', relationKey: 'relationship.唐梨.cooperation', value: '唐梨' })
    ]));
    for (const candidate of [...xianxia, ...esports]) {
      expect(String(candidate.evidenceQuote)).not.toMatch(/(?:workflowArtifact|sourceId|book_id)/u);
    }
  });
});
