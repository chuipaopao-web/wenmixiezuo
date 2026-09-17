-- 625cc3f7集中复核②：父预算预留持久化日志（修复重启漏计）。
-- 每次真实dispatch前记一行：reserve（已占额未达发送点）→ dispatching（紧邻发送前标记）→ settled（实际/未知）。
-- 对账按"日志+发送状态+进程租约"：活跃进程保留；已发未结算/无法确认已发转unknown占额不释放；
-- 有确证未到发送点才释放；结算幂等不重复扣加；禁止全批清零。

CREATE TABLE tm2_eval_reserve_journal(
  reserve_key TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  owner_tag TEXT NOT NULL,
  requests INTEGER NOT NULL CHECK(requests>0),
  tokens INTEGER NOT NULL CHECK(tokens>=0),
  dispatch_mark TEXT NOT NULL CHECK(dispatch_mark IN ('reserved','dispatching','unknown')) DEFAULT 'reserved',
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('actual','actual-late','unknown','released','unknown-reconciled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(reserve_key, batch_id)
) STRICT;
CREATE INDEX tm2_eval_reserve_journal_batch ON tm2_eval_reserve_journal(batch_id, settled);

-- guard实例租约：活跃进程心跳；对账只处理租约过期实例的条目，活进程条目不动。
CREATE TABLE tm2_eval_guard_lease(
  owner_tag TEXT NOT NULL PRIMARY KEY,
  heartbeat_at TEXT NOT NULL
) STRICT;
