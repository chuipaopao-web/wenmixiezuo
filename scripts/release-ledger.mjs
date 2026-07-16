import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = process.cwd();
const releaseId = readFileSync(resolve(projectRoot, 'RELEASE_ID'), 'utf8').trim();
const controlDir = resolve(projectRoot, 'data', 'control');
mkdirSync(controlDir, { recursive: true });
const database = new DatabaseSync(resolve(controlDir, 'release-ledger.sqlite'));
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA synchronous = FULL');
database.exec('PRAGMA foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS releases (
    release_id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'complete', 'blocked'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS stage_tasks (
    task_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    stage INTEGER NOT NULL CHECK (stage BETWEEN 0 AND 8),
    goal TEXT NOT NULL,
    exclusions TEXT NOT NULL,
    owner TEXT NOT NULL,
    allowed_files TEXT NOT NULL,
    forbidden_files TEXT NOT NULL,
    dependencies TEXT NOT NULL,
    constraints_text TEXT NOT NULL,
    acceptance TEXT NOT NULL,
    test_commands TEXT NOT NULL,
    stop_conditions TEXT NOT NULL,
    rollback_method TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'passed', 'failed', 'blocked')),
    updated_at TEXT NOT NULL,
    UNIQUE(release_id, stage),
    FOREIGN KEY (release_id) REFERENCES releases(release_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS evidence (
    evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id TEXT NOT NULL,
    stage INTEGER NOT NULL,
    kind TEXT NOT NULL,
    command_text TEXT NOT NULL,
    result_text TEXT NOT NULL,
    git_commit TEXT,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (release_id) REFERENCES releases(release_id)
  ) STRICT;
`);

const stageDefinitions = [
  ['开工基线', '登记授权、参数、Git、唯一发布标识和任务账本', '不创建业务功能或触碰项目外目录', '根文档、docs/releases、Git元数据、data/control', '业务源码、项目外目录', '老板开工授权', 'Git基线、发布标识和账本均可查询', 'git status --short; git log -1 --oneline; npm run ledger:status'],
  ['项目与契约底座', '建立三应用、共享契约、迁移器、假模型、启动器和质量门禁', '不实现小说业务领域和真实付费模型', '根配置、scripts、apps/*基础入口、tests/foundation', 'D:\\AI智囊团、来源快照', '开工基线', '类型检查、测试、构建、空库/重复/失败迁移、启动和本机监听通过', 'npm run typecheck; npm test; npm run build; npm run migrate; npm start'],
  ['数据安全底座', '实现隔离Repository、不可变文件、生命周期、备份恢复和墓碑', '不接入长任务和正文生成', 'apps/api领域与基础设施、tests/contract、tests/fault-injection', 'Worker直接写正式正文、来源快照', '阶段1', '跨书、哈希、崩溃、备份和真实临时恢复验证通过', 'npm run verify; npm run test -- tests/contract tests/fault-injection'],
  ['运行与管理底座', '实现持久任务、Worker、适配器、预算、9岗位、SSE与双主编', '不开始小说章节创作闭环', 'apps/api任务模块、apps/worker、tests/integration', '真实付费调用、Worker核心业务直写', '阶段2', '中断、幂等、预算竞争、心跳、接管和旧epoch拒绝通过', 'npm run verify; npm run test -- tests/integration/runtime'],
  ['小说领域核心', '实现定位建书、题材适配、规划成果与讨论', '不把计划当正史或生成正式章节', 'apps/api小说领域、apps/web对应功能、tests/integration/domain', '正史核心、来源快照', '阶段3', '原子9岗位建书、版本失效、成果历史和讨论收口通过', 'npm run verify; npm run test -- tests/integration/domain'],
  ['记忆与正史核心', '实现事实、正史、分层记忆、FTS、上下文和一致性投影', '不接入独立向量库或图数据库', 'apps/api知识与记忆、tests/integration/memory', '外部向量库、跨书检索', '阶段4', '百万字硬锚点、零串线、D级门禁、FTS重建和失效通过', 'npm run verify; npm run test -- tests/integration/memory'],
  ['创作闭环', '实现主笔选择、单章与多章串行、审校重写、事实结算和续跑', '不调用未授权真实模型', '创作服务、Worker执行器、tests/integration/creation', '并行写同书、半章提升', '阶段5', '5章确定性创作、异模型审校、最多两次重写、断点续跑通过', 'npm run verify; npm run test -- tests/integration/creation'],
  ['专业增强与完整界面', '实现投影、版权研究、桌面/移动/PWA和离线草稿', '不自动用联网候选改正史', 'apps/web、版权研究模块、tests/e2e', '原文进入主笔上下文、付费联网', '阶段6', '版权阻断、响应式、离线、无障碍和缓存失效通过', 'npm run verify; npm run test -- tests/e2e'],
  ['全量验收与发布', '执行全量回归、稳定性、两书五章、恢复、文档和本地发布', '不推送远程、不声称第二物理备份', '全项目、docs/releases', 'D:\\AI智囊团、远程系统', '阶段7', 'ACCEPTANCE全部条目有通过证据且无blocker或major', 'npm run verify; npm run test:coverage; npm run acceptance']
];

function initialize() {
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO releases (release_id, product_name, started_at, status)
    VALUES (?, '文秘写作', ?, 'active') ON CONFLICT(release_id) DO NOTHING`).run(releaseId, now);
  const insert = database.prepare(`
    INSERT INTO stage_tasks (
      task_id, release_id, stage, goal, exclusions, owner, allowed_files, forbidden_files,
      dependencies, constraints_text, acceptance, test_commands, stop_conditions,
      rollback_method, reviewer, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, '当前Codex', ?, ?, ?, ?, ?, ?, ?, ?, '当前Codex证据化复核', ?, ?)
    ON CONFLICT(release_id, stage) DO NOTHING
  `);
  stageDefinitions.forEach((definition, stage) => {
    const [name, goal, exclusions, allowedFiles, forbiddenFiles, dependencies, acceptance, testCommands] = definition;
    insert.run(
      `${releaseId}:stage-${stage}`, releaseId, stage, `${name}：${goal}`, exclusions,
      allowedFiles, forbiddenFiles, dependencies,
      '只在D:\\wenmixiezuo；安全、可逆、零现金默认；公共API、迁移和安全机制串行',
      acceptance, testCommands,
      '需要付费、真实密钥、永久删除、重大架构变更、生产恢复或外部阻塞',
      '未提交改动按文件撤销；已提交内容使用向前修复提交；数据库只使用向前迁移',
      stage === 0 ? 'passed' : 'pending', now
    );
  });
  console.log(JSON.stringify({ releaseId, stages: stageDefinitions.length, ledger: resolve(controlDir, 'release-ledger.sqlite') }));
}

