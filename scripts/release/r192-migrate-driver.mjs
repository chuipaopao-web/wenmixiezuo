// R192迁移驱动：对指定数据库应用schema_migrations清单内全部未应用迁移。
// 同一份dist代码既服务预检副本也服务正式库；已应用迁移按校验和核对，重复执行返回空applied。
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/dist/infrastructure/db/migrations.js';

const [, , targetDb, sourceRoot] = process.argv;
if (!targetDb || !sourceRoot) {
  console.error('usage: node r192-migrate-driver.mjs <target-db> <release-source-root>');
  process.exit(64);
}
const db = new DatabaseSync(targetDb);
db.exec('PRAGMA foreign_keys=ON');
try {
  const result = runMigrations(db, `${sourceRoot}/apps/api/src/infrastructure/db/migrations`);
  const quickCheck = db.prepare('PRAGMA quick_check').get().quick_check;
  const foreignKeyIssues = db.prepare('PRAGMA foreign_key_check').all().length;
  if (quickCheck !== 'ok' || foreignKeyIssues > 0) throw new Error(`迁移后数据库校验未通过：quick_check=${quickCheck} foreign_key_issues=${foreignKeyIssues}`);
  console.log(JSON.stringify({ applied: result.applied, currentVersion: result.currentVersion, quickCheck, foreignKeyIssues }));
} finally {
  db.close();
}
