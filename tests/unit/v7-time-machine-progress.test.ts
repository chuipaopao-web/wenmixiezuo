import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { V7CreationRuntimeRepository } from '../../apps/api/src/infrastructure/db/repositories/v7-creation-runtime-repository.js';

describe('V7时光机正文进度聚合', () => {
  it('无论正文达到多少章都只执行一条按作者和书籍隔离的聚合查询', () => {
    const statements: string[] = [];
    const parameters: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          get(...values: unknown[]) {
            parameters.push(values);
            return {
              finalized_chapter_count: 200,
              manuscript_version_id: 'manuscript-200',
              chapter_number: 200,
              volume_scope_id: 'volume-10',
              chain_scope_id: 'chain-50'
            };
          }
        };
      }
    } as unknown as DatabaseSync;

    const progress = new V7CreationRuntimeRepository(database).timeMachineProgress('owner-1', 'book-1');

    expect(progress).toMatchObject({ finalized_chapter_count: 200, chapter_number: 200 });
    expect(statements).toHaveLength(1);
    expect(parameters).toEqual([['owner-1', 'book-1']]);
    expect(statements[0]).toMatch(/WHERE m\.owner_id=\? AND m\.book_id=\? AND m\.lifecycle='final'/u);
    expect(statements[0]).toMatch(/ROW_NUMBER\(\) OVER/u);
  });
});