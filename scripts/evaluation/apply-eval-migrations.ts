import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';

const db = new DatabaseSync('.local/eval/node-model-eval.sqlite');
const r = runMigrations(db, 'apps/api/src/infrastructure/db/migrations');
console.log('applied:', r.applied.join(','));
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'tm2_eval_reserve%' OR name LIKE 'tm2_eval_guard%' OR name='tm2_step_archive' OR name='tm2_review_reads')").all().map(x => x.name);
console.log('tables:', t.join(','));
db.close();
