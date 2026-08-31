export const FEATURE_BASELINES = [
  { key: 'previous-production', label: 'V7 清理前生产版本', revision: '50f5ce6a', purpose: '核对当前线上功能均保留真实入口' },
  { key: 'stable-baseline', label: 'V7 唯一产品基线', revision: '3d37f2d', purpose: '核对清理没有恢复或混入旧产品能力' }
] as const;

export type FeatureBaselineKey = typeof FEATURE_BASELINES[number]['key'];
export type FeatureSurface = 'author' | 'admin' | 'system';
export type FeatureCapabilityStatus = 'added' | 'retained' | 'relocated' | 'replaced' | 'retired' | 'suspected_missing';
type FeatureIntroduction = 'stable-baseline' | 'previous-production' | 'current';
type Seed = readonly [id: string, name: string, description: string, introduced?: FeatureIntroduction];

export interface FeatureCapabilityDefinition {
  id: string;
  moduleId: string;
  moduleName: string;
  surface: FeatureSurface;
  name: string;
  description: string;
  currentAvailable: boolean;
  currentEntry: string | null;
  evidence: string[];
  introduced: FeatureIntroduction;
  statusOverrides?: Partial<Record<FeatureBaselineKey, FeatureCapabilityStatus>>;
  previousEntry?: string;
  replacement?: string;
  decision?: string;
  impact?: string;
  recommendation?: string;
}

export interface FeatureCapabilityRecord {
  id: string;
  moduleId: string;
  moduleName: string;
  surface: FeatureSurface;
  name: string;
  description: string;
  status: FeatureCapabilityStatus;
  currentAvailable: boolean;
  currentEntry: string | null;
  evidence: string[];
  previousEntry?: string;
  replacement?: string;
  decision?: string;
  impact?: string;
  recommendation?: string;
}

function currentModule(
  moduleId: string,
  moduleName: string,
  surface: FeatureSurface,
  currentEntry: string,
  evidence: string[],
  items: Seed[]
): FeatureCapabilityDefinition[] {
  return items.map(([id, name, description, introduced]) => ({
    id,
    moduleId,
    moduleName,
    surface,
    name,
    description,
    currentAvailable: true,
    currentEntry,
    evidence,
    introduced: introduced ?? 'stable-baseline'
  }));
}

