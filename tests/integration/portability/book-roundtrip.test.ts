import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BookPortabilityService } from '../../../apps/api/src/application/portability/book-portability-service.js';
import { initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('书籍可移植包复制导入', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('导出具有清单哈希且复制导入生成新书ID、不覆盖源书或携带密钥', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '可移植长篇' });
    prepareBookForWriting(context, { ownerId: context.config.ownerId, bookId: book.bookId }, ids, clock, 1);
    const service = new BookPortabilityService(context.database, context.config, ids, clock);
    const exported = service.exportBook({ ownerId: context.config.ownerId, bookId: book.bookId });
    const raw = readFileSync(exported.packagePath, 'utf8');
    expect(exported.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(raw).not.toMatch(/api[_-]?key|Bearer\s|sk-[A-Za-z0-9]/iu);
    const imports = resolve(context.dataDir, 'imports');
    mkdirSync(imports, { recursive: true });
    copyFileSync(exported.packagePath, resolve(imports, exported.packageName));

    const imported = service.importCopy({ ownerId: context.config.ownerId }, exported.packageName);

    expect(imported.bookId).not.toBe(book.bookId);
    expect(imported.title).toBe('可移植长篇');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM books WHERE owner_id = ?`)
      .get(context.config.ownerId)).toEqual({ count: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM agent_instances WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, imported.bookId)).toEqual({ count: 25 });
    expect(context.database.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it('隔离区拒绝路径穿越、损坏哈希和疑似密钥', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '隔离检查书' });
    const service = new BookPortabilityService(context.database, context.config, ids, clock);
    const ownerId = context.config.ownerId;
    expect(() => service.importCopy({ ownerId }, '../outside.wenmi-book')).toThrow(/文件名无效/u);
    const imports = resolve(context.dataDir, 'imports');
    mkdirSync(imports, { recursive: true });
    writeFileSync(resolve(imports, 'bad.wenmi-book'), JSON.stringify({ apiKey: 'forbidden-secret-fixture' }));
    expect(() => service.importCopy({ ownerId }, 'bad.wenmi-book')).toThrow(/API Key/u);
  });
});
