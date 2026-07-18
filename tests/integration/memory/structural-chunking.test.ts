import { describe, expect, it } from 'vitest';
import { StructuralChunker } from '../../../apps/api/src/application/memory/structural-chunker.js';

describe('中文结构切片', () => {
  it('使用UTF-8字节范围、零盲目重叠、父子和邻接保存完整证据', () => {
    const longDialogue = `“张三，天安城不会投降。”李四说。${'双方在城门前交换条件，任何承诺都留下代价。'.repeat(55)}`;
    const source = `第一章 夜雨\n\n张三抵达天安城。雨落在旧旗上。\n\n${longDialogue}\n\n如果明日开战，他会先切断河道。`;
    const result = new StructuralChunker().chunk(source);
    expect(result.chunks.length).toBeGreaterThan(2);
    expect(result.chunks.every((chunk) => [...chunk.content].length <= 700)).toBe(true);
    for (const chunk of result.chunks) {
      expect(Buffer.from(source, 'utf8').subarray(chunk.byteStart, chunk.byteEnd).toString('utf8')).toBe(chunk.content);
      expect(result.parents[chunk.parentOrdinal]!.byteStart).toBeLessThanOrEqual(chunk.byteStart);
      expect(result.parents[chunk.parentOrdinal]!.byteEnd).toBeGreaterThanOrEqual(chunk.byteEnd);
    }
    expect(result.chunks.every((chunk, index) => index === 0 || result.chunks[index - 1]!.byteEnd <= chunk.byteStart)).toBe(true);
    expect(result.chunks[0]!.previousOrdinal).toBeNull();
    expect(result.chunks.at(-1)!.nextOrdinal).toBeNull();
    expect(result.chunks.at(-1)!.narrativeMode).toBe('counterfactual');
  });

  it('拒绝静默规范化原文，重复执行结果确定', () => {
    const chunker = new StructuralChunker();
    const source = '场景一\n\n她说：“我记得那年。”\n\n梦中，城门重新打开。';
    expect(chunker.chunk(source)).toEqual(chunker.chunk(source));
    expect(() => chunker.chunk('e\u0301')).toThrow('不会静默改写原文');
  });
});
