export const FEATURE_BASELINES = [
  { key: 'previous-production', label: '上一生产版本', revision: 'd98dc81', purpose: '检查最近一次升级是否遗漏能力' },
  { key: 'stable-baseline', label: '早期稳定版本', revision: '61cb87b', purpose: '追查更早已经消失或迁移的能力' }
] as const;

export type FeatureBaselineKey = typeof FEATURE_BASELINES[number]['key'];
export type FeatureSurface = 'author' | 'admin' | 'system';
export type FeatureCapabilityStatus = 'added' | 'retained' | 'relocated' | 'replaced' | 'retired' | 'suspected_missing';
type FeatureIntroduction = 'stable-baseline' | 'previous-production' | 'current';
type Seed = readonly [id: string, name: string, description: string, introduced?: FeatureIntroduction];

export interface FeatureCapabilityDefinition {
  id: string; moduleId: string; moduleName: string; surface: FeatureSurface; name: string; description: string;
  currentAvailable: boolean; currentEntry: string | null; evidence: string[]; introduced: FeatureIntroduction;
  statusOverrides?: Partial<Record<FeatureBaselineKey, FeatureCapabilityStatus>>;
  previousEntry?: string; replacement?: string; decision?: string; impact?: string; recommendation?: string;
}
export interface FeatureCapabilityRecord {
  id: string; moduleId: string; moduleName: string; surface: FeatureSurface; name: string; description: string;
  status: FeatureCapabilityStatus; currentAvailable: boolean; currentEntry: string | null; evidence: string[];
  previousEntry?: string; replacement?: string; decision?: string; impact?: string; recommendation?: string;
}

function currentModule(
  moduleId: string, moduleName: string, surface: FeatureSurface, currentEntry: string, evidence: string[],
  items: Seed[], introduced: FeatureIntroduction = 'stable-baseline'
): FeatureCapabilityDefinition[] {
  return items.map(([id, name, description, itemIntroduction]) => ({
    id, moduleId, moduleName, surface, name, description, currentAvailable: true, currentEntry, evidence,
    introduced: itemIntroduction ?? introduced
  }));
}

