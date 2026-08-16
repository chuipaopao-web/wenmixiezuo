/**
 * 线上导入脚本：把 data/imports/*.wenmi-book 逐包导入到目标管理员 owner 名下。
 *
 * 全部为【只追加、不删改】：预置全局 FK 目标用 INSERT OR IGNORE；importCopy 每本一个
 * 原子事务（BEGIN IMMEDIATE + defer_foreign_keys + foreign_key_check），失败只回滚该本。
 *
 * 前置（已在导入前完成）：
 *   - 线上库已备份（deploy/backup.sh）
 *   - 9 个包 + global-preflight.json 已放入 /opt/wenmi/data/imports/（属主 wenmi）
 *
 * 运行（线上，API 不停服，可选停 wenmi-worker 降写锁竞争）：
 *   cd /opt/wenmi && sudo -u wenmi /usr/bin/node /opt/wenmi/node_modules/tsx/dist/cli.mjs \
 *     scripts/migrate-admin-books/import-books.ts
 *
 * 输出 9 个新 book_id，供 enqueue-reindex.ts 使用。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BookPortabilityService } from '../../apps/api/src/application/portability/book-portability-service.js';
import { BookPortabilityRepository } from '../../apps/api/src/infrastructure/db/repositories/book-portability-repository.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const TARGET_OWNER = process.env.WENMI_TARGET_OWNER ?? '6838dc00-0b1c-45f2-8df9-2e6b754f1359';

const config = loadRuntimeConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
const ids = new UuidGenerator();
const clock = new SystemClock();
const repo = new BookPortabilityRepository(database);
const service = new BookPortabilityService(database, config, ids, clock);
const now = clock.now().toISOString();

// 0) 确保当前 release 行存在（tasks.release_id FK；importCopy 会把 release_id 改写为当前值）
const sv = repo.schemaVersion();
database.prepare(
  `INSERT INTO release_runs (release_id, product_name, schema_version, api_version, created_at)
   VALUES (?, '文秘写作', ?, 'v1', ?) ON CONFLICT(release_id) DO NOTHING`
).run(config.releaseId, sv, now);

// 1) 校验目标管理员 owner 存在（books.owner_id FK）
const owner = database.prepare(`SELECT owner_id FROM owners WHERE owner_id = ?`).get(TARGET_OWNER) as { owner_id: string } | undefined;
if (owner === undefined) throw new Error(`线上管理员 owner 不存在：${TARGET_OWNER}`);

// 2) 预置 classification_tags（FK->classification_tags，INSERT OR IGNORE 只加不改）
const pre = JSON.parse(readFileSync(resolve(config.dataDir, 'imports/global-preflight.json'), 'utf8')) as {
  classification_tags: Array<{ tag_id: string; tag_key: string; display_name: string; category: string; dynamic: number; created_at: string }>;
};
const insTag = database.prepare(
  `INSERT OR IGNORE INTO classification_tags (tag_id, tag_key, display_name, category, dynamic, created_at) VALUES (?,?,?,?,?,?)`
);
for (const r of pre.classification_tags ?? []) insTag.run(r.tag_id, r.tag_key, r.display_name, r.category, r.dynamic, r.created_at);

// 3) role_templates 预检（agent_instances FK->role_templates 全局固定表，migration 0009 两侧一致）
const rt = database.prepare(`SELECT COUNT(*) AS c FROM role_templates`).get() as { c: number };
const booksBefore = database.prepare(`SELECT COUNT(*) AS c FROM books`).get() as { c: number };
const accountsBefore = database.prepare(`SELECT COUNT(*) AS c FROM user_accounts`).get() as { c: number };
process.stdout.write(`${JSON.stringify({ event: 'preflight', owner: TARGET_OWNER, schemaVersion: sv, releaseId: config.releaseId, roleTemplates: rt.c, booksBefore: booksBefore.c, userAccountsBefore: accountsBefore.c })}\n`);

// 4) 逐包导入（原子，失败只回滚该本）
const packages = readdirSync(resolve(config.dataDir, 'imports')).filter((n) => n.endsWith('.wenmi-book')).sort();
const imported: Array<Record<string, unknown>> = [];
for (const name of packages) {
  try {
    const r = service.importCopy({ ownerId: TARGET_OWNER }, name);
    imported.push(r);
    process.stdout.write(`${JSON.stringify({ event: 'imported', packageName: name, bookId: r.bookId, title: r.title, importedRows: r.importedRows, importedFiles: r.importedFiles })}\n`);
  } catch (error) {
    imported.push({ packageName: name, failed: true, error: String(error) });
    process.stdout.write(`${JSON.stringify({ event: 'failed', packageName: name, error: String(error) })}\n`);
  }
}

const booksAfter = database.prepare(`SELECT COUNT(*) AS c FROM books`).get() as { c: number };
const accountsAfter = database.prepare(`SELECT COUNT(*) AS c FROM user_accounts`).get() as { c: number };
process.stdout.write(`${JSON.stringify({ event: 'done', importedCount: imported.filter((i) => !i.failed).length, failedCount: imported.filter((i) => i.failed).length, booksAfter, userAccountsAfter: accountsAfter }, null, 2)}\n`);

database.close();
