import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFINITION_VERSION = 'longform-r1-v2';
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
    definition_version TEXT NOT NULL DEFAULT 'legacy-v1'
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
  database.exec(`ALTER TABLE releases ADD COLUMN definition_version TEXT NOT NULL DEFAULT 'legacy-v1'`);
}

const common = {
  owner: '当前Codex',
  forbiddenFiles: 'D:\\AI智囊团；项目外目录；API Key与凭证；不可逆生产数据修改',
  constraints: '只在D:\\wenmixiezuo；安全、可逆、零现金；公共API、迁移、核心编排和安全机制串行；API Key只读环境变量',
  stop: '实际付费、新密钥或登录、永久删除、重大架构变更、生产数据恢复或无法自行消除的外部阻塞',
  rollback: '未提交改动按文件撤销；已提交使用向前修复；数据库只使用向前迁移；派生投影可删除重建',
  reviewer: '当前Codex证据化复核'
};

const stageDefinitions = [
  {
    name: 'release基线', goal: '激活唯一长篇release、冻结设计、任务账本和历史证据边界',
    exclusions: '不实现业务功能，不改写历史release证据', allowedFiles: 'RELEASE_ID、AGENTS.md、TASKS.md、docs/releases、data/control、Git元数据',
    dependencies: '老板连续开发授权与冻结设计', acceptance: 'release ID、起点commit、范围、安全边界和机器账本均可查询',
    tests: 'git status --short; git log -1 --oneline; npm run ledger:status'
  },
  {
    name: '安全入口与能力探针', goal: '建立本机会话、HTTP防护、运行/依赖/模型资产能力探针',
    exclusions: '不下载模型，不改变书籍业务语义', allowedFiles: 'apps/api安全与capabilities、apps/web客户端、tests/foundation与security',
    dependencies: '阶段0', acceptance: 'Host/Origin/Cookie/SSE/错误脱敏和硬件依赖探针通过',
    tests: 'npm run verify; npm test -- tests/integration/security tests/integration/runtime'
  },
  {
    name: '知识生命周期与Repository', goal: '完成Repository边界、表达资料、四层生命周期、三轴时间和结算门禁',
    exclusions: '不引入独立运维数据库，不猜测缺失时间', allowedFiles: 'apps/api知识/Repository/迁移0010-0011、对应测试',
    dependencies: '阶段1', acceptance: '空库/升级迁移、跨书、提升、冲突和结算恢复通过',
    tests: 'npm run verify; npm test -- tests/integration/knowledge tests/contract tests/fault-injection'
  },
  {
    name: '切片与向量投影', goal: '完成不可变父子切片、outbox、水位、本地嵌入和LanceDB向量投影运行链',
    exclusions: '向量不成为正史源，运行期不远程下载模型', allowedFiles: '切片/投影/本地模型/Worker、迁移0012、对应测试与data/cache/models',
    dependencies: '阶段2与已验证本地语义资产', acceptance: 'FTS/向量构建、原子切换、崩溃恢复、删库重建和跨书隔离通过',
    tests: 'npm run verify; npm test -- tests/integration/projections tests/integration/retrieval tests/fault-injection'
  },
  {
    name: '混合RAG与上下文', goal: '接通结构化、FTS、向量、关系四通道、H/E/I融合、证据闭环和岗位上下文预算',
    exclusions: '不把全量召回直接注入，不把摘要当事实权威', allowedFiles: 'apps/api memory/retrieval/context、迁移0013、检索和上下文测试',
    dependencies: '阶段3', acceptance: '对抗查询、无答案、消融、来源闭环、Token预算和跨书阻断通过',
    tests: 'npm run verify; npm test -- tests/integration/retrieval tests/integration/memory tests/quality'
  },
  {
    name: '连续性与Agent治理', goal: '完成五级连续性、十一人团队、小文秘书、提示快照、模型绑定与接管',
    exclusions: '不保存思维链，不把秘书算创作Agent', allowedFiles: 'continuity/agents/local-assistant、迁移0014-0015、对应测试',
    dependencies: '阶段4', acceptance: '滚动规划、接管、模型独立性、路由和降级测试通过',
    tests: 'npm run verify; npm test -- tests/integration/continuity tests/integration/agents tests/integration/local-assistant'
  },
  {
    name: '正式创作流水线', goal: '串联自由聊天、双编剧、确认规划、逐章写作、三异模型点评、确认与结算',
    exclusions: '只有书名或一句写一章不得绕过准备；不并写正式章', allowedFiles: 'chat/discussion/creation/review/Worker、迁移0016-0017、对应测试',
    dependencies: '阶段5与套餐模型配置或确定性测试模式', acceptance: '原话保留、点名直达、双编剧、单活动写手、三点评、取消恢复和结算通过',
    tests: 'npm run verify; npm test -- tests/integration/chat tests/integration/discussions tests/integration/creation tests/fault-injection'
  },
  {
    name: '工作台与可移植', goal: '完成内容优先UI、资料库/图谱/任务中心/设置、桌面入口和安全导入导出',
    exclusions: '不上传云端，不把可重建投影装入权威导出', allowedFiles: 'apps/web、portability、迁移0018、桌面脚本、e2e与无障碍测试',
    dependencies: '阶段6', acceptance: '窄侧栏、章节树分页、真实状态、离线草稿、桌面启动和导入回滚通过',
    tests: 'npm run verify; npm test -- tests/e2e tests/integration/portability tests/accessibility'
  },
  {
    name: '满规模验收与发布', goal: '完成500万字符/1500章回放、迁移、运行、恢复、证据、Git提交和远程备份',
    exclusions: '不把E2/E3冒充E4，不声称不存在的第二物理备份', allowedFiles: '全项目、docs/releases、data/control、Git',
    dependencies: '阶段0-7', acceptance: 'ACCEPTANCE覆盖项有新鲜证据，无未说明占位，release账本完整且远程备份成功',
    tests: 'npm run typecheck; npm test; npm run build; npm run migrate; npm run acceptance; npm run evaluate:scale'
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
