import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { V7CreationWorkflowService } from '../../apps/api/src/application/creation/v7-creation-workflow-service.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import { V7CreationRuntimeRepository } from '../../apps/api/src/infrastructure/db/repositories/v7-creation-runtime-repository.js';
import type { V7CreationModelAdapterResolver } from '../../apps/api/src/infrastructure/models/v7-creation-model-gateway.js';

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

  it('公共进度只返回章数和服务端解析结果，不暴露正文、卷或链定位键', () => {
    const database = {
      prepare() {
        return {
          get() {
            return {
              finalized_chapter_count: 6,
              manuscript_version_id: 'manuscript-6',
              chapter_number: 6,
              volume_scope_id: 'volume-1',
              chain_scope_id: null
            };
          }
        };
      }
    } as unknown as DatabaseSync;
    const adapters: V7CreationModelAdapterResolver = {
      resolve: () => { throw new Error('本测试不会调用模型'); }
    };
    const ids: IdGenerator = { next: () => 'unused-id' };
    const clock: Clock = { now: () => new Date('2026-09-01T00:00:00.000Z') };

    const progress = new V7CreationWorkflowService(database, adapters, ids, clock, () => [])
      .timeMachineProgress('owner-1', 'book-1');

    expect(progress).toEqual({
      finalizedChapterCount: 6,
      latestFinalChapter: { chapterNumber: 6 },
      latestConfirmedChain: null
    });
    expect(JSON.stringify(progress)).not.toMatch(/manuscriptVersionId|volumeScopeId|chainScopeId/u);
  });
});