export const FEATURE_CAPABILITIES: FeatureCapabilityDefinition[] = [
  ...currentModule('identity-account', '账号与身份', 'author', '登录 / 个人中心', [
    'coauthoring-v7/author-app/src/AuthorAccountBoundary.tsx',
    'apps/api/src/http/account-routes.ts'
  ], [
    ['account-register', '账号注册', '创建独立作者账号。'],
    ['account-login-session', '登录与会话', '登录、会话核验、退出与会话撤销。'],
    ['account-personal-center', '个人资料', '查看当前账号、身份和状态。'],
    ['account-role-gate', '作者与管理员分流', '按已验证角色隔离创作台和独立后台。']
  ]),
  ...currentModule('membership-feedback', '会员、用量与反馈', 'author', '个人中心 / 意见反馈', [
    'coauthoring-v7/author-app/src/account-api.ts',
    'apps/api/src/infrastructure/security/membership-service.ts',
    'apps/api/src/http/v7-admin-console-routes.ts'
  ], [
    ['membership-summary', '会员概览', '查看套餐、有效期和算力值。'],
    ['membership-gate', '会员门禁', '按有效会员和剩余额度决定模型能力。'],
    ['usage-summary', '作者用量', '查看本人真实用量换算后的算力值。'],
    ['feedback-submit', '提交反馈', '把当前页面的问题或建议提交到问题中心。']
  ]),
  ...currentModule('opening-books', '开书与书籍资料', 'author', '新建作品 / 作品资料', [
    'coauthoring-v7/author-app/src/NewNovelPage.tsx',
    'coauthoring-v7/author-app/src/InformationPage.tsx',
    'apps/api/src/http/v7-opening-agent-routes.ts'
  ], [
    ['opening-taxonomy', '开书分类', '读取当前题材与标签目录。'],
    ['opening-draft', '开书草稿', '保存、读取和继续未完成的开书输入。'],
    ['opening-agent-task', '开书协作', '由当前编辑部生成可确认的开书候选。'],
    ['book-list-switch', '作品列表与切换', '只列出当前作者的 V7 作品。'],
    ['book-profile-version', '作品资料版本', '版本化维护作品资料并保留确认边界。'],
    ['book-archive-restore', '归档与恢复', '可恢复地归档和恢复作品。'],
    ['title-design', '书名设计', '生成、查看和采用书名候选。'],
    ['cover-design', '封面设计', '生成、采用、预览和下载封面。']
  ]),
  ...currentModule('setting-editorial', '设定协作', 'author', '设定', [
    'coauthoring-v7/author-app/src/SettingPage.tsx',
    'apps/api/src/http/v7-setting-editorial-routes.ts'
  ], [
    ['setting-recommendations', '设定建议', '按本书当前资料推荐必要设定项。'],
    ['setting-selection', '设定范围选择', '保存作者选择和自定义设定项。'],
    ['setting-parallel-batch', '设定协作批次', '同一冻结资料下由合格成员独立产出。'],
    ['setting-fusion-revision', '融合与修订', '融合候选或按作者原话创建新版本。'],
    ['setting-confirmation', '设定确认', '确认精确版本并锁定下游依据。'],
    ['setting-final-review', '设定终审', '检查冲突、缺证据和当前可用性。']
  ]),
  ...currentModule('planning-trees', '规划树与故事线', 'author', '故事线 / 创作', [
    'coauthoring-v7/author-app/src/TimeMachinePage.tsx',
    'coauthoring-v7/author-app/src/CreationWorkspacePage.tsx',
    'apps/api/src/http/v7-planning-tree-routes.ts'
  ], [
    ['planning-tree-versions', '规划树版本', '读取、创建、修改、确认和查看历史版本。'],
    ['timemachine-round', '时光机方案', '从同一资料范围生成多席方案并由作者决定。'],
    ['volume-expansion', '分卷展开', '从已确认上游生成当前卷候选。'],
    ['chain-expansion', '事件链展开', '为当前卷生成可确认的事件链。'],
    ['planning-member-selection', '规划成员选择', '在合格岗位中选择或追加成员。'],
    ['planning-task-recovery', '规划任务恢复', '查看失败位置并只恢复允许重试的部分。']
  ]),
  ...currentModule('creation-pipeline', '章纲、正文与正式化', 'author', '创作', [
    'coauthoring-v7/author-app/src/CreationWorkspacePage.tsx',
    'apps/api/src/http/v7-creation-routes.ts',
    'apps/api/src/application/creation/v7-creation-formalization-service.ts'
  ], [
    ['creation-workflow', '创作工作流', '从确认规划建立绑定精确版本的创作工作流。'],
    ['chapter-outline-candidates', '章纲候选', '生成、比较和采用章纲候选。'],
    ['manuscript-generation', '正文生成', '按确认章纲和冻结资料生成正文候选。'],
    ['manuscript-review', '独立综合审查', '核对事实、连续性、章纲责任、语言和阅读体验。'],
    ['targeted-rewrite', '定向重写', '只把具体未通过问题交回主笔处理。'],
    ['immutable-manuscript', '不可变正文版本', '每次修改形成完整新版本。'],
    ['chapter-settlement', '定稿与结算', '作者确认精确正文版本后记录实际发生内容。'],
    ['formalization-outbox', '写后正式化', '以幂等 outbox 增量维护人物和规划状态。']
  ]),
  ...currentModule('character-memory', '人物与故事资料', 'author', '资料库', [
    'coauthoring-v7/author-app/src/LibraryPage.tsx',
    'apps/api/src/http/v7-character-memory-routes.ts'
  ], [
    ['character-profile-versions', '人物档案版本', '创建、修改、归档、恢复并保留人物档案历史。'],
    ['character-sync', '人物同步', '从当前正式资料同步可追溯人物身份。'],
    ['character-context-pack', '人物资料包', '编译并验证绑定本书和版本的人物资料包。'],
    ['character-design-review', '人物设计与审查', '生成候选、检查问题并保留来源。'],
    ['character-change-candidates', '人物变化候选', '把正文结算产生的变化先保存为可追溯候选。']
  ]),
  ...currentModule('editorial-team-tasks', '编辑部与任务', 'author', '团队 / 任务', [
    'coauthoring-v7/author-app/src/TeamPage.tsx',
    'coauthoring-v7/author-app/src/TaskLogPage.tsx',
    'apps/api/src/http/v7-opening-agent-routes.ts'
  ], [
    ['editorial-roster', '编辑部成员', '显示当前岗位、成员、供应商、状态和能力。'],
    ['member-choice', '成员选择', '只在当前节点的合格成员中选择。'],
    ['task-list-detail', '任务列表与详情', '查看阶段、成员、结果和失败位置。'],
    ['task-partial-results', '保留部分结果', '多人批次失败时保留已经成功的候选。']
  ]),
  ...currentModule('naming-tools', '命名工具', 'author', '命名', [
    'coauthoring-v7/author-app/src/NamingWorkspace.tsx',
    'coauthoring-v7/author-app/src/NamingAssistantPanel.tsx'
  ], [
    ['name-candidates', '名称候选', '按人物、地点或组织语境整理候选。'],
    ['name-records', '命名记录', '保存和复用作者采用的名称。']
  ]),
  ...currentModule('admin-operations', '运营与用户管理', 'admin', '独立后台 /v7/', [
    'coauthoring-v7/admin-console/src/PlatformPages.tsx',
    'apps/api/src/http/v7-admin-console-routes.ts',
    'apps/api/src/http/v7-admin-platform-routes.ts'
  ], [
    ['admin-dashboard', '运营总览', '查看用户、任务、会员、用量和问题概况。'],
    ['admin-users', '用户管理', '检索用户、查看作品信息并执行状态操作。'],
    ['admin-usage', '用量统计', '按当前账本统计 token、算力和费用。'],
    ['admin-issues', '问题中心', '统一查看失败与反馈并维护处理状态。'],
    ['admin-memberships', '会员经营', '查看会员统计并办理开通、续费和撤销。']
  ]),
  ...currentModule('admin-agent-governance', 'Agent 管理', 'admin', '独立后台 → Agent 管理', [
    'coauthoring-v7/admin-console/src/UnifiedAgentGovernance.tsx',
    'apps/api/src/http/v7-opening-agent-routes.ts',
    'apps/api/src/http/v7-setting-editorial-routes.ts'
  ], [
    ['admin-agent-roster', '岗位与成员台账', '查看当前 V7 成员、能力、模型和状态。'],
    ['admin-agent-binding', '成员模型绑定', '版本化维护成员模型、上下岗和参数。'],
    ['admin-agent-audit', '运行证据', '核查当前批次冻结资料、成员和模型快照。']
  ]),
  ...currentModule('admin-prompt-governance', '提示词与上下文', 'admin', '独立后台 → 提示词与上下文', [
    'coauthoring-v7/admin-console/src/PromptContextCenter.tsx',
    'apps/api/src/http/v7-prompt-governance-routes.ts'
  ], [
    ['prompt-asset-versions', '提示资产版本', '创建、发布、回退和归档不可变提示资产版本。'],
    ['context-manifests', '上下文清单', '查看冻结来源、版本、Skill 和预算。'],
    ['prompt-execution-evidence', '执行证据', '核查脱敏后的真实执行绑定和失败信息。']
  ]),
  ...currentModule('feature-governance', '当前功能台账', 'admin', '独立后台 → 功能台账', [
    'apps/api/src/application/admin/v7-feature-capability-registry.ts',
    'coauthoring-v7/admin-console/src/FeatureCapabilitiesPage.tsx',
    'scripts/quality/verify-v7-capability-cutover.ts',
    'scripts/quality/verify-v7-runtime-source-closure.ts'
  ], [
    ['capability-registry', 'V7 功能台账', '只登记当前已部署且有真实证据的能力。'],
    ['capability-filter', '台账筛选', '按界面、模块、状态和关键词筛选。'],
    ['capability-release-guard', '运行闭包门禁', '证据丢失或重新混入旧功能时阻止验收。']
  ]),
  ...currentModule('runtime-safety', '运行、安全与恢复', 'system', 'API / Worker / 部署', [
    'apps/api/src/http/v7-server.ts',
    'apps/worker/src/main.ts',
    'scripts/evaluation/production-backup-verify.ts',
    'docs/DEPLOY.md'
  ], [
    ['owner-book-isolation', '账号与书籍隔离', '核心读写从会话取得 owner_id 并绑定 book_id。'],
    ['immutable-author-data', '作者正式数据保护', '候选和衍生记录不能覆盖作者确认内容或正文。'],
    ['worker-heartbeat', 'Worker 心跳', 'API 基于真实心跳判断正式化执行器是否就绪。'],
    ['formalization-recovery', '正式化恢复', 'Worker 重启后按幂等检查点继续追赶。'],
    ['secret-env-only', '密钥只在环境变量', '密钥不进入业务数据、日志或 Git。'],
    ['backup-verification', '备份验证', '核对 SQLite、不可变文件、清单与哈希。'],
    ['atomic-web-release', 'Web 原子发布', '版本目录切换并保留可回滚指针。']
  ])
];

