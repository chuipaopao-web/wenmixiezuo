import { describe, expect, it } from 'vitest';
import {
  createEffectiveOutputReference,
  prepareEffectiveOutput
} from '../../apps/api/src/application/chat/effective-output-service.js';
import {
  projectBossMessageForAuthor,
  renderModelContextContent
} from '../../apps/api/src/application/chat/author-conversation-presentation.js';

describe('有效输出层', () => {
  it('把设定工作流的内部资料包投影为作者可读请求，同时不把JSON带入最近对话', () => {
    const packet = [
      '讨论设定 【设定专项讨论资料包】',
      '书籍：少女的实验笔记',
      '开书资料JSON：{"title":"少女的实验笔记","protagonists":[{"name":"苏念"}]}',
      '当前板块：作品策划',
      '当前设定项：策划理念',
      '讨论目标：明确作品最核心的创作命题'
    ].join('\n');

    expect(projectBossMessageForAuthor(packet)).toBe('请讨论设定：策划理念。');
    const recent = renderModelContextContent('recent_conversation', JSON.stringify([
      { sender_type: 'boss', role_key: null, content: packet }
    ]), 1_000);
    expect(recent).toContain('请讨论设定：策划理念。');
    expect(recent).not.toMatch(/开书资料JSON|protagonists/u);
  });

  it('把成组设定和剧情大纲资料包投影为简短专业请求', () => {
    const grouped = [
      '讨论设定 【设定大纲成组讨论资料包】',
      '本批设定项JSON：[{"itemKey":"concept","label":"策划理念"},{"itemKey":"promise","label":"读者承诺"}]',
      '已经确认的设定JSON：[]'
    ].join('\n');
    expect(projectBossMessageForAuthor(grouped)).toBe('请集中讨论这些设定：策划理念、读者承诺。');
    expect(projectBossMessageForAuthor('讨论剧情总纲 【剧情总纲专项讨论资料包】\n开书资料JSON：{}'))
      .toBe('请讨论并完善当前阶段的剧情大纲。');
  });

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
    expect(result.rejectedMachinePayload).toBe(false);
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
    expect(result.rejectedMachinePayload).toBe(false);
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

  it('作者可见回复最多保留一个真正需要确认的问题', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '建议先确定现实悬疑中的双向救赎关系。',
      keyPoints: ['这与当前开书定位一致'],
      alternatives: [],
      risks: [],
      questions: ['是否按这个方向确定？', '主角住在哪里？', '配角叫什么？'],
      nextStep: '确认或直接修改',
      details: null
    }));

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('是否按这个方向确定');
    expect(result.visibleContent).not.toContain('主角住在哪里');
    expect(result.visibleContent).not.toContain('配角叫什么');
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

  it('保留模型以对象返回的补充依据，而不是把整份有效回复判成机器载荷', () => {
    const wrapped = JSON.stringify({
      version: 1,
      format: 'json_object',
      fields: {
        answer: '先确认游戏世界是否物理真实。',
        keyPoints: ['两名编剧对世界结构存在根本分歧'],
        risks: ['虚实兑换机制尚未闭合'],
        questions: ['游戏世界是否允许后期揭示为物理真实？'],
        alternatives: [],
        nextStep: '老板确认后写入当前设定项。',
        details: {
          红玉依据: '现实唯一真实可以保护竞技爽感',
          婉儿依据: '多世界结构可以提高长线延展性'
        }
      },
      rules: ['只输出一个JSON对象']
    });
    const result = prepareEffectiveOutput(`\`\`\`json\n${wrapped}\n\`\`\``);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('先确认游戏世界是否物理真实');
    expect(result.visibleContent).not.toContain('json_object');
    expect(result.fullContent).toContain('红玉依据');
    expect(result.fullContent).toContain('现实唯一真实可以保护竞技爽感');
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

  it('抢救真实模型未转义引号造成的近似JSON，不再把三席方案误判为结构失败', () => {
    const result = prepareEffectiveOutput(`\`\`\`json
{"answer":"这本书值得写，因为它把"双向救赎"变成有代价的选择。","keyPoints":["实验笔记持续揭开真相"],"alternatives":[],"risks":[],"questions":[],"nextStep":"由作者选择是否保留这个方向","details":null}
\`\`\``);

    expect(result.format).toBe('structured');
    expect(result.rejectedMachinePayload).toBe(false);
    expect(result.visibleContent).toContain('这本书值得写');
    expect(result.visibleContent).toContain('双向救赎');
    expect(result.visibleContent).not.toContain('结构不完整');
    expect(result.visibleContent).not.toContain('"keyPoints"');
  });

  it('无法安全恢复的机器载荷给调用方明确拒绝标记', () => {
    const result = prepareEffectiveOutput('{"keyPoints":["缺少核心结论"]}');

    expect(result.format).toBe('fallback');
    expect(result.rejectedMachinePayload).toBe(true);
    expect(result.visibleContent).toContain('格式不适合直接展示');
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

  it('模型在核心结论中误用未转义引号时仍提取自然中文，不把三席提案误判为缺席', () => {
    const result = prepareEffectiveOutput(`\`\`\`json
{
  "answer": "这本书值得写，因为它把"双向救赎"变成了一次有代价的追问。",
  "keyPoints": ["第一条依据” "第二条依据"],
  "alternatives": [],
  "risks": [],
  "questions": null,
  "nextStep": "由作者选择或组合",
  "details": null
}
\`\`\``);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('它把“双向救赎”变成了一次有代价的追问');
    expect(result.visibleContent).not.toContain('"answer"');
    expect(result.visibleContent).not.toContain('格式不适合直接展示');
  });

  it('模型在输出上限截断JSON时安全保留已经完整返回的核心结论', () => {
    const result = prepareEffectiveOutput(`{
      "answer": "第4至6章先误判、再修正，最后形成可重复的净收益。",
      "keyPoints": ["公共基础舱延迟是持续阻力", "修正来自任务类型和时段选择"],
      "alternatives": [],
      "risks": ["具体数值必须与前三章一致", "第二条风险被输出上限截`);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('第4至6章先误判');
    expect(result.visibleContent).toContain('公共基础舱延迟是持续阻力');
    expect(result.visibleContent).not.toContain('"answer"');
    expect(result.visibleContent).not.toContain('格式不适合直接展示');
  });

  it('字段轻微偏差时保留可安全解释的有效结论', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '先确认灰塔账簿的真实性，再决定是否迁城。',
      keyPoints: '账簿是当前唯一可核验线索',
      risks: '贸然迁城会同时失去水源和旧账证据',
      questions: [],
      alternatives: [],
      nextStep: null,
      details: null
    }));

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('先确认灰塔账簿');
    expect(result.visibleContent).toContain('账簿是当前唯一可核验线索');
    expect(result.visibleContent).toContain('贸然迁城');
    expect(result.visibleContent).not.toContain('格式不适合直接展示');
  });

  it('修复中文句子中模型误用的未转义英文引号并保留开书引导', () => {
    const result = prepareEffectiveOutput(`\`\`\`json
{
  "answer": "核心悬念是苏念的情感究竟是"课题数据"还是真心。",
  "keyPoints": ["主线依赖"边缘型人格实验"这个核心机制。"],
  "alternatives": [],
  "risks": ["前期必须明确情感边界。"],
  "questions": ["老师具体用什么控制她？"],
  "nextStep": "先锁定设定，再讨论剧情大纲。",
  "details": null
}
\`\`\``);

    expect(result.format).toBe('structured');
    expect(result.visibleContent).toContain('"课题数据"');
    expect(result.visibleContent).toContain('"边缘型人格实验"');
    expect(result.visibleContent).toContain('老师具体用什么控制她');
    expect(result.visibleContent).not.toContain('格式不适合直接展示');
  });

  it('作者可见回复统一使用当前产品术语并隐藏内部追溯字段', () => {
    const result = prepareEffectiveOutput(JSON.stringify({
      answer: '故事圣经premise与老板最新说明不一致，需要先统一。',
      keyPoints: ['故事圣经sourceId:077f3110的premise仍是旧版本'],
      alternatives: [],
      risks: ['confirmed_decisions为空，暂时没有正式确认决定'],
      questions: [],
      nextStep: '更新故事圣经premise后继续讨论。',
      details: '故事圣经sourceId:077f3110的premise原文与老板本轮说明不同；confirmed_decisions为空。保留圣经版本或更新圣经premise都会导致正史冲突必须解决，两版当前正史版本无法并存。'
    }));

    expect(result.visibleContent).toContain('设定大纲');
    expect(result.visibleContent).toContain('核心前提');
    expect(result.fullContent).toContain('目前还没有正式确认的讨论结论');
    expect(result.fullContent).toContain('保留设定大纲版本');
    expect(result.fullContent).toContain('更新设定大纲中的核心前提');
    expect(result.fullContent).toContain('规划差异需要先确认');
    expect(result.fullContent).toContain('当前规划表述不能同时成立');
    for (const leaked of ['故事圣经', 'premise', 'sourceId', '077f3110', 'confirmed_decisions']) {
      expect(result.visibleContent).not.toContain(leaked);
      expect(result.fullContent).not.toContain(leaked);
    }
  });

  it('最近对话资料保留说话人身份但不泄漏内部字段', () => {
    const rendered = renderModelContextContent('recent_conversation', JSON.stringify([
      { sender_type: 'boss', role_key: null, content: '笔记要到900章后才发现', created_at: 'ignored' },
      { sender_type: 'agent', role_key: 'deputy_editor', content: '故事圣经premise还是旧版', sourceId: 'hidden' }
    ]), 1_000);

    expect(rendered).toContain('老板：笔记要到900章后才发现');
    expect(rendered).toContain('副编：设定大纲中的核心前提还是旧版');
    expect(rendered).not.toMatch(/故事圣经|premise|sourceId|hidden/u);
  });
});
