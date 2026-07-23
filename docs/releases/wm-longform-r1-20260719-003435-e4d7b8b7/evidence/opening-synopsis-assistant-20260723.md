# 剧情梗概识别与开书布局验收证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260723-02`
- 功能提交：`266a082`
- 验收日期：2026-07-23
- 数据Schema：25（本任务无迁移）

## 交付范围

- 开书左列由单张分类卡改为“书籍与分类＋剧情梗概快速识别”纵向栈，右列保留初始主角，后续故事与标签区继续跨两列。
- 剧情梗概输入上限5000字符，显示实时计数；小文秘书使用无状态本地确定性识别返回可修改候选。
- 结构化标题、自由文本姓名/年龄、版本化分类和标签可识别；歧义字段保持未识别。
- 回填只填空字段，用户已有内容优先；标签去重并遵守现有上限。
- 超过正式字段上限的书名或主角背景不回填、不静默截断。
- 分析失败可重试且不阻断手工开书；扫描不保存原始梗概，不写草稿、书籍、聊天、正史、向量、任务、预算或模型调用记录。

## 自动测试与构建

- `npm.cmd test -- tests/foundation/opening-synopsis-analysis.test.ts tests/integration/domain/api-flow.test.ts tests/integration/experience/workspace-ui.test.tsx`
  - 3个文件、29项通过（超长字段保护加入前的专项基线）。
- `npm.cmd test -- tests/foundation/opening-synopsis-analysis.test.ts tests/contract/application-database-boundary.test.ts`
  - 2个文件、6项通过；包含5000字符上限、5001拒绝、超长正式字段不回填和应用层无SQL。
- `npm.cmd run verify`
  - 类型检查：API、Web、Worker与测试类型全部通过。
  - 自动测试：118个文件、365项全部通过。
  - 生产构建：API、Web、Worker全部成功；Web产物生成。
- `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/OPENING_SYNOPSIS_ASSISTANT_AUDIT.md`
  - `PASS`。
- `git diff --check` 与 `git diff --cached --check`
  - 退出码0，无空白错误。

## 迁移、隔离与恢复

- `npm.cmd run migrate` 连续执行两次：
  - `currentVersion: 25`
  - `applied: []`
- `node scripts/evaluation/book-creation-e2e-smoke.mjs`
  - `smoke: passed`
  - 创建2本隔离测试书，拒绝4类非法输入。
  - 22个创作Agent、2个主编开场任务。
  - `canonRevisionSum: 0`
  - `foreignKeyViolations: 0`
- `npm.cmd run verify:backup`
  - 备份ID：`backup-2026-07-23T06-49-35-780Z-2402816a`
  - 文件数：74
  - 生产库完整性：`ok`
  - 隔离恢复：已验证并销毁副本
  - 外键违规：0
- `node -e "process.env.WENMI_RUNTIME_SMOKE='1'; import('./scripts/start.mjs')"`
  - Web：ready
  - API会话：HTTP-only cookie
  - Worker：ready
  - SQLite FTS5：true
  - 本地向量检索：available

## 正式验收

- 首次提交前运行 `npm.cmd run acceptance`：
  - 3个验收测试通过；
  - 审计唯一失败为工作树包含本任务待提交文件，未冒充最终通过。
- 功能提交 `266a082` 后再次运行 `npm.cmd run acceptance`：
  - 3个验收测试全部通过；
  - 工作树干净；
  - 产品名称、桌面入口、使用说明、Schema、密钥扫描、智囊团隔离均通过；
  - `failures: []`。

## 证据边界

- 本任务证明确定性候选识别、布局合同、无副作用、故障降级及工程门禁达到E2。
- 没有调用真实模型或消耗套餐Token；不声称模型语义理解能力。
- 没有真实作者多体裁盲评，因此不声称E3识别准确率或文学质量提升。
- 未修改、停止或重启 `D:\AI智囊团`。