export const FEATURE_BASELINE_SNAPSHOTS: Record<FeatureBaselineKey, readonly string[]> = {
  'previous-production': FEATURE_CAPABILITIES.map((item) => item.id),
  'stable-baseline': FEATURE_CAPABILITIES.map((item) => item.id)
};

const STATUS_LABELS: Record<FeatureCapabilityStatus, string> = {
  added: '新增',
  retained: '保留',
  relocated: '迁移',
  replaced: '替代',
  retired: '明确下线',
  suspected_missing: '疑似遗失'
};
const SURFACE_LABELS: Record<FeatureSurface, string> = { author: '作者端', admin: '独立后台', system: '系统能力' };
const INTRO_ORDER: Record<FeatureIntroduction, number> = { 'stable-baseline': 0, 'previous-production': 1, current: 2 };
const BASE_ORDER: Record<FeatureBaselineKey, number> = { 'stable-baseline': 0, 'previous-production': 1 };

export function isFeatureBaselineKey(value: unknown): value is FeatureBaselineKey {
  return FEATURE_BASELINES.some((item) => item.key === value);
}

export function isFeatureCapabilityStatus(value: unknown): value is FeatureCapabilityStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value);
}

export function buildFeatureCapabilityView(input: {
  baseline?: FeatureBaselineKey;
  status?: FeatureCapabilityStatus;
  moduleId?: string;
  query?: string;
} = {}) {
  const baseline = input.baseline ?? 'stable-baseline';
  const query = input.query?.trim().toLocaleLowerCase('zh-CN') ?? '';
  const compared = FEATURE_CAPABILITIES.flatMap((definition): FeatureCapabilityRecord[] => {
    const status = capabilityStatus(definition, baseline);
    if (status === null) return [];
    return [{
      id: definition.id,
      moduleId: definition.moduleId,
      moduleName: definition.moduleName,
      surface: definition.surface,
      name: definition.name,
      description: definition.description,
      status,
      currentAvailable: definition.currentAvailable,
      currentEntry: definition.currentEntry,
      evidence: definition.evidence
    }];
  });
  const moduleOptions = uniqueModules(compared);
  const filtered = compared.filter((item) => {
    if (input.status !== undefined && item.status !== input.status) return false;
    if (input.moduleId !== undefined && input.moduleId !== '' && item.moduleId !== input.moduleId) return false;
    if (query === '') return true;
    return [item.id, item.moduleName, item.name, item.description, item.currentEntry ?? '', ...item.evidence]
      .join(' ').toLocaleLowerCase('zh-CN').includes(query);
  });
  const modules = uniqueModules(filtered).map((module) => ({
    ...module,
    capabilities: filtered.filter((item) => item.moduleId === module.id)
  }));
  return {
    registry: {
      version: 'v7-runtime-capability-registry-v2',
      updatedAt: '2026-08-30',
      current: { label: 'V7 当前运行闭包', revision: 'workspace-current' },
      baseline: FEATURE_BASELINES.find((item) => item.key === baseline)!,
      availableBaselines: FEATURE_BASELINES,
      statusLabels: STATUS_LABELS,
      surfaceLabels: SURFACE_LABELS
    },
    summary: { ...statusSummary(compared), filteredCapabilities: filtered.length },
    moduleOptions,
    modules,
    losses: compared.filter((item) => item.status === 'suspected_missing')
  };
}