const C: FeatureCapabilityDefinition[] = [
  ...currentModule('identity-account','账号与身份','author','登录页 / 个人中心',
    ['coauthoring-v7/author-app/src/AuthorAccountBoundary.tsx','apps/api/src/http/account-routes.ts'],[
      ['account-register','账号注册','创建独立作者账号。'],['account-login-session','登录与会话','登录、会话核验和退出。'],
      ['account-personal-center','个人资料','查看和维护个人资料。'],['account-role-gate','作者/管理员分流','按真实角色隔离创作台与后台。','previous-production']]),
  ...currentModule('bookshelf-lifecycle','书架与书籍生命周期','author','我的书籍',
    ['coauthoring-v7/author-app/src/AuthorApp.tsx','coauthoring-v7/author-app/src/opening-api.ts','apps/api/src/application/books/book-lifecycle-service.ts'],[
      ['book-list-switch','书籍列表与切换','查看本人书籍并切换。'],['book-create','创建新书','从开书资料创建新书。'],
      ['book-archive','归档书籍','可恢复地归档书籍。'],['book-permanent-delete-safety','永久删除安全确认','影响预览和双重确认。']]),
  ...currentModule('opening-profile','开书资料与接续','author','建书弹窗 / 顶部书籍信息',
    ['coauthoring-v7/author-app/src/NewNovelPage.tsx','coauthoring-v7/author-app/src/InformationPage.tsx','apps/api/src/application/books/book-profile-view-service.ts'],[
      ['opening-draft','开书草稿','保存未完成的开书输入。'],['opening-import-analysis','简介导入与识别','提取可确认的开书字段。'],
      ['book-profile-edit','书籍资料查看与修改','查看并版本化修改书名、简介等资料。'],['existing-manuscript-continuation','已有正文接续','导入正文并建立接续依据。']]),
  ...currentModule('setting-workspace','非剧情设定','author','设定',
    ['coauthoring-v7/author-app/src/SettingPage.tsx','apps/api/src/http/v7-setting-editorial-routes.ts','apps/api/src/application/books/v7-setting-editorial-service.ts'],[
      ['setting-catalog','设定目录','按本书需要维护设定。'],['setting-protagonist-personality','主角性格','维护主角性格、动机和行为边界。'],
      ['setting-ai-collaboration','设定 AI 协作','成员独立出方案并由作者确认。'],['setting-gap-detection','设定缺口提示','只提示当前创作必要缺口。','previous-production'],
      ['setting-baseline-versioning','设定基线版本','确认设定形成可追踪版本。'],['setting-quality-review','设定质量检查','检查冲突和缺证据。','previous-production']]),
  ...currentModule('storyline-growth','生长式故事线','author','故事线',
    ['coauthoring-v7/author-app/src/TimeMachinePage.tsx','apps/api/src/http/v7-planning-tree-routes.ts','apps/api/src/application/planning/v7-planning-maintenance-service.ts'],[
      ['storyline-growth-map','生长式线路地图','故事线跟随正文逐卷生长。'],['storyline-established-facts','已经发生','只读呈现正文和结算事实。'],
      ['storyline-active-threads','正在推进','展示活跃线路的真实状态。'],['storyline-author-horizon','我目前想到这里','只确认作者当前看得见的最远节点。'],
      ['storyline-editor-recommendations','主编推荐下一段','只推荐未来一至两卷且不自动生效。'],['storyline-open-questions','还没决定','明确保留开放问题。'],
      ['storyline-candidate-ledger','潜在线路候选','从结算证据提炼，确认后才转正。']], 'current'),
  ...currentModule('volume-planning','分卷方向','author','分卷',
    ['coauthoring-v7/author-app/src/CreationWorkspacePage.tsx','apps/api/src/http/v7-planning-tree-routes.ts','apps/api/src/application/planning/v7-planning-tree-service.ts'],[
      ['volume-direction','当前卷方向','只规划当前需要推进的卷。'],['volume-plan-generation','分卷方案生成','生成多套卷方案。'],
      ['volume-confirmation','分卷确认与版本','确认方案并锁定版本。'],['volume-expression','卷表达与节奏','维护当前卷承诺和节奏。','previous-production'],
      ['volume-settlement','卷结算入口','卷结束后记录正文实际。','previous-production']]),
  ...currentModule('event-chain','当前卷事件链','author','事件',
    ['coauthoring-v7/author-app/src/CreationWorkspacePage.tsx','apps/api/src/http/v7-planning-tree-routes.ts','apps/api/src/application/planning/v7-planning-tree-generation-service.ts'],[
      ['event-chain-view','事件链','组织连续推进的事件。'],['event-generation','事件方案生成','同资料包下独立出方案。'],
      ['event-confirmation','事件确认与版本','确认事件并锁定下游依据。'],['event-role-orchestration','事件成员编排','选择、替换或追加成员。','previous-production']]),
  ...currentModule('chapter-outline','章链与详细章纲','author','章节',
    ['coauthoring-v7/author-app/src/CreationWorkspacePage.tsx','apps/api/src/http/v7-creation-routes.ts','apps/api/src/application/creation/v7-creation-workflow-service.ts'],[
      ['chapter-chain','完整章链','覆盖当前事件的完整章节链。'],['chapter-outline-detail','近期详细章纲','详细展开近期章节。'],
      ['outline-manuscript-alignment','章纲对齐正文','正文变化后按事实重新对齐。','current'],['chapter-writing-readiness','写作就绪检查','写正文前检查上游依据。']]),
  ...currentModule('manuscript-production','单章正文与审校','author','章节 → 正文',
    ['coauthoring-v7/author-app/src/CreationWorkspacePage.tsx','apps/api/src/http/v7-creation-routes.ts','apps/api/src/application/creation/v7-managed-creation-service.ts'],[
      ['chapter-draft-generation','单章正文生成','按确认章纲生成正文。'],['writer-selection','主笔选择','选择或追加主笔独立生成。'],
      // 能力 ID 是已发布台账的稳定主键，不因内部执行从“多次审查”
      // 收敛为“一次复合审查”就改名；后台文案必须反映当前真实能力。
      ['manuscript-versioning','正文完整版本','修改产生完整新版本。'],['multi-review','一次独立综合审查','由不同模型一次核对事实、连续性、章纲责任、语言自然度和阅读体验。'],
      ['editor-synthesis','审查后定向重写','未通过时只带具体问题回到主笔，最多再写一轮。','current'],['chapter-approval','章节确认定稿','确认正文版本后结算。']]),
  ...currentModule('settlement-continuity','结算与后续衔接','author','章节 / 事件 / 分卷结算',
    ['coauthoring-v7/author-app/src/TimeMachinePage.tsx','apps/api/src/application/creation/v7-creation-formalization-service.ts','apps/worker/src/executors/v7-formalization-executor.ts'],[
      ['chapter-settlement','章节结算','记录本章真实发生。'],['event-settlement','事件结算','汇总事件真实结果。'],
      ['volume-settlement-followup','卷结算与线路提炼','提炼线路真实进度和候选。','current'],['next-volume-transition','下一卷衔接','用结算事实启动下一卷。','current']]),
  ...currentModule('knowledge-library','资料库与故事知识','author','资料库',
    ['coauthoring-v7/author-app/src/LibraryPage.tsx','apps/api/src/http/v7-character-memory-routes.ts','apps/api/src/application/characters/v7-character-memory-service.ts'],[
      ['knowledge-library','资料库','维护本书可追溯资料。'],['story-knowledge','故事知识','按实体和事实查看知识。'],
      ['canon-index','正典索引','索引确认正文、设定和结算。'],['narrative-projection','叙事投影','形成关系和状态投影。'],
      ['semantic-retrieval','语义检索','检索证据并保留来源。']]),
  ...currentModule('naming-tools','命名工具','author','命名',
    ['coauthoring-v7/author-app/src/NamingWorkspace.tsx','coauthoring-v7/author-app/src/NamingAssistantPanel.tsx'],[
      ['name-generation','名称生成','为人物、地点和组织生成候选。'],['name-library','命名记录','保存和复用已采用名称。']]),
  ...currentModule('editorial-team','AI 编辑部','author','团队',
    ['coauthoring-v7/author-app/src/TeamPage.tsx','apps/api/src/application/books/v7-unified-editorial-department-service.ts','apps/api/src/application/agents/v7-agent-governance-service.ts'],[
      ['team-roster-25','7 类岗位、固定 22 名成员','三名强模型分别覆盖主编、副编、策划、审查和记录岗位；六名主笔可供正文切换，Seedream只负责封面成品。'],['team-role-categories','岗位分组','主编、副编、策划编剧、主笔、独立审查、资料记录和封面制作。'],
      ['team-member-choice','按节点选择成员','开书、设定、章纲和正文重做时，可在当前岗位的合格成员中选择。'],['team-parallel-fairness','三方案公平比较','时光机、卷和链由三名强模型使用同一冻结资料范围独立产出。'],
      ['team-status-cost','状态与消耗等级','显示供应公司、消耗等级和真实状态。']], 'previous-production'),
  ...currentModule('task-center','任务中心','author','任务',
    ['coauthoring-v7/author-app/src/TaskLogPage.tsx','apps/api/src/application/books/v7-task-roster-snapshot.ts','apps/api/src/application/books/v7-design-task-view.ts'],[
      ['task-list','任务列表','查看本书任务。'],['task-detail','任务详情','查看阶段、成员和失败位置。'],
      ['task-failure-recovery','失败恢复','只重试失败部分。'],['retained-partial-results','部分结果保留','多人批次不丢弃成功结果。','previous-production']]),
  ...currentModule('feedback','意见与问题反馈','author','意见反馈',
    ['coauthoring-v7/author-app/src/AuthorAccountBoundary.tsx','apps/api/src/http/admin-console-routes.ts'],[
      ['feedback-submit','提交反馈','提交带页面位置的问题或建议。'],['feedback-admin-trace','后台追踪反馈','进入问题记录并处理。','previous-production']]),
  ...currentModule('author-membership','作者会员与用量','author','个人中心 / 会员门禁',
    ['coauthoring-v7/author-app/src/AuthorAccountBoundary.tsx','apps/api/src/infrastructure/security/membership-service.ts'],[
      ['membership-gate','会员能力门禁','按会员和配额决定能力。'],['membership-account-summary','会员与用量概览','查看套餐、周期和算力。']], 'previous-production'),
  ...currentModule('admin-dashboard','后台运营总览','admin','独立后台 → 总览',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-console-routes.ts'],[
      ['admin-operations-overview','运营指标','用户、任务、算力、支出和问题概况。'],
      ['admin-paid-rate','付费率','累计付费率和近 30 天首付率。','current'],['admin-recorded-revenue','已记录会员收入','会员实收总额和当月金额。','current']], 'previous-production'),
  ...currentModule('admin-users','后台用户与书籍审计','admin','独立后台 → 用户',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-console-routes.ts'],[
      ['admin-user-list-status','用户列表与状态','检索用户并管理状态。'],
      ['admin-user-book-inventory','用户书籍信息','查看创建、活跃、归档和进度。','current'],['admin-user-failure-location','今日失败位置','查看失败任务、页面和恢复结果。','current']], 'previous-production'),
  ...currentModule('admin-compute','后台算力','admin','独立后台 → 算力',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-platform-routes.ts'],[
      ['admin-compute-usage','算力统计','按用户、模型和日期统计。'],['admin-compute-trend','算力趋势','查看周期变化。']], 'previous-production'),
  ...currentModule('admin-api-cost','后台 API 消耗','admin','独立后台 → API消耗',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-platform-routes.ts'],[
      ['admin-api-cash-cost','真实 API 金额','按用户、模型和日期统计金额。'],['admin-api-call-trend','API 调用趋势','查看调用、token 和金额。']], 'previous-production'),
  ...currentModule('admin-ai-governance','后台模型、成员与 Skill','admin','独立后台 → 模型 / 创作模板',
    ['coauthoring-v7/admin-console/src/UnifiedAgentGovernance.tsx','coauthoring-v7/admin-console/src/PromptContextCenter.tsx','apps/api/src/application/agents/v7-agent-governance-service.ts'],[
      ['admin-model-scheme','平台模型方案','管理员绑定供应商和模型。'],['admin-member-binding','成员独立绑定','管理成员模型、供应商和状态。'],
      ['admin-member-expand-26','成员岗位与模型绑定','查看和调整固定22名成员的模型、上下岗、顺序与温度偏移。','current'],['admin-skill-registry','Skill 版本台账','查看三层 Skill 版本与哈希。','current'],
      ['admin-batch-evidence','AI 批次公平性证据','核查资料包、Skill、模板和模型快照。','current']], 'previous-production'),
  ...currentModule('admin-issues','后台问题记录','admin','独立后台 → 问题记录',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-platform-routes.ts'],[
      ['admin-issue-center','失败与反馈汇总','统一查看失败任务和反馈。'],['admin-issue-workflow','问题处理状态','维护严重性、状态和备注。']], 'previous-production'),
  ...currentModule('admin-templates','后台创作模板','admin','独立后台 → 创作模板',
    ['coauthoring-v7/admin-console/src/PromptContextCenter.tsx','coauthoring-v7/backend/planning-methods/method-asset-profiles.ts','apps/api/src/application/agents/v7-prompt-governance-service.ts'],[
      ['admin-narrative-methods','叙事方法配置','查看、修改和启停方法。'],
      ['admin-creative-template-versioning','创作模板版本','维护结构与提示契约版本。','current'],['admin-template-rollout','模板灰度与启用','控制状态和灰度比例。','current']], 'previous-production'),
  ...currentModule('admin-prompts','后台提示词','admin','独立后台 → 提示词',
    ['coauthoring-v7/admin-console/src/PromptContextCenter.tsx','apps/api/src/application/agents/v7-runtime-prompt-compiler.ts','apps/api/src/application/agents/v7-prompt-governance-service.ts'],[
      ['admin-prompt-trigger-catalog','AI 介入触发点','登记动作、岗位、时机和资料包。'],['admin-prompt-overrides','提示词覆盖版本','按触发点、岗位和阶段维护。'],
      ['admin-runtime-prompt','运行时系统提示词','管理员核查真实岗位提示词。'],['admin-prompt-call-evidence','调用提示词证据','查看资料包和脱敏失败证据。','current']], 'previous-production'),
  ...currentModule('admin-memberships','后台会员经营','admin','独立后台 → 会员',
    ['coauthoring-v7/admin-console/src/PlatformPages.tsx','apps/api/src/http/admin-console-routes.ts'],[
      ['admin-membership-grant-revoke','开通、续费与撤销','办理会员并维护有效期。'],['admin-membership-revenue','会员收入流水','记录实收、套餐和周期。'],
      ['admin-membership-expiry','到期提醒','查看即将到期和已过期会员。']], 'previous-production'),
  ...currentModule('context-retrieval','ContextCompiler 与检索','system','系统服务（作者不可见）',
    ['apps/api/src/application/memory/context-pack-service.ts','apps/api/src/application/memory/hybrid-retrieval-service.ts','apps/api/src/application/creation/planning-chain-context-service.ts'],[
      ['context-compiler','权威资料包编译','按节点编译最小充分资料包。'],['context-pack-freeze','资料包冻结','冻结 ID、哈希和来源。'],
      ['retrieval-evidence','证据检索与来源','检索并保留证据。'],['longform-continuity','长篇连续性','维护跨卷人物、伏笔和关系。']]),
  ...currentModule('task-runtime','任务运行与恢复','system','API / Worker',
    ['apps/api/src/application/tasks/task-service.ts','apps/api/src/application/calls/model-call-service.ts','apps/api/src/application/agents/ai-node-pipeline-service.ts'],[
      ['idempotent-tasks','幂等任务','重复请求不重复制造结果。'],['model-call-budget','预算预留与结算','按真实用量结算。'],
      ['worker-lease','Worker 租约','防止并发重复处理。'],['failure-classification','失败分类与恢复键','保存失败位置和恢复入口。']]),
  ...currentModule('data-safety','数据安全与可恢复性','system','系统门禁',
    ['apps/api/src/http/layered-creation-safety.ts','apps/api/src/application/portability/book-portability-service.ts','scripts/evaluation/production-backup-verify.ts'],[
      ['owner-book-isolation','账号与书籍隔离','核心读写携带 owner_id 和 book_id。'],['immutable-manuscripts','正文不可变完整版本','修改产生完整新版本。'],
      ['immutable-settlements','结算不可覆盖','已确认结算作为历史事实。'],['secret-env-only','密钥只在环境变量','密钥不进入业务数据和 Git。'],
      ['safe-delete','安全删除','归档优先，永久删除双确认。'],['portability-backup','备份与可携带性','验证备份恢复和数据包。']]),
  ...currentModule('production-operations','生产发布与健康','system','部署脚本 / 生产服务',
    ['docs/DEPLOY.md','apps/api/src/http/server.ts','scripts/start.mjs'],[
      ['api-health','API 健康检查','核查健康、首页、登录和接口。'],['atomic-web-release','Web 原子发布','保留旧哈希并原子切换。'],
      ['queue-safe-service-release','API/Worker 安全切换','在途任务连续为零后发布。'],['production-rollback','生产回滚版本','保留可快速回滚版本。']]),
  ...currentModule('feature-governance','功能资产守恒','admin','独立后台 → 功能台账',
    ['apps/api/src/application/admin/feature-capability-registry.ts','coauthoring-v7/admin-console/src/AssetAdminApp.tsx','scripts/quality/verify-feature-capability-registry.ts'],[
      ['capability-registry','全功能台账','按稳定 ID 登记模块、入口和证据。'],['version-comparison','历史版本对照','分类能力去向。'],
      ['capability-release-guard','功能守恒发布门禁','历史能力无去向时验证失败。'],['admin-capability-page','后台功能台账页面','查看所有模块和疑似遗失。']], 'current')
];

