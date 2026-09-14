import type {DatabaseSync} from 'node:sqlite';

/** S1-A：故事线确认校验所需的持久化查询（application-database-boundary修正：DB访问归infrastructure）。 */
export interface RecommendationRunRow {
  owner_id: string;
  book_id: string;
  kind: string;
  state: string;
  result_json: string | null;
  snapshot_json: string;
}

export interface DesignRoundRow { id: string; scheme: string; snapshot_json: string }

export class StorylineSelectionRepository {
  constructor(private readonly db: DatabaseSync) {}

  findRecommendationRun(runId: string): RecommendationRunRow | undefined {
    return this.db.prepare('SELECT owner_id, book_id, kind, state, result_json, snapshot_json FROM tm2_design_runs WHERE id=?').get(runId) as RecommendationRunRow | undefined;
  }

  findDesignRoundByRoundKey(ownerId: string, bookId: string, roundKey: string): DesignRoundRow | undefined {
    return this.db.prepare("SELECT id,scheme,snapshot_json FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND kind='design' AND round_key=? ORDER BY scheme LIMIT 1").get(ownerId, bookId, roundKey) as DesignRoundRow | undefined;
  }

  listDesignRoundSchemes(ownerId: string, bookId: string, roundKey: string): { id: string; scheme: string }[] {
    return this.db.prepare("SELECT id,scheme FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND kind='design' AND round_key=? ORDER BY scheme").all(ownerId, bookId, roundKey) as { id: string; scheme: string }[];
  }
}
