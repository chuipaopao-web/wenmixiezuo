import { describe, expect, it } from 'vitest';
import { parseModelJsonFields } from '../../apps/api/src/application/discussions/discussion-pipeline-service.js';

describe('parseModelJsonFields 围栏兼容与坏输出门禁', () => {
  it('解析裸 JSON 输出', () => {
    const fields = parseModelJsonFields(JSON.stringify({ version: 1, fields: { answer: '方案', fragments: ['甲', '乙'] } }));
    expect(fields?.answer).toBe('方案');
  });

  it('解析 markdown 围栏包裹的 JSON（真实模型常见输出），提案碎片不再误判为解析失败', () => {
    const fenced = '```json\n' + JSON.stringify({
      version: 1,
      fields: { answer: '方案', fragments: ['碎片一内容', '碎片二内容', '碎片三内容', '碎片四内容'] }
    }, null, 2) + '\n```';
    const fields = parseModelJsonFields(fenced);
    expect(fields).not.toBeNull();
    expect((fields?.fragments as string[]).length).toBe(4);
  });

  it('JSON 笔误（属性名少前引号）仍然判无效，保住坏输出不得复用的门禁', () => {
    const poisoned = '```json\n{\n  "version": 1,\n  "fields": {\n    answer": "坏输出"\n  }\n}\n```';
    expect(parseModelJsonFields(poisoned)).toBeNull();
  });

  it('非 JSON 内容返回 null', () => {
    expect(parseModelJsonFields('这不是JSON')).toBeNull();
  });

  it('字段直接放在根级（无 fields 包装）也能解析，真实模型的第二种结构漂移', () => {
    const rootLevel = JSON.stringify({ answer: '方案', benefits: ['好处'], costs: [], fragments: ['甲一', '乙二', '丙三', '丁四'] });
    const fields = parseModelJsonFields(rootLevel);
    expect(fields).not.toBeNull();
    expect((fields?.fragments as string[]).length).toBe(4);
    expect(fields?.answer).toBe('方案');
  });
});
