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
    expect(createEffectiveOutputReference(result)).toBeNull();
    expect(result.filtered).toBe(true);
  });

  it('无法可靠拆分的长单段保持完整，不按字符数截断', () => {
    const longAnswer = `结论与风险都在同一段：${'张三必须保留判断空间，'.repeat(160)}最后仍需老板确认。`;
    const result = prepareEffectiveOutput(longAnswer);

    expect(result.visibleContent).toBe(longAnswer);
    expect(result.fullContent).toBe(longAnswer);
    expect(createEffectiveOutputReference(result)).toBeNull();
  });

  it('轻微超出建议条数时仍自然展示，不因合同偏差暴露JSON', () => {
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

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('结论');
    expect(result.visibleContent).toContain('- 四');
    expect(result.visibleContent).not.toContain('"keyPoints"');
  });

  it('结构化回复可保留主编整理后的补充依据而不暴露其他岗位原始协议', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '主推荐采用缓攻方案。', keyPoints: ['保留联盟反转空间'], risks: ['节奏偏慢'],
      questions: [], nextStep: '确认后生成三章章纲', details: '主编完整补充'
    }));
    const reference = createEffectiveOutputReference(result);

    expect(reference?.fullContent).toContain('主编完整补充');
    expect(reference?.fullContent).not.toContain('婉儿');
    expect(reference?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.visibleContent).not.toContain('婉儿');
  });

  it('解析合同版本化包装对象 {version,format,fields} 为自然中文且不裸露JSON', () => {
    // P0-3 / R01: 真实模型按 EFFECTIVE_OUTPUT_CONTRACT 返回 {version:1,format:'json_object',fields:{...}}，
    // 旧解析只认根级 answer 会失败并原样回退，导致围栏 JSON 裸露。双形态白名单解析后应输出自然中文。
    const result = prepareEffectiveOutput(JSON.stringify({
      version: 1,
      format: 'json_object',
      fields: {
        answer: '不建议立即宣战，应先核实兵力。',
        keyPoints: ['旧盟约仍在'],
        risks: ['援军可能介入'],
        questions: [],
        alternatives: [],
        nextStep: null,
        details: null,
        internalReasoning: '不得进入可见内容'
      }
    }));

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('不建议立即宣战');
    expect(result.visibleContent).toContain('旧盟约仍在');
    expect(result.visibleContent).not.toContain('internalReasoning');
    expect(result.visibleContent).not.toContain('json_object');
    expect(result.visibleContent).not.toContain('```');
    expect(result.visibleContent).not.toContain('"version"');
  });

  it('解析带代码围栏的包装JSON', () => {
    const wrapped = JSON.stringify({
      version: 1, format: 'json_object',
      fields: { answer: '先核对人物状态。', keyPoints: [], risks: ['生死冲突'], questions: [], alternatives: [], nextStep: null, details: null }
    });
    const result = prepareEffectiveOutput(`\`\`\`json\n${wrapped}\n\`\`\``);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('先核对人物状态');
    expect(result.visibleContent).toContain('生死冲突');
    expect(result.visibleContent).not.toContain('```');
    expect(result.visibleContent).not.toContain('json_object');
  });

  it('从前后混杂岗位文本和规划落库中安全提取主编结构化结论', () => {
    const wrapped = JSON.stringify({
      version: 1, format: 'json_object',
      fields: {
        answer: '先用三章完成灰塔迁移。', keyPoints: ['账簿必须先核验'], risks: ['水源不足'],
        questions: [], alternatives: [], nextStep: '锁定后细化第一章', details: '依据来自灰塔现状。'
      },
      rules: ['内部合同不得展示']
    });
    const result = prepareEffectiveOutput(`编剧原始意见\n${wrapped}\n规划落库 {"chapters":[{"title":"内部章纲"}]}`);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('先用三章完成灰塔迁移');
    expect(result.visibleContent).toContain('账簿必须先核验');
    expect(result.visibleContent).not.toContain('规划落库');
    expect(result.visibleContent).not.toContain('rules');
    expect(result.fullContent).toContain('依据来自灰塔现状');
  });

  it('拒绝非合同版本或格式的包装对象并回退', () => {
    const badVersion = prepareEffectiveOutput(JSON.stringify({ version: 2, format: 'json_object', fields: { answer: 'x' } }));
    expect(badVersion.format).toBe('fallback');

    const badFormat = prepareEffectiveOutput(JSON.stringify({ version: 1, format: 'text', fields: { answer: 'x' } }));
    expect(badFormat.format).toBe('fallback');
  });

  it('包装对象 fields 缺 answer 或 fields 非对象时回退', () => {
    const noAnswer = prepareEffectiveOutput(JSON.stringify({ version: 1, format: 'json_object', fields: { keyPoints: ['x'] } }));
    expect(noAnswer.format).toBe('fallback');

    const badFields = prepareEffectiveOutput(JSON.stringify({ version: 1, format: 'json_object', fields: 'not-an-object' }));
    expect(badFields.format).toBe('fallback');
  });

  it('坏JSON（缺逗号）回退且不抛异常', () => {
    const result = prepareEffectiveOutput('{"answer":"结论" "keyPoints":[]}');
    expect(result.format).toBe('fallback');
    expect(result.visibleContent).toContain('格式不适合直接展示');
    expect(result.visibleContent).not.toContain('"answer"');
    expect(result.fullContent).toContain('"answer"');
  });
});
