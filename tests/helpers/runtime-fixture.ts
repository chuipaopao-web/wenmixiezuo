import type { BookScope } from '../../apps/api/src/domain/scope.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { TestContext } from './test-context.js';
import { initializeV7Book } from './v7-book-fixture.js';

export function initializeRuntimeBook(
  context: TestContext,
  scope: BookScope,
  ids: IdGenerator,
  clock: Clock,
  title = '运行测试书'
): void {
  initializeV7Book(context, scope.ownerId, ids, clock, { title, bookId: scope.bookId });
  const now = clock.now().toISOString();
  const snapshotId = ids.next();
  const agentId = ids.next();
  context.database.prepare(`INSERT INTO role_templates(
    role_template_id, version, role_key, display_name, category, responsibilities_json,
    required_capabilities_json, default_activation, created_at
  ) VALUES('role-test-canon', 1, 'continuity', '测试记录员', 'specialist', '[]', '["text"]', 'resident', ?)
  ON CONFLICT(role_template_id, version) DO NOTHING`).run(now);
  context.database.prepare(`INSERT INTO model_config_snapshots(
    model_snapshot_id, owner_id, book_id, provider, model_id, parameters_json,
    capabilities_json, validated_at, created_at
  ) VALUES(?,?,?,'local-deterministic','wenmi-fixture-v1','{"plan":"deterministic"}','["text"]',?,?)`)
    .run(snapshotId, scope.ownerId, scope.bookId, now, now);
  context.database.prepare(`INSERT INTO agent_instances(
    agent_id, owner_id, book_id, role_template_id, role_template_version, display_name,
    model_snapshot_id, permissions_json, enabled, activation_state, created_at, updated_at
  ) VALUES(?,?,?,'role-test-canon',1,'测试记录员',?,'{"bookScoped":true}',1,'idle',?,?)`)
    .run(agentId, scope.ownerId, scope.bookId, snapshotId, now, now);
}
