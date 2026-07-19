import { describe, expect, it } from 'vitest';
import {
  createEffectiveOutputReference,
  prepareEffectiveOutput
} from '../../apps/api/src/application/chat/effective-output-service.js';

describe('有效输出层', () => {
  it('把结构化岗位回复整理成结论优先的可见内容并保留完整依据', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '不建议立即宣战，应先确认张三的真正目标。',
      keyPoints: ['天安城仍受旧盟约保护', '双方兵力差距尚未核实'],
      alternatives: [{ title: '缓攻方案', content: '先切断粮道并逼迫谈判', tradeoff: '推进较慢，但能减少正面损失' }],
      risks: ['张三可能误判盟军态度'],
      questions: ['这次宣战是否需要公开进行？'],
      nextStep: '由两名编剧分别推演直接宣战与缓攻的章节跨度。',
      details: '证据来自旧盟约、天安城守军记录和张三最近三章的行为。'
    }));

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('不建议立即宣战');
    expect(result.visibleContent).toContain('天安城仍受旧盟约保护');
    expect(result.visibleContent).toContain('缓攻方案');
    expect(result.visibleContent).toContain('张三可能误判盟军态度');
    expect(result.visibleContent).toContain('这次宣战是否需要公开进行');
    expect(result.visibleContent).not.toContain('证据来自旧盟约');
    expect(result.fullContent).toContain('证据来自旧盟约');

    const reference = createEffectiveOutputReference(result);
    expect(reference).toMatchObject({ type: 'effective_output', version: 1, format: 'structured' });
    expect(reference?.fullContent).toBe(result.fullContent);
    expect(reference?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('兼容代码围栏并只读取白名单字段', () => {
    const result = prepareEffectiveOutput(`\`\`\`json\n${JSON.stringify({
      answer: '先核对人物状态。', keyPoints: [], risks: ['前文存在生死冲突'],
      questions: [], nextStep: null, details: '', internalReasoning: '不得进入可见内容'
    })}\n\`\`\``);

    expect(result.visibleContent).toContain('前文存在生死冲突');
    expect(result.fullContent).not.toContain('internalReasoning');
    expect(result.fullContent).not.toContain('不得进入可见内容');
  });

  it('非结构化回答只删除确定无信息的套话与完全重复段落', () => {
    const result = prepareEffectiveOutput([
      '好的。',
      '',
      '结论：先讨论张三为什么宣战。',
      '',
      '风险：旧盟约可能让天安城获得援军。',
      '',
      '风险：旧盟约可能让天安城获得援军。',
      '',
      '下一步：请两名编剧分别推演。'
    ].join('\n'));

    expect(result.format).toBe('fallback');
    expect(result.visibleContent).not.toContain('好的。');
    expect(result.visibleContent.match(/旧盟约可能让天安城获得援军/gu)).toHaveLength(1);
    expect(result.visibleContent).toContain('下一步：请两名编剧分别推演');
    expect(result.fullContent).toContain('好的。');
    expect(result.fullContent.match(/旧盟约可能让天安城获得援军/gu)).toHaveLength(2);
    expect(createEffectiveOutputReference(result)?.fullContent).toBe(result.fullContent);
    expect(result.filtered).toBe(true);
  });

  it('无法可靠拆分的长单段保持完整，不按字符数截断', () => {
    const longAnswer = `结论与风险都在同一段：${'张三必须保留判断空间，'.repeat(160)}最后仍需老板确认。`;
    const result = prepareEffectiveOutput(longAnswer);

    expect(result.visibleContent).toBe(longAnswer);
    expect(result.fullContent).toBe(longAnswer);
    expect(createEffectiveOutputReference(result)).toBeNull();
  });

  it('有界字段超出合同后原样回退，不丢内容', () => {
    const raw = JSON.stringify({
      answer: '结论',
      keyPoints: ['一', '二', '三', '四'],
      alternatives: [],
      risks: [],
      questions: [],
      nextStep: null,
      details: null
    });

    const result = prepareEffectiveOutput(raw);

    expect(result.format).toBe('fallback');
    expect(result.visibleContent).toBe(raw);
    expect(result.fullContent).toBe(raw);
  });

  it('讨论消息可以用完整参与者内容覆盖展开引用而不改变默认结论', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '主推荐采用缓攻方案。', keyPoints: ['保留联盟反转空间'], risks: ['节奏偏慢'],
      questions: [], nextStep: '确认后生成三章章纲', details: '主编完整补充'
    }));
    const fullDiscussion = '【婉儿】直接宣战方案\n【红玉】缓攻方案\n【貂蝉】主编完整补充';
    const reference = createEffectiveOutputReference(result, fullDiscussion);

    expect(reference?.fullContent).toBe(fullDiscussion);
    expect(reference?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.visibleContent).not.toContain('婉儿');
  });
});
