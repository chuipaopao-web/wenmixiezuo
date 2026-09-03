/**
 * 第86批运维诊断（只读）：按账号邮箱输出规划/创作失败证据，供定位
 * "西施卷规划反复失败"与"全书方向确认后无法推进"两类故障。
 *
 * 用法（生产 /opt/wenmi 下运行）：
 *   sudo -u wenmi /usr/bin/node node_modules/tsx/dist/cli.mjs \
 *     scripts/ops/diagnose-account-failures.ts 1746495718@qq.com 2521623943@qq.com
 *
 * 只执行 SELECT 与 PRAGMA，不写任何数据。输出 JSON 到 stdout，可直接回贴。
 */
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const emails = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (emails.length === 0) {
  process.stdout.write('用法: node tsx scripts/ops/diagnose-account-failures.ts <邮箱...>\n');
  process.exit(1);
}

const config = loadRuntimeConfig(process.env);
const database = openDatabase(config.databasePath);

function compact(value: unknown, max = 240): unknown {
  if (typeof value === 'string' && value.length > max) return `${value.slice(0, max)}…(共${value.length}字符)`;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compact(item, max));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, item]) => [key, compact(item, max)]));
  }
  return value;
}

function query(sql: string, ...params: Array<string | number>): unknown {
  try {
    return compact(database.prepare(sql).all(...params));
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function scalar(sql: string, ...params: Array<string | number>): unknown {
  try {
    const row = database.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    return row === undefined ? null : Object.values(row)[0];
  } catch (error) {
    return `ERROR: ${(error as Error).message}`;
  }
}

const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  releaseId: config.releaseId,
  accounts: {} as Record<string, unknown>
};

for (const email of emails) {
  const account = database.prepare(
    'SELECT user_id, owner_id, display_name, role, status, created_at FROM user_accounts WHERE email_normalized = ?'
  ).get(email) as Record<string, string> | undefined;

  if (account === undefined) {
    (report.accounts as Record<string, unknown>)[email] = { found: false };
    continue;
  }
  const ownerId = account.owner_id;

  const books = database.prepare(
    'SELECT book_id, title, status, canon_revision, created_at, updated_at FROM books WHERE owner_id = ? ORDER BY updated_at DESC'
  ).all(ownerId) as Array<Record<string, string>>;

  const perAccount: Record<string, unknown> = { account, books };

  for (const book of books) {
    const bookId = book.book_id;
    const section: Record<string, unknown> = {};

    // 全书路线运行（route runs）
    section.routeRuns = query(`
      SELECT run_id, status, current_phase, error_message, roster_json, created_at, updated_at
      FROM v7_planning_recipe_runs WHERE owner_id=? AND book_id=?
      ORDER BY updated_at DESC LIMIT 5`, ownerId, bookId);

    // 正式框架树生成运行（generation runs，含续接替代任务）
    section.treeGenerationRuns = query(`
      SELECT generation_run_id, tree_kind, scope_id, assigned_member_key, status, error_message,
             idempotency_key, parent_tree_version_id, candidate_tree_version_id, created_at, updated_at
      FROM v7_planning_generation_runs WHERE owner_id=? AND book_id=?
      ORDER BY updated_at DESC LIMIT 12`, ownerId, bookId);

    // 创作流水线工作流（卷/链/章方案与正文）
    section.creationWorkflows = query(`
      SELECT * FROM v7_creation_workflows WHERE owner_id=? AND book_id=?
      ORDER BY updated_at DESC LIMIT 5`, ownerId, bookId);

    // 创作资料包失败记录（妙玉/资料策划与各席位在创作管线的失败）
    section.failedContextPacks = query(`
      SELECT task_kind, assigned_member_key, status, error_message, request_id, created_at, updated_at
      FROM v7_creation_context_packs WHERE owner_id=? AND book_id=? AND status IN ('failed','unknown')
      ORDER BY updated_at DESC LIMIT 15`, ownerId, bookId);

    // 失败/中断的模型调用（含成员显示名与真实错误详情）
    section.failedModelCalls = query(`
      SELECT call.request_id, call.phase_key, agent.display_name, call.provider, call.model_id,
             call.state, call.error_class, call.error_detail, call.input_tokens, call.output_tokens,
             call.duration_ms, call.started_at, call.completed_at
      FROM model_calls call LEFT JOIN agent_instances agent ON agent.agent_id = call.agent_id
      WHERE call.owner_id=? AND call.book_id=? AND call.state IN ('failed','interrupted')
      ORDER BY call.created_at DESC LIMIT 20`, ownerId, bookId);

    // 最近模型调用概览（成功+失败，看成员成功率）
    section.recentModelCalls = query(`
      SELECT call.phase_key, agent.display_name, call.model_id, call.state, call.error_class,
             call.output_tokens, call.duration_ms, call.created_at
      FROM model_calls call LEFT JOIN agent_instances agent ON agent.agent_id = call.agent_id
      WHERE call.owner_id=? AND call.book_id=?
      ORDER BY call.created_at DESC LIMIT 30`, ownerId, bookId);

    // 任务账本最近状态
    section.recentTasks = query(`
      SELECT task_id, task_type, status, current_phase, error_code, attempt_count, created_at, updated_at
      FROM tasks WHERE owner_id=? AND book_id=?
      ORDER BY updated_at DESC LIMIT 12`, ownerId, bookId);

    // 西施相关调用单独拎出（按显示名模糊匹配）
    section.xishiCalls = query(`
      SELECT call.request_id, call.phase_key, call.model_id, call.state, call.error_class,
             call.error_detail, call.input_tokens, call.output_tokens, call.duration_ms,
             call.input_hash, call.started_at
      FROM model_calls call LEFT JOIN agent_instances agent ON agent.agent_id = call.agent_id
      WHERE call.owner_id=? AND call.book_id=? AND agent.display_name LIKE '%西施%'
      ORDER BY call.created_at DESC LIMIT 15`, ownerId, bookId);

    (perAccount as Record<string, unknown>)[`${book.title} (${bookId})`] = section;
  }

  (report.accounts as Record<string, unknown>)[email] = perAccount;
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
database.close();
