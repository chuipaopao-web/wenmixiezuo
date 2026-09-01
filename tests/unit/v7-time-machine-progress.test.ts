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
      latestConfirmedChain: null,
      latestConfirmedChainState: 'missing'
    });
    expect(JSON.stringify(progress)).not.toMatch(/manuscriptVersionId|volumeScopeId|chainScopeId/u);
  });

  it('最近定稿链数据损坏时仍返回六章正文进度并标记链读取失败', () => {
    const statements: string[] = [];
    const database = {
      prepare(sql: string) {
        statements.push(sql);
        if (sql.includes('WITH ranked')) {
          return { get: () => ({
            finalized_chapter_count: 6,
            manuscript_version_id: 'manuscript-6',
            chapter_number: 6,
            volume_scope_id: 'volume-1',
            chain_scope_id: 'chain-1'
          }) };
        }
        if (sql.includes('FROM v7_planning_tree_heads')) {
          return { get: () => ({
            owner_id: 'owner-1', book_id: 'book-1', tree_kind: 'chain', scope_id: 'chain-1',
            revision: 2, candidate_version_id: null, confirmed_version_id: 'broken-chain-version',
            updated_at: '2026-09-01T00:00:00.000Z'
          }) };
        }
        if (sql.includes('FROM v7_planning_tree_versions')) {
          return { get: () => ({
            tree_version_id: 'broken-chain-version', owner_id: 'owner-1', book_id: 'book-1',
            tree_kind: 'chain', scope_id: 'chain-1', revision: 1, lifecycle: 'confirmed',
            parent_version_id: null, content_json: '{损坏的JSON', content_hash: 'a'.repeat(64),
            source_refs_json: '[]', created_by: 'author', created_at: '2026-08-31T00:00:00.000Z',
            confirmed_at: '2026-08-31T00:01:00.000Z'
          }) };
        }
        throw new Error(`测试未覆盖的 SQL: ${sql}`);
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
      latestConfirmedChain: null,
      latestConfirmedChainState: 'failed'
    });
    expect(statements).toHaveLength(3);
  });
});