const H: FeatureCapabilityDefinition[] = [
  { id:'idea-capture',moduleId:'ideation',moduleName:'灵感',surface:'author',name:'灵感记录',description:'旧版独立灵感便签。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired','previous-production':'retired'},previousEntry:'灵感',
    decision:'不迁入 V7 首发版本；作者可在对应创作节点直接补充意见。' },
  { id:'idea-to-book-context',moduleId:'ideation',moduleName:'灵感',surface:'author',name:'灵感用于创作',description:'把旧灵感便签注入书籍上下文。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired','previous-production':'retired'},previousEntry:'灵感 → 用于本书',
    decision:'历史版本的书籍和资料不迁移，旧便签不进入 V7 资料包。' },
  { id:'book-export',moduleId:'settings-portability',moduleName:'设置与可携带性',surface:'author',name:'书籍导出',description:'旧版仅服务器本地可用的导出实现。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired','previous-production':'retired'},previousEntry:'设置 → 导出',
    decision:'旧实现不是浏览器可下载闭环，不迁入 V7；生产备份能力独立保留。' },
  { id:'book-import',moduleId:'settings-portability',moduleName:'设置与可携带性',surface:'author',name:'书籍导入',description:'旧版仅服务器本地可用的导入实现。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired','previous-production':'retired'},previousEntry:'设置 → 导入',
    decision:'历史版本创作结构与 V7 不兼容，旧数据包不导入 V7。' },
  { id:'writing-preferences',moduleId:'settings-portability',moduleName:'设置与可携带性',surface:'author',name:'创作偏好',description:'旧版页面级偏好设置。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired','previous-production':'retired'},previousEntry:'设置 → 创作偏好',
    decision:'不迁入首发版；V7 在具体创作节点记录作者选择。' },
  { id:'legacy-information-page',moduleId:'opening-profile',moduleName:'开书资料与接续',surface:'author',name:'独立信息页',description:'旧版独立一级信息页。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'relocated'},previousEntry:'信息页',
    replacement:'顶部书籍信息区 → 修改开书资料',decision:'资料编辑能力保留，只取消独立一级页面。' },
  { id:'legacy-planning-workspace-shell',moduleId:'planning-legacy',moduleName:'旧规划工作台',surface:'author',name:'旧规划总壳层',description:'旧版单一规划工作台。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'replaced'},previousEntry:'PlanningWorkspace',
    replacement:'设定、故事线、分卷、事件、章节五个工作区',decision:'由分层创作闭环完整替代，不保留双入口。' },
  { id:'legacy-team-workspace',moduleId:'editorial-team',moduleName:'AI 编辑部',surface:'author',name:'旧团队工作台',description:'旧版团队页面。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'replaced'},previousEntry:'TeamWorkspace',
    replacement:'EditorialTeamWorkspace',decision:'由 7 类固定岗位、22 名成员且按真实任务状态展示的团队页替代。' },
  { id:'legacy-fixed-15-member-roster',moduleId:'editorial-team',moduleName:'AI 编辑部',surface:'author',name:'固定 15 人成员表',description:'旧版写死 15 名成员。',currentAvailable:false,currentEntry:null,
    evidence:['apps/api/src/application/agents/team-template-service.ts'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'replaced'},previousEntry:'旧团队固定成员表',
    replacement:'7 类岗位、固定 22 名成员、后台可配置模型与状态',decision:'旧人数规则与最新决定冲突，已被替代。' },
  { id:'author-protected-role-prompt-viewer',moduleId:'admin-prompts',moduleName:'后台提示词',surface:'admin',name:'作者端岗位提示词查看',description:'旧团队页向作者显示完整内部岗位提示词。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/admin-console/src/PromptContextCenter.tsx','apps/api/src/http/v7-prompt-governance-routes.ts'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'relocated'},previousEntry:'团队 → 查看完整提示词',
    replacement:'独立后台 → 提示词 → 运行时系统提示词',decision:'内部提示词只对管理员开放，作者端不展示模型路由和内部提示。' },
  { id:'author-agent-prompt-preference-editor',moduleId:'editorial-team',moduleName:'AI 编辑部',surface:'author',name:'作者逐成员提示词偏好',description:'旧团队页允许直接改写成员内部提示。',currentAvailable:false,currentEntry:null,
    evidence:['coauthoring-v7/docs/worklists/V7-CUTOVER-20260830-66.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'retired'},previousEntry:'团队 → 成员提示词偏好',
    replacement:'作者节点输入与资料包；平台提示由独立后台版本化管理',decision:'作者只选择成员，不直接管理内部提示；历史数据和调用追溯保留。' },
  { id:'book-branding-title-design',moduleId:'opening-profile',moduleName:'开书资料与接续',surface:'author',name:'主编设计书名',description:'第一卷确认后生成多套书名候选并采用。',currentAvailable:false,currentEntry:null,
    evidence:['apps/api/src/application/books/book-branding-design-service.ts','apps/api/src/http/domain-routes.ts','docs/API.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'suspected_missing'},previousEntry:'信息页 → 书名 → 主编设计',
    decision:'后端、路由、数据模型和测试仍在，但当前作者端没有入口或客户端调用；没有明确下线决定。',impact:'作者无法使用已有的主编书名设计闭环。',
    recommendation:'确认位置后恢复到“修改开书资料”，复用现有后端。' },
  { id:'book-branding-synopsis-design',moduleId:'opening-profile',moduleName:'开书资料与接续',surface:'author',name:'主编设计书籍简介',description:'第一卷确认后生成多套简介候选并采用。',currentAvailable:false,currentEntry:null,
    evidence:['apps/api/src/application/books/book-branding-pipeline-service.ts','apps/api/src/http/domain-routes.ts','docs/USER_GUIDE.md'],introduced:'stable-baseline',statusOverrides:{'stable-baseline':'suspected_missing'},previousEntry:'信息页 → 书籍简介 → 主编设计',
    decision:'后端、路由、数据模型和测试仍在，但当前作者端没有入口或客户端调用；没有明确下线决定。',impact:'作者无法使用已有的主编简介设计闭环。',
    recommendation:'确认位置后恢复到“修改开书资料”，复用现有后端。' }
];

C.find((item) => item.id === 'book-profile-edit')!.statusOverrides = { 'stable-baseline': 'relocated' };
Object.assign(C.find((item) => item.id === 'book-profile-edit')!, {
  previousEntry: '独立信息页', replacement: '顶部书籍信息区 → 修改开书资料',
  decision: '编辑能力保留并迁移，取消独立一级页面。'
});

export const FEATURE_CAPABILITIES: FeatureCapabilityDefinition[] = [...C, ...H];
export const FEATURE_BASELINE_SNAPSHOTS: Record<FeatureBaselineKey, readonly string[]> = {
  'previous-production': [
    ...C.filter((item) => item.introduced !== 'current').map((item) => item.id),
    ...H.filter((item) => item.statusOverrides?.['previous-production'] !== undefined).map((item) => item.id)
  ],
  'stable-baseline': [...C.filter((item) => item.introduced === 'stable-baseline').map((item) => item.id), ...H.map((item) => item.id)]
};

const STATUS_LABELS: Record<FeatureCapabilityStatus,string> = {
  added:'新增',retained:'保留',relocated:'迁移',replaced:'替代',retired:'明确下线',suspected_missing:'疑似遗失'
};
const SURFACE_LABELS: Record<FeatureSurface,string> = { author:'作者端',admin:'独立后台',system:'系统能力' };
const INTRO_ORDER: Record<FeatureIntroduction,number> = {'stable-baseline':0,'previous-production':1,current:2};
const BASE_ORDER: Record<FeatureBaselineKey,number> = {'stable-baseline':0,'previous-production':1};

export function isFeatureBaselineKey(value: unknown): value is FeatureBaselineKey {
  return FEATURE_BASELINES.some((item) => item.key === value);
}
export function isFeatureCapabilityStatus(value: unknown): value is FeatureCapabilityStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS,value);
}
export function buildFeatureCapabilityView(input: { baseline?: FeatureBaselineKey; status?: FeatureCapabilityStatus; moduleId?: string; query?: string } = {}) {
  const baseline = input.baseline ?? 'stable-baseline';
  const query = input.query?.trim().toLocaleLowerCase('zh-CN') ?? '';
  const compared = FEATURE_CAPABILITIES.flatMap((definition): FeatureCapabilityRecord[] => {
    const status = capabilityStatus(definition,baseline);
    if (status === null) return [];
    return [{
      id:definition.id,moduleId:definition.moduleId,moduleName:definition.moduleName,surface:definition.surface,
      name:definition.name,description:definition.description,status,currentAvailable:definition.currentAvailable,
      currentEntry:definition.currentEntry,evidence:definition.evidence,
      ...(definition.previousEntry === undefined ? {} : {previousEntry:definition.previousEntry}),
      ...(definition.replacement === undefined ? {} : {replacement:definition.replacement}),
      ...(definition.decision === undefined ? {} : {decision:definition.decision}),
      ...(definition.impact === undefined ? {} : {impact:definition.impact}),
      ...(definition.recommendation === undefined ? {} : {recommendation:definition.recommendation})
    }];
  });
  const moduleOptions = uniqueModules(compared);
  const filtered = compared.filter((item) => {
    if (input.status !== undefined && item.status !== input.status) return false;
    if (input.moduleId !== undefined && input.moduleId !== '' && item.moduleId !== input.moduleId) return false;
    if (query === '') return true;
    return [item.id,item.moduleName,item.name,item.description,item.currentEntry ?? '',item.previousEntry ?? '',
      item.replacement ?? '',item.decision ?? '',item.impact ?? '',item.recommendation ?? '',...item.evidence]
      .join(' ').toLocaleLowerCase('zh-CN').includes(query);
  });
  const modules = uniqueModules(filtered).map((module) => ({
    ...module,capabilities:filtered.filter((item) => item.moduleId === module.id)
  }));
  return {
    registry:{version:'feature-capability-registry-v1',updatedAt:'2026-08-23',current:{label:'当前代码与生产候选',revision:'workspace-current'},
      baseline:FEATURE_BASELINES.find((item) => item.key === baseline)!,availableBaselines:FEATURE_BASELINES,statusLabels:STATUS_LABELS,surfaceLabels:SURFACE_LABELS},
    summary:{...statusSummary(compared),filteredCapabilities:filtered.length},moduleOptions,modules,
    losses:compared.filter((item) => item.status === 'suspected_missing')
  };
}
export function validateFeatureCapabilityRegistry(fileExists?: (path: string) => boolean): string[] {
  const errors:string[]=[]; const byId=new Map<string,FeatureCapabilityDefinition>();
  for (const item of FEATURE_CAPABILITIES) {
    if (byId.has(item.id)) errors.push('重复能力 ID：'+item.id); byId.set(item.id,item);
    if (item.moduleId.trim()==='' || item.moduleName.trim()==='') errors.push('能力缺少模块：'+item.id);
    if (item.currentAvailable && !item.currentEntry?.trim()) errors.push('当前能力缺少入口：'+item.id);
    if (item.evidence.length===0) errors.push('能力缺少代码证据：'+item.id);
    if (!item.currentAvailable && !item.decision?.trim()) errors.push('历史能力缺少去向决定：'+item.id);
    if (item.statusOverrides?.['stable-baseline']==='suspected_missing' && (!item.impact?.trim() || !item.recommendation?.trim()))
      errors.push('疑似遗失缺少影响或建议：'+item.id);
    if (fileExists) for (const evidence of item.evidence) if (!fileExists(evidence)) errors.push('代码证据不存在：'+item.id+' → '+evidence);
  }
  for (const baseline of FEATURE_BASELINES) {
    const seen=new Set<string>();
    for (const id of FEATURE_BASELINE_SNAPSHOTS[baseline.key]) {
      if (seen.has(id)) errors.push('基线快照重复能力：'+baseline.key+' → '+id); seen.add(id);
      const item=byId.get(id);
      if (!item) errors.push('历史能力无当前登记或去向：'+baseline.key+' → '+id);
      else if (capabilityStatus(item,baseline.key)===null) errors.push('历史能力没有比较状态：'+baseline.key+' → '+id);
    }
  }
  return errors;
}
function capabilityStatus(item: FeatureCapabilityDefinition,baseline: FeatureBaselineKey): FeatureCapabilityStatus|null {
  const override=item.statusOverrides?.[baseline]; if (override) return override;
  if (!item.currentAvailable) return null;
  return INTRO_ORDER[item.introduced] > BASE_ORDER[baseline] ? 'added' : 'retained';
}
function uniqueModules(items: FeatureCapabilityRecord[]) {
  const map=new Map<string,{id:string;name:string;surface:FeatureSurface}>();
  for (const item of items) if (!map.has(item.moduleId)) map.set(item.moduleId,{id:item.moduleId,name:item.moduleName,surface:item.surface});
  return [...map.values()];
}
function statusSummary(items: FeatureCapabilityRecord[]) {
  const statuses:Record<FeatureCapabilityStatus,number>={added:0,retained:0,relocated:0,replaced:0,retired:0,suspected_missing:0};
  for (const item of items) statuses[item.status]+=1;
  return {modules:uniqueModules(items).length,capabilities:items.length,currentAvailable:items.filter((item)=>item.currentAvailable).length,statuses};
}