export function validateFeatureCapabilityRegistry(fileExists?: (path: string) => boolean): string[] {
  const errors: string[] = [];
  const byId = new Map<string, FeatureCapabilityDefinition>();
  for (const item of FEATURE_CAPABILITIES) {
    if (byId.has(item.id)) errors.push(`重复能力 ID：${item.id}`);
    byId.set(item.id, item);
    if (item.moduleId.trim() === '' || item.moduleName.trim() === '') errors.push(`能力缺少模块：${item.id}`);
    if (!item.currentAvailable || !item.currentEntry?.trim()) errors.push(`当前能力缺少入口：${item.id}`);
    if (item.evidence.length === 0) errors.push(`能力缺少代码证据：${item.id}`);
    if (fileExists) {
      for (const evidence of item.evidence) {
        if (!fileExists(evidence)) errors.push(`代码证据不存在：${item.id} → ${evidence}`);
      }
    }
  }
  for (const baseline of FEATURE_BASELINES) {
    const snapshot = FEATURE_BASELINE_SNAPSHOTS[baseline.key];
    if (snapshot.length !== FEATURE_CAPABILITIES.length) errors.push(`V7 基线能力数量不一致：${baseline.key}`);
    if (new Set(snapshot).size !== snapshot.length) errors.push(`V7 基线存在重复能力：${baseline.key}`);
    for (const id of snapshot) if (!byId.has(id)) errors.push(`V7 基线能力无当前登记：${baseline.key} → ${id}`);
  }
  return errors;
}

function capabilityStatus(item: FeatureCapabilityDefinition, baseline: FeatureBaselineKey): FeatureCapabilityStatus | null {
  const override = item.statusOverrides?.[baseline];
  if (override) return override;
  if (!item.currentAvailable) return null;
  return INTRO_ORDER[item.introduced] > BASE_ORDER[baseline] ? 'added' : 'retained';
}

function uniqueModules(items: FeatureCapabilityRecord[]) {
  const map = new Map<string, { id: string; name: string; surface: FeatureSurface }>();
  for (const item of items) {
    if (!map.has(item.moduleId)) map.set(item.moduleId, { id: item.moduleId, name: item.moduleName, surface: item.surface });
  }
  return [...map.values()];
}

function statusSummary(items: FeatureCapabilityRecord[]) {
  const statuses: Record<FeatureCapabilityStatus, number> = {
    added: 0,
    retained: 0,
    relocated: 0,
    replaced: 0,
    retired: 0,
    suspected_missing: 0
  };
  for (const item of items) statuses[item.status] += 1;
  return {
    modules: uniqueModules(items).length,
    capabilities: items.length,
    currentAvailable: items.filter((item) => item.currentAvailable).length,
    statuses
  };
}
