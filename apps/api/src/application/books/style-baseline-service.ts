import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { validateStyleBaseline, type StyleBaselineInput } from '../../contracts/style-baseline.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

export class StyleBaselineService {
  private readonly repository: PlanningWorkflowRepository;
  public constructor(
    database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new PlanningWorkflowRepository(database);
  }

  public get(scope: BookScope): Record<string, unknown> | null {
    assertBookScope(scope);
    const row = this.repository.selectedStyle(scope);
    return row === undefined ? null : {
      styleVersionId: row.style_version_id,
      version: row.version,
      content: JSON.parse(row.content_json),
      source: row.source_kind === 'opening' ? '老板确认的开书选择' : '老板确认的修订',
      status: '已确认',
      createdAt: row.created_at
    };
  }

  public confirm(scope: BookScope, expectedPlanningVersion: number, input: StyleBaselineInput): Record<string, unknown> {
    assertBookScope(scope);
    const content = validateStyleBaseline(input);
    const now = this.clock.now().toISOString();
    const styleVersionId = this.ids.next();
    this.repository.confirmStyle(scope, expectedPlanningVersion, styleVersionId, JSON.stringify(content), now);
    return this.get(scope)!;
  }
}
