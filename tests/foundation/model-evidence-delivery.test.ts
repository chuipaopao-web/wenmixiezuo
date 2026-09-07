import { describe, expect, it } from 'vitest';
import { ArkPlanModelAdapter, defaultSystemPromptForPurpose } from '../../apps/api/src/infrastructure/models/ark-plan-model.js';

const request = { requestId:'r', taskId:'t', ownerId:'o', bookId:'b', agentId:'a', prompt:'合成资料', maxOutputTokens:1000, temperature:.62 };

describe('模型证据与完整交付', () => {
  it.each(['messages','chat'] as const)('%s截断不能作为成功交付', async protocol => {
    const adapter = new ArkPlanModelAdapter({plan:'coding',provider:'volcengine-ark-coding-plan',modelId:protocol==='chat'?'glm-5.3-flash':'deepseek-v4-pro',baseUrl:'https://ark.cn-beijing.volces.com/api/coding',apiKey:'test',purpose:protocol==='chat'?'novel_reviewer':'novel_writer'}, async () => Response.json(protocol==='chat'
      ? {choices:[{message:{content:'{"verdict":"pass"}'},finish_reason:'length'}]}
      : {content:[{type:'text',text:'一段看似完整但实际被截断的正文。'}],stop_reason:'max_tokens'}));
    await expect(adapter.generate(request)).rejects.toMatchObject({failureClass:'technical_failure',retryable:true,outcomeUnknown:false});
  });
  it('仅证据审查增加验证过的边界，创作与汇总合同保持原样', () => {
    expect(defaultSystemPromptForPurpose('structured_planning')).toContain('JSON对象');
    expect(defaultSystemPromptForPurpose('novel_writer')).not.toContain('只纠正具体矛盾');
    expect(defaultSystemPromptForPurpose('novel_reviewer')).toContain('不要求它们逐一有来源');
    expect(defaultSystemPromptForPurpose('review_synthesis')).not.toContain('只纠正具体矛盾');
  });
  it('正常结果保留温度、只返回文字，自定义系统提示保持原样', async () => {
    const adapter = new ArkPlanModelAdapter({plan:'coding',provider:'volcengine-ark-coding-plan',modelId:'deepseek-v4-pro',baseUrl:'https://ark.cn-beijing.volces.com/api/coding',apiKey:'test',purpose:'structured_planning',systemPrompt:'专用合同'}, async (_url, init) => {
      const body=JSON.parse(String(init?.body));expect(body.system).toBe('专用合同');expect(body.temperature).toBe(.62);
      return Response.json({content:[{type:'thinking',thinking:'不得公开的内部内容'},{type:'text',text:'{"result":"完整候选"}'}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20}});
    });
    const result=await adapter.generate(request);expect(result.output).toBe('{"result":"完整候选"}');expect(JSON.stringify(result)).not.toContain('内部内容');
  });
});
