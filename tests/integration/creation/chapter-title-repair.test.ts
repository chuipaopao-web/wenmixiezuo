import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../../../apps/api/src/application/artifacts/artifact-service.js';
import { ChapterCatalogService } from '../../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('章节占位标题修复', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('只用已选章纲修复问号或默认标题，不覆盖作者已有标题', () => {
    context = createTestContext('wenmi-chapter-title-repair-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '标题修复测试',
      text: '验证目录标题来自已选章纲'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const chapters = new ChapterCatalogService(context.database, ids, clock);
    const volumeId = chapters.createVolume(scope, 1, '第一卷');
    const first = chapters.createChapter(scope, volumeId, 1, '????');
    const second = chapters.createChapter(scope, volumeId, 2, '作者自定标题');
    const artifacts = new ArtifactService(context.database, ids, clock);
    for (const [number, title] of [[1, '谁在记账'], [2, '不应覆盖']] as const) {
      const version = artifacts.create(scope, 'chapter_outline', `第${number}章章纲`, {
        chapterNumber: number,
        title,
        goal: `目标${number}`,
        beats: [`推进${number}`],
        hook: `钩子${number}`
      }, 'candidate');
      artifacts.select(scope, version.artifactId, version.artifactVersionId);
    }

    expect(chapters.repairPlaceholderTitlesFromSelectedOutlines(scope)).toBe(1);
    expect(chapters.requireChapter(scope, first.chapterId).title).toBe('谁在记账');
    expect(chapters.requireChapter(scope, second.chapterId).title).toBe('作者自定标题');
  });
});
