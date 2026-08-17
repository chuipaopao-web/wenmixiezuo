import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFINITION_VERSION = 'object-workflow-v3';
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
    status TEXT NOT NULL CHECK (status IN ('active', 'complete', 'blocked')),
    definition_version TEXT NOT NULL DEFAULT 'object-workflow-v3'
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

if (!(database.prepare(`PRAGMA table_info(releases)`).all()).some((column) => column.name === 'definition_version')) {
  database.exec(`ALTER TABLE releases ADD COLUMN definition_version TEXT NOT NULL DEFAULT 'object-workflow-v3'`);
}

const common = {
  owner: '当前Codex',
  forbiddenFiles: '项目外目录；API Key与凭证；不可逆作者数据修改',
  constraints: '只在D:\\wenmixiezuo；安全、可逆、零现金；公共API、迁移、核心编排和安全机制串行；API Key只读环境变量',
  stop: '实际付费、新密钥或登录、永久删除、重大架构变更、生产数据恢复或无法自行消除的外部阻塞',
  rollback: '未提交改动按文件撤销；已提交使用向前修复；数据库只使用向前迁移；派生投影可删除重建',
  reviewer: '当前Codex证据化复核'
};

const stageDefinitions = [
  {
    name: '当前基线与文档', goal: '冻结当前产品边界、对象工作流、任务清单、文档白名单和Git起点',
    exclusions: '历史文件和Git历史只用于追溯，不进入当前检索或覆盖新决定', allowedFiles: 'AGENTS.md、PROJECT_HANDBOOK.md、TASKS.md、当前docs、文档同步脚本与Git元数据',
    dependencies: '老板当前决定与项目章程', acceptance: '当前规格、任务、文档中心、起点commit和清理边界均可查询',
    tests: 'npm run docs:check; git status --short; git log -1 --oneline; npm run ledger:status'
  },
  {
    name: '本地安全与运行入口', goal: '验证本地会话、HTTP防护、桌面启动、依赖和套餐模型配置',
    exclusions: '不远程上传书籍，不把凭证写入数据库、日志、上下文或Git', allowedFiles: 'apps/api安全与运行配置、apps/web客户端、桌面脚本、foundation/security/runtime测试',
    dependencies: '阶段0', acceptance: '仅监听127.0.0.1，Host/Origin/Cookie/SSE/错误脱敏、启动停止和配置探针通过',
    tests: 'npm run verify; npm test -- tests/foundation tests/integration/runtime'
  },
  {
    name: '权威数据与Repository', goal: '验证SQLite权威对象、不可变版本、跨书隔离、前向迁移和作者原件保留',
    exclusions: '不修改已合并迁移，不永久删除作者数据，不让Worker直写正式表', allowedFiles: 'apps/api Repository与迁移、contracts、data-safety/knowledge/contract测试',
    dependencies: '阶段1', acceptance: '空库与已有库升级、跨书隔离、版本冲突、附件保留和恢复边界通过',
    tests: 'npm run verify; npm test -- tests/foundation/migration.test.ts tests/integration/knowledge tests/contract'
  },
  {
    name: '投影与混合检索', goal: '验证结构化直达、全文、向量、关系、时间因果和正式原文回查',
    exclusions: '投影不成为正史源，不跨书召回，不把摘要或相似结果当事实', allowedFiles: '切片、投影、检索、知识库、Worker、对应测试与本地模型缓存',
    dependencies: '阶段2', acceptance: '切片原子切换、投影重建、来源回查、无答案降级和跨书阻断通过',
    tests: 'npm run verify; npm test -- tests/integration/projections tests/integration/retrieval tests/integration/memory'
  },
  {
    name: '上下文与Agent治理', goal: '验证ContextCompiler任务矩阵、十四人团队、模型绑定、租约、预算与真实状态',
    exclusions: '不保存思维链，不用同模型冒充异模型复核，不注入其他书、旧版会话或过期候选', allowedFiles: 'memory/agents/tasks/models/budgets、Worker、对应测试',
    dependencies: '阶段3', acceptance: '上下文来源与排除项、三异模型审查、任务心跳、取消重试和接管通过',
    tests: 'npm run verify; npm test -- tests/integration/memory tests/integration/agents tests/integration/runtime'
  },
  {
    name: '开书、设定与卷纲', goal: '串联完整开书信息、设定对象协作、当前卷纲、作者原话与附件',
    exclusions: '不建立对话式创作入口，不把模板硬编码成公式，不替作者确认重大设定', allowedFiles: 'books/positioning/settings/planning/presentation、对应路由、UI、迁移与测试',
    dependencies: '阶段4与可用模型配置或确定性测试模式', acceptance: '原话入库、三席独立方案、作者选择融合、卷纲版本与附件上下文通过',
    tests: 'npm run verify; npm test -- tests/integration/domain tests/integration/workflow tests/integration/experience'
  },
  {
    name: '事件链、事件大纲与章纲', goal: '验证卷纲约束事件链、事件链约束事件大纲、事件大纲约束章纲',
    exclusions: '不跨事件自由扩写，不绕过活动上游版本，不把未来规划写入正史', allowedFiles: 'story-events/event-chapter-outlines/planning、对应路由、UI、迁移与测试',
    dependencies: '阶段5', acceptance: '事件因果、排序与结构调整、双编剧方案、章数字数评估、过期失效和确认通过',
    tests: 'npm run verify; npm test -- tests/integration/planning tests/integration/workflow'
  },
  {
    name: '正文、审查、结算与工作台', goal: '验证单一活动写手、不可变正文、三席独立审查、三级结算和当前工作台',
    exclusions: '不并写正式正文，不互看审查报告，不用规划预测替代正文事实', allowedFiles: 'creation/review/continuity/projections、apps/web、portability、桌面脚本与相关测试',
    dependencies: '阶段6', acceptance: '章纲约束正文、事实/文学/体验审查、作者定稿、章节事件卷结算、恢复和窄屏交互通过',
    tests: 'npm run verify; npm test -- tests/integration/creation tests/integration/continuity tests/integration/experience tests/accessibility'
  },
  {
    name: '全量验收与Git结算', goal: '完成迁移、运行、隔离、恢复、文档、全量测试、四端构建和可恢复Git提交',
    exclusions: '不把E2工程测试冒充E3/E4文学质量，不声称未执行的真实模型或第二介质证据', allowedFiles: '全项目当前白名单、data/control与Git',
    dependencies: '阶段0-7', acceptance: 'ACCEPTANCE当前工程项有新鲜证据，无重大BUG、无未说明旧语义，工作树结算清洁',
    tests: 'npm run development:settle; node scripts/audit-runtime-reachability.mjs; git diff --check; git status --short'
  }
];

