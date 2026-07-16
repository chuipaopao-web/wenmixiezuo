import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuarantineService } from '../../../apps/api/src/application/imports/quarantine-service.js';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('导入与恢复隔离区', () => {
  it('复制后校验哈希且只有所属owner能记录验证', () => {
    context = createTestContext();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    lifecycle.ensureOwner({ ownerId: 'owner-two' });
    const source = resolve(context.root, 'external.txt');
    writeFileSync(source, '外部候选资料', 'utf8');
    const quarantine = new QuarantineService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const record = quarantine.register({ ownerId: 'owner-one' }, source, 'import', null);
    expect(record.sourceHash).toHaveLength(64);
    expect(() => quarantine.recordValidation({ ownerId: 'owner-two' }, record.quarantineId, true, { hash: 'ok' }))
      .toThrow('越权');
    quarantine.recordValidation({ ownerId: 'owner-one' }, record.quarantineId, true, { hash: 'ok' });
    expect(context.database.prepare('SELECT status FROM quarantine_items WHERE quarantine_id = ?').get(record.quarantineId))
      .toEqual({ status: 'validated' });
  });
});

