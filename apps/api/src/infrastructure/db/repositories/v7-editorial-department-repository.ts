import type { DatabaseSync } from 'node:sqlite';

const defaultActiveSince = (): string => new Date(Date.now() - 20 * 60 * 1_000).toISOString();

export class V7EditorialDepartmentRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public currentWorks(ownerId: string, memberKey: string, activeSince: string): string[] {
    const settingWork = this.settingWork(ownerId, memberKey, activeSince);
    const works = [
      this.openingWork(ownerId, memberKey, activeSince)?.ideaText === undefined ? null : '开书资料',
      settingWork === null ? null : `设定：${settingWork}`,
      this.planningWork(ownerId, memberKey, activeSince) === null ? null : '全书路线',
      this.creationWork(ownerId, memberKey, activeSince),
      this.characterWork(ownerId, memberKey, activeSince),
      this.titleWork(ownerId, memberKey, activeSince),
      this.coverWork(ownerId, memberKey, activeSince) === null ? null : '书籍封面'
    ];
    return [...new Set(works.filter((work): work is string => work !== null))];
  }

  public successCount(ownerId: string, memberKey: string): number {
    return this.openingSuccessCount(ownerId, memberKey) + this.settingSuccessCount(ownerId, memberKey)
      + this.planningSuccessCount(ownerId, memberKey)
      + this.count(`SELECT COUNT(*) AS count FROM v7_creation_model_calls WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey)
      + this.count(`SELECT COUNT(*) AS count FROM v7_character_model_calls WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey)
      + this.count(`SELECT COUNT(*) AS count FROM v7_book_title_design_calls WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey)
      + this.count(`SELECT COUNT(*) AS count FROM v7_book_cover_designs WHERE owner_id=? AND state='succeeded' AND (chief_member_key=? OR visual_member_key=?)`, ownerId, memberKey, memberKey);
  }

  private creationWork(ownerId: string, memberKey: string, activeSince: string): string | null {
    const row = this.database.prepare(`SELECT c.run_kind AS runKind FROM v7_creation_model_calls c
      JOIN v7_creation_workflows w ON w.owner_id=c.owner_id AND w.book_id=c.book_id AND w.workflow_id=c.workflow_id
      WHERE c.owner_id=? AND c.member_key=? AND c.state='working' AND w.status='working'
        AND c.updated_at>=?
      ORDER BY c.updated_at DESC LIMIT 1`).get(ownerId, memberKey, activeSince) as { runKind: string } | undefined;
    return row === undefined ? null : ({ context: '整理创作资料', option: '设计卷链方案', option_review: '评审卷链方案',
      outline: '设计章纲', manuscript: '撰写正文', review: '审查正文', settlement: '结算正文' } as Record<string, string>)[row.runKind] ?? '创作任务';
  }

  private characterWork(ownerId: string, memberKey: string, activeSince: string): string | null {
    const row = this.database.prepare(`SELECT c.run_kind AS runKind FROM v7_character_model_calls c
      WHERE c.owner_id=? AND c.member_key=? AND c.state='working' AND c.updated_at>=?
        AND (
          (c.run_kind='context_pack' AND EXISTS (
            SELECT 1 FROM v7_character_context_packs p
            WHERE p.owner_id=c.owner_id AND p.book_id=c.book_id AND p.request_id=c.request_id
              AND p.status='working'
          ))
          OR (c.run_kind='maintenance' AND EXISTS (
            SELECT 1 FROM v7_character_maintenance_runs r
            WHERE r.owner_id=c.owner_id AND r.book_id=c.book_id AND r.maintenance_run_id=c.run_id
              AND r.status='working'
          ))
        )
      ORDER BY c.updated_at DESC LIMIT 1`)
      .get(ownerId, memberKey, activeSince) as { runKind: string } | undefined;
    return row === undefined ? null : row.runKind === 'maintenance' ? '更新人物资料' : '整理人物资料';
  }

  private titleWork(ownerId: string, memberKey: string, activeSince: string): string | null {
    const row = this.database.prepare(`SELECT 1 AS found FROM v7_book_title_design_calls
      WHERE owner_id=? AND member_key=? AND state='working' AND updated_at>=? LIMIT 1`)
      .get(ownerId, memberKey, activeSince) as { found: number } | undefined;
    return row === undefined ? null : '设计书名';
  }

  public settingMemberEnabled(memberKey: string): boolean {
    const row = this.database.prepare('SELECT enabled FROM v7_setting_member_settings WHERE member_key = ?')
      .get(memberKey) as { enabled: number } | undefined;
    return row?.enabled !== 0;
  }

  public openingWork(ownerId: string, memberKey: string, activeSince = defaultActiveSince()): { nodeKey: string; ideaText: string } | undefined {
    return this.database.prepare(`
      SELECT c.node_key AS nodeKey, t.idea_text AS ideaText
      FROM v7_opening_agent_model_calls c
      JOIN v7_opening_agent_tasks t ON t.owner_id = c.owner_id AND t.task_id = c.task_id
      WHERE c.owner_id = ? AND c.member_key = ?
        AND c.state = 'working'
        AND c.updated_at >= ?
        AND t.status = 'working'
      ORDER BY c.updated_at DESC LIMIT 1
    `).get(ownerId, memberKey, activeSince) as { nodeKey: string; ideaText: string } | undefined;
  }

  public settingWork(ownerId: string, memberKey: string, activeSince = defaultActiveSince()): string | null {
    const row = this.database.prepare(`
      SELECT j.item_label AS itemLabel
      FROM v7_setting_model_calls c
      JOIN v7_setting_item_jobs j
        ON j.owner_id = c.owner_id AND j.book_id = c.book_id AND j.batch_id = c.batch_id AND j.item_key = c.item_key
      JOIN v7_setting_batches b
        ON b.owner_id = c.owner_id AND b.book_id = c.book_id AND b.batch_id = c.batch_id
      WHERE c.owner_id = ? AND c.member_key = ?
        AND c.state = 'working'
        AND c.updated_at >= ?
        AND b.status = 'working'
        AND j.state IN ('working', 'chief_review')
      ORDER BY c.updated_at DESC LIMIT 1
    `).get(ownerId, memberKey, activeSince) as { itemLabel: string } | undefined;
    return row?.itemLabel ?? null;
  }

  public coverWork(ownerId: string, memberKey: string | null, activeSince = defaultActiveSince()): string | null {
    const row = memberKey === null
      ? this.database.prepare(`SELECT b.title FROM v7_book_cover_designs d
          JOIN books b ON b.owner_id=d.owner_id AND b.book_id=d.book_id
          WHERE d.owner_id=? AND d.state='working' AND d.updated_at>=? ORDER BY d.updated_at DESC LIMIT 1`)
          .get(ownerId, activeSince)
      : this.database.prepare(`SELECT b.title FROM v7_book_cover_designs d
          JOIN books b ON b.owner_id=d.owner_id AND b.book_id=d.book_id
          WHERE d.owner_id=? AND d.state='working' AND d.updated_at>=?
            AND (d.chief_member_key=? OR d.visual_member_key=?)
          ORDER BY d.updated_at DESC LIMIT 1`).get(ownerId, activeSince, memberKey, memberKey);
    return (row as { title: string } | undefined)?.title ?? null;
  }

  public planningWork(ownerId: string, memberKey: string, activeSince = defaultActiveSince()): string | null {
    const row = this.database.prepare(`
      SELECT c.node_key AS nodeKey
      FROM v7_planning_model_calls c
      WHERE c.owner_id = ? AND c.member_key = ? AND c.state = 'working' AND c.updated_at >= ?
        AND (
          (c.run_kind = 'recipe' AND EXISTS (
            SELECT 1 FROM v7_planning_recipe_runs r
            WHERE r.owner_id = c.owner_id AND r.book_id = c.book_id AND r.run_id = c.run_id AND r.status = 'working'
          ))
          OR (c.run_kind = 'tree' AND EXISTS (
            SELECT 1 FROM v7_planning_generation_runs g
            WHERE g.owner_id = c.owner_id AND g.book_id = c.book_id AND g.generation_run_id = c.run_id AND g.status = 'working'
          ))
          OR (c.run_kind = 'maintenance' AND EXISTS (
            SELECT 1 FROM v7_planning_maintenance_runs m
            WHERE m.owner_id = c.owner_id AND m.book_id = c.book_id AND m.maintenance_run_id = c.run_id AND m.status = 'working'
          ))
        )
      ORDER BY c.started_at DESC LIMIT 1
    `).get(ownerId, memberKey, activeSince) as { nodeKey: string } | undefined;
    return row?.nodeKey ?? null;
  }

  public openingSuccessCount(ownerId: string, memberKey: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_opening_agent_model_calls
      WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey);
  }

  public settingSuccessCount(ownerId: string, memberKey: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
      WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey);
  }

  public chiefCoverSuccessCount(ownerId: string, memberKey: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_book_cover_designs
      WHERE owner_id=? AND chief_member_key=? AND state='succeeded'`, ownerId, memberKey);
  }

  public visualCoverSuccessCount(ownerId: string, memberKey: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_book_cover_designs
      WHERE owner_id=? AND visual_member_key=? AND state='succeeded'`, ownerId, memberKey);
  }

  public allCoverSuccessCount(ownerId: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_book_cover_designs
      WHERE owner_id=? AND state='succeeded'`, ownerId);
  }

  public planningSuccessCount(ownerId: string, memberKey: string): number {
    return this.count(`SELECT COUNT(*) AS count FROM v7_planning_model_calls
      WHERE owner_id=? AND member_key=? AND state='succeeded'`, ownerId, memberKey);
  }

  private count(sql: string, ...parameters: string[]): number {
    return Number((this.database.prepare(sql).get(...parameters) as { count: number }).count);
  }
}