function status() {
  const rows = database.prepare('SELECT stage, goal, status, updated_at FROM stage_tasks WHERE release_id = ? ORDER BY stage').all(releaseId);
  console.log(JSON.stringify({ releaseId, stages: rows }, null, 2));
}

function updateStage(stageRaw, statusValue) {
  const stage = Number(stageRaw);
  if (!Number.isInteger(stage) || stage < 0 || stage > 8 || !['pending', 'working', 'passed', 'failed', 'blocked'].includes(statusValue)) {
    throw new Error('用法：node scripts/release-ledger.mjs stage <0-8> <pending|working|passed|failed|blocked>');
  }
  const result = database.prepare('UPDATE stage_tasks SET status = ?, updated_at = ? WHERE release_id = ? AND stage = ?')
    .run(statusValue, new Date().toISOString(), releaseId, stage);
  if (result.changes !== 1) throw new Error(`阶段 ${stage} 不存在`);
  console.log(JSON.stringify({ releaseId, stage, status: statusValue }));
}

function addEvidence(stageRaw, kind, commandText, resultText, gitCommit = null) {
  const stage = Number(stageRaw);
  if (!Number.isInteger(stage) || stage < 0 || stage > 8 || !kind || !commandText || !resultText) {
    throw new Error('用法：node scripts/release-ledger.mjs evidence <0-8> <kind> <command> <result> [commit]');
  }
  database.prepare(`INSERT INTO evidence (release_id, stage, kind, command_text, result_text, git_commit, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(releaseId, stage, kind, commandText, resultText, gitCommit, new Date().toISOString());
  console.log(JSON.stringify({ releaseId, stage, kind }));
}

try {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'init') initialize();
  else if (command === 'status') status();
  else if (command === 'stage') updateStage(args[0], args[1]);
  else if (command === 'evidence') addEvidence(args[0], args[1], args[2], args[3], args[4]);
  else throw new Error(`未知账本命令：${command}`);
} finally {
  database.close();
}