function initialize() {
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO releases (release_id, product_name, started_at, status, definition_version)
    VALUES (?, '文秘写作', ?, 'active', ?) ON CONFLICT(release_id) DO UPDATE SET definition_version = excluded.definition_version`)
    .run(releaseId, now, DEFINITION_VERSION);
  const insert = database.prepare(`
    INSERT INTO stage_tasks (
      task_id, release_id, stage, goal, exclusions, owner, allowed_files, forbidden_files,
      dependencies, constraints_text, acceptance, test_commands, stop_conditions,
      rollback_method, reviewer, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id, stage) DO UPDATE SET
      goal = excluded.goal, exclusions = excluded.exclusions, owner = excluded.owner,
      allowed_files = excluded.allowed_files, forbidden_files = excluded.forbidden_files,
      dependencies = excluded.dependencies, constraints_text = excluded.constraints_text,
      acceptance = excluded.acceptance, test_commands = excluded.test_commands,
      stop_conditions = excluded.stop_conditions, rollback_method = excluded.rollback_method,
      reviewer = excluded.reviewer, updated_at = excluded.updated_at
  `);
  stageDefinitions.forEach((definition, stage) => {
    insert.run(
      `${releaseId}:stage-${stage}`, releaseId, stage, `${definition.name}：${definition.goal}`,
      definition.exclusions, common.owner, definition.allowedFiles, common.forbiddenFiles,
      definition.dependencies, common.constraints, definition.acceptance, definition.tests,
      common.stop, common.rollback, common.reviewer, stage === 0 ? 'passed' : 'pending', now
    );
  });
  console.log(JSON.stringify({ releaseId, definitionVersion: DEFINITION_VERSION, stages: stageDefinitions.length, ledger: resolve(controlDir, 'release-ledger.sqlite') }));
}

function status() {
  const release = database.prepare(`SELECT release_id, product_name, started_at, status, definition_version FROM releases WHERE release_id = ?`).get(releaseId) ?? null;
  const stages = database.prepare('SELECT stage, goal, status, updated_at FROM stage_tasks WHERE release_id = ? ORDER BY stage').all(releaseId);
  const evidenceCount = Number((database.prepare('SELECT COUNT(*) AS count FROM evidence WHERE release_id = ?').get(releaseId) ?? { count: 0 }).count);
  console.log(JSON.stringify({ releaseId, release, stages, evidenceCount }, null, 2));
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

function updateRelease(statusValue) {
  if (!['active', 'complete', 'blocked'].includes(statusValue)) throw new Error('用法：node scripts/release-ledger.mjs release <active|complete|blocked>');
  if (statusValue === 'complete') {
    const rows = database.prepare('SELECT stage, status FROM stage_tasks WHERE release_id = ? ORDER BY stage').all(releaseId);
    if (rows.length !== stageDefinitions.length || rows.some((row) => row.status !== 'passed')) throw new Error('RELEASE_STAGES_NOT_PASSED');
  }
  const result = database.prepare('UPDATE releases SET status = ? WHERE release_id = ?').run(statusValue, releaseId);
  if (result.changes !== 1) throw new Error('RELEASE_NOT_INITIALIZED');
  console.log(JSON.stringify({ releaseId, status: statusValue }));
}

function addEvidence(stageRaw, kind, commandText, resultText, gitCommit = null) {
  const stage = Number(stageRaw);
  if (!Number.isInteger(stage) || stage < 0 || stage > 8 || !kind || !commandText || !resultText) {
    throw new Error('用法：node scripts/release-ledger.mjs evidence <0-8> <kind> <command> <result> [commit]');
  }
  const stageExists = database.prepare('SELECT 1 FROM stage_tasks WHERE release_id = ? AND stage = ?').get(releaseId, stage);
  if (stageExists === undefined) throw new Error('RELEASE_STAGE_NOT_INITIALIZED');
  database.prepare(`INSERT INTO evidence (release_id, stage, kind, command_text, result_text, git_commit, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(releaseId, stage, kind, commandText, resultText, gitCommit, new Date().toISOString());
  console.log(JSON.stringify({ releaseId, stage, kind }));
}

try {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'init') initialize();
  else if (command === 'status') status();
  else if (command === 'stage') updateStage(args[0], args[1]);
  else if (command === 'release') updateRelease(args[0]);
  else if (command === 'evidence') addEvidence(args[0], args[1], args[2], args[3], args[4]);
  else throw new Error(`未知账本命令：${command}`);
} finally {
  database.close();
}
