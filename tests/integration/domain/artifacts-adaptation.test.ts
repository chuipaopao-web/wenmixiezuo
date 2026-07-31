import { afterEach, describe, expect, it } from 'vitest';
import { AdaptationService } from '../../../apps/api/src/application/books/adaptation-service.js';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { PositioningField, PositioningTag } from '../../../apps/api/src/domain/positioning.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('规划成果版本与题材适配失效传播', () => {
  it('成果版本不可变，可比较、选择并从历史版本创建新版本', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new ArtifactService(context.database, ids, clock);
    const firstContent = { premise: '第一版', audience: '长篇读者', tone: '克制', constraints: ['成长'], arcs: ['成长'] };
    const secondContent = { premise: '第二版', audience: '长篇读者', tone: '克制', constraints: ['成长'], arcs: ['成长', '抉择'] };
    const first = service.create(scope, 'creative_plan', '创作方案', firstContent);
    const second = service.addVersion(scope, first.artifactId, secondContent, first.artifactVersionId);
    expect(service.compare(scope, first.artifactVersionId, second.artifactVersionId).changedTopLevelKeys).toEqual(['arcs', 'premise']);
    expect(service.select(scope, first.artifactId, second.artifactVersionId).status).toBe('selected');
    const reverted = service.revert(scope, first.artifactId, first.artifactVersionId);
    expect(reverted.version).toBe(3);
    expect(reverted.content).toEqual(first.content);
    expect(service.requireVersion(scope, first.artifactVersionId).content).toEqual(firstContent);
  });

  it('定位变化创建新适配快照并精确阻断旧成果和待执行任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    const plan = artifacts.create(scope, 'creative_plan', '创作方案', { premise: '游戏成长', audience: '长篇读者', tone: '热血', constraints: [] });
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    tasks.create(scope, { taskId: 'task-plan', taskType: 'plan', idempotencyKey: 'plan', initialPhase: 'draft', brief: {} });
    const fields: PositioningField[] = [
      { key: 'premise', label: '核心创意', value: '北宋考据故事', sourceStatus: 'explicit', evidence: '老板修改' },
      { key: 'genre', label: '题材', value: '历史', sourceStatus: 'explicit', evidence: '历史' }
    ];
    const tags: PositioningTag[] = [{ name: '北宋', category: 'genre', sourceStatus: 'explicit' }];
    const current = new BookRepository(context.database).require(scope);
    const changed = new AdaptationService(context.database, ids, clock).revisePositioning(scope, current.version, fields, tags);
    expect(changed.positioningVersion).toBe(2);
    expect(changed.invalidatedCount).toBeGreaterThanOrEqual(3);
    expect(artifacts.requireVersion(scope, plan.artifactVersionId).status).toBe('invalidated');
    expect(tasks.require(scope, 'task-plan').status).toBe('blocked');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM adaptation_snapshots WHERE owner_id = ? AND book_id = ?').get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
  });

  it('keeps the staged planning pointer aligned with an author-selected master outline revision', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const artifacts = new ArtifactService(context.database, ids, clock);
    const initial = artifacts.create(scope, 'master_outline', '剧情总纲', {
      outlineSchema: 'stage_master_v2',
      premise: '主角必须在荒地中建立可持续的生存秩序。',
      coreConflict: '有限资源与队伍互信之间的冲突。',
      protagonistArc: '主角从独行者成长为可靠的组织者。',
      majorStages: [{
        stageNumber: 1,
        title: '荒地求生',
        chapterRange: { start: 1, end: 50 },
        mainline: {
          encounter: '队伍在缺水和追兵压力下进入荒地。',
          resolution: '主角通过观察和协作找到稳定水源。',
          result: '队伍形成最小协作并取得继续探索的资格。'
        },
        structure: {
          setup: '荒地缺水',
          development: '寻找水迹',
          turn: '发现追兵',
          conclusion: '守住水源'
        },
        stageSummary: '主角带领队伍取得水源并建立最小协作。',
        pendingThreads: ['追兵来源'],
        followUpDirection: '追查追兵并扩大营地。'
      }, {
        stageNumber: 2,
        title: '营地扩张',
        chapterRange: { start: 51, end: 100 },
        mainline: {
          encounter: '临时营地面临外部势力争夺。',
          resolution: '主角组织防守并公开资源分配规则。',
          result: '营地获得稳定发展空间。'
        },
        structure: {
          setup: '资源争夺',
          development: '组织防守',
          turn: '内部出现分歧',
          conclusion: '公开规则化解分歧'
        },
        stageSummary: '主角通过公开规则守住并扩张营地。',
        pendingThreads: ['外部势力的幕后支持者'],
        followUpDirection: '追查幕后支持者。'
      }],
      endingDirection: '建立公开、可持续的生存秩序。',
      storyPromises: ['追兵来源最终会揭开'],
      openQuestions: []
    }, 'candidate');
    artifacts.select(scope, initial.artifactId, initial.artifactVersionId);
    context.database.prepare(`
      UPDATE book_planning_states
      SET version = 8, stage = 'master_outline_ready',
          master_outline_version_id = ?, volume_outline_version_id = NULL
      WHERE owner_id = ? AND book_id = ?
    `).run(initial.artifactVersionId, scope.ownerId, scope.bookId);

    const revised = artifacts.addVersion(scope, initial.artifactId, {
      outlineSchema: 'stage_master_v2',
      premise: '主角必须在荒地中建立透明且可持续的生存秩序。',
      coreConflict: '有限资源、外部追兵与队伍互信之间的冲突。',
      protagonistArc: '主角从独行者成长为以可核验行动获得信任的组织者。',
      majorStages: [{
        stageNumber: 1,
        title: '荒地求生',
        chapterRange: { start: 1, end: 50 },
        mainline: {
          encounter: '队伍在缺水和追兵压力下进入荒地。',
          resolution: '主角依据植被、动物活动和透明分配找到并守住水源。',
          result: '主角取得同行者信任，队伍形成稳定协作。'
        },
        structure: {
          setup: '荒地缺水',
          development: '观察水迹',
          turn: '追兵逼近',
          conclusion: '共同守住水源'
        },
        stageSummary: '主角以可核验行动带领队伍守住水源并建立信任。',
        pendingThreads: ['追兵来源'],
        followUpDirection: '追查追兵并扩大营地。'
      }, {
        stageNumber: 2,
        title: '营地扩张',
        chapterRange: { start: 51, end: 100 },
        mainline: {
          encounter: '临时营地面临外部势力争夺和内部质疑。',
          resolution: '主角组织防守并用公开账目完成资源分配。',
          result: '营地获得稳定发展空间和成员信任。'
        },
        structure: {
          setup: '资源争夺',
          development: '组织防守',
          turn: '内部出现分歧',
          conclusion: '公开规则化解分歧'
        },
        stageSummary: '主角通过公开规则守住并扩张营地。',
        pendingThreads: ['外部势力的幕后支持者'],
        followUpDirection: '追查幕后支持者。'
      }],
      endingDirection: '建立公开、可持续的生存秩序。',
      storyPromises: ['追兵来源最终会揭开'],
      openQuestions: []
    }, initial.artifactVersionId);
    artifacts.select(scope, initial.artifactId, revised.artifactVersionId);

    expect(context.database.prepare(`
      SELECT version, stage, master_outline_version_id, volume_outline_version_id
      FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({
      version: 9,
      stage: 'master_outline_ready',
      master_outline_version_id: revised.artifactVersionId,
      volume_outline_version_id: null
    });
  });
});
