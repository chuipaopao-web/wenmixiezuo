import type { DatabaseSync } from 'node:sqlite';

export interface RunSpend {
  calls: number;
  tokens: number;
  /** 历史关联不可解析的缺口（归档attempts_json无法解析等）；调用方必须fail closed，不能按0计。 */
  gaps: string[];
}

interface AttemptLike { id?: unknown; step?: unknown }

/**
 * run级真实调用统计统一入口（d8407c59复核：产品与探针共用）。
 * 当前tm2_attempts与tm2_step_archive.attempts_json合并、按调用ID去重（当前优先，归档同ID只计一次）：
 * 归档步骤的实耗不从run统计消失；恢复重建不产生倍增；owner/book/run三重隔离他书不混入。
 * 口径：known=input+output（已上报截断usage照计）；unknown/working=reserved（已发未知保守占额）；
 * 明确未发送（预算预检拒绝无调用行）不计为消耗；未知后转actual只按actual计一次。
 */
export function computeRunSpend(db: DatabaseSync, scope: { ownerId: string; bookId: string }, runId: string): RunSpend {
  const prefix = `${runId}:`;
  const gaps: string[] = [];
  const ids = new Set<string>();
  const idToSteps = new Map<string, Set<string>>();
  const markAttempts = (attempts: AttemptLike[], origin: string): void => {
    for (const a of attempts) {
      if (typeof a?.id !== 'string' || typeof a?.step !== 'string') { if (attempts.length) gaps.push(`${origin}存在不可解析attempt记录`); continue; }
      if (a.step.startsWith(prefix)) { ids.add(a.id); const set = idToSteps.get(a.id) ?? new Set<string>(); set.add(a.step); idToSteps.set(a.id, set); }
    }
  };
  markAttempts(db.prepare('SELECT id, step FROM tm2_attempts WHERE owner=? AND book=?').all(scope.ownerId, scope.bookId) as AttemptLike[], '当前attempts');
  const archived = db.prepare('SELECT id, attempts_json FROM tm2_step_archive WHERE owner=? AND book=?').all(scope.ownerId, scope.bookId) as { id: string; attempts_json: string }[];
  for (const row of archived) {
    let attempts: AttemptLike[];
    try { attempts = JSON.parse(row.attempts_json) as AttemptLike[]; }
    catch { gaps.push(`归档步骤${row.id}的attempts_json不可解析`); continue; }
    if (!Array.isArray(attempts)) { gaps.push(`归档步骤${row.id}的attempts_json不是数组`); continue; }
    markAttempts(attempts, `归档步骤${row.id}`);
  }
  let calls = 0;
  let tokens = 0;
  for (const id of ids) {
    const call = db.prepare('SELECT state, input_tokens, output_tokens, reserved_tokens FROM tm2_model_calls WHERE id=? AND owner_id=? AND book_id=?').get(id, scope.ownerId, scope.bookId) as
      { state: string; input_tokens: number | null; output_tokens: number | null; reserved_tokens: number | null } | undefined;
    if (!call) {
      // 明确未发送（预算预检在创建调用行前拒绝）不计为消耗不报缺口；其余不可解析按缺口fail closed。
      // budget标记可能在当前step行（失败未恢复）或归档row_json（输入升级归档重算后原行已搬走）——两处都要认。
      const stepsForId = [...idToSteps.get(id) ?? []];
      const allPreRejected = stepsForId.length > 0 && stepsForId.every(step => {
        const cur = db.prepare('SELECT error_code FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId, scope.bookId, step) as { error_code: string | null } | undefined;
        if (cur?.error_code === 'budget') return true;
        const archivedRows = db.prepare('SELECT row_json FROM tm2_step_archive WHERE owner=? AND book=? AND id=?').all(scope.ownerId, scope.bookId, step) as { row_json: string }[];
        return archivedRows.some(r => {
          try { return (JSON.parse(r.row_json) as { error_code?: string | null }).error_code === 'budget'; } catch { return false; }
        });
      });
      if (!allPreRejected) gaps.push(`调用${id}在本owner/book下不可解析（不冒称0消耗）`);
      continue;
    }
    calls++;
    if (call.input_tokens !== null && call.output_tokens !== null) tokens += call.input_tokens + call.output_tokens;
    else if (call.state === 'working' || call.state === 'unknown') tokens += call.reserved_tokens ?? 0;
  }
  return { calls, tokens, gaps };
}
