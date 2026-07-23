# 创建书籍可靠性验收证据

- release_id：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 日期：2026-07-23
- 范围：创建书籍表单、开书草稿、确认事务、初始资料、团队和主编主动开场任务
- 执行者：当前Codex；未调用其他开发Agent
- 模型与费用：确定性模式；未调用真实模型；现金费用为0
- 数据边界：端到端书籍仅写入系统临时目录，验证结束后安全清理；未向老板当前书架写入测试书

## 发现并修复的缺陷

陈旧的草稿版本调用确认接口时，`BookOnboardingService` 抛出普通 `Error`，被全局错误处理器归类为500和通用内部错误。数据库事务没有留下半本书，但界面无法获得正确的冲突语义。

修复后：

- 陈旧版本返回HTTP 409、`BOOK_VERSION_CONFLICT`、`retryable: true`，并报告期望版本与实际版本；
- 已确认草稿再次提交返回HTTP 409、`BOOK_STATUS_CONFLICT`，不重复创建书籍；
- 陈旧确认失败后仍能用正确版本继续确认；
- 错误确认前后均不会留下半本书、半套Agent或正史污染。

## 自动验证

### 开书目标集

命令：

`npm.cmd test -- tests/integration/domain/api-flow.test.ts tests/integration/domain/positioning-onboarding.test.ts tests/integration/experience/workspace-ui.test.tsx tests/foundation/opening-taxonomy.test.ts`

结果：4个测试文件、30项测试全部通过。覆盖：

- 男女频和频道分类联动；
- 书名、主角资料、世界/开篇背景、第一阶段三段剧情、全书简介、初始地图；
- 主要标签、全书特点、自定义标签、四组24项“必须遵守”；
- 缺失书名、超长书名、跨频道分类、边界数量超限；
- 陈旧版本冲突、正确版本重试、重复确认；
- 创建事务任意阶段失败回滚；
- 11名创作成员、主角候选、不可变开书蓝图和主编真实开场任务；
- 内部开场触发不伪装成老板可见消息；
- 表单无障碍检查。

### 隔离进程端到端

命令：`node scripts/evaluation/book-creation-e2e-smoke.mjs`

结果：

```json
{"smoke":"passed","schemaVersion":25,"validBooksCreated":2,"rejectedInputs":4,"boundaryGroups":4,"boundaryOptions":24,"books":2,"blueprints":2,"protagonists":2,"agents":22,"kickoffTasks":2,"internalTriggers":2,"staleTitleBooks":0,"canonRevisionSum":0,"foreignKeyViolations":0}
```

该验证启动真实构建产物API、建立本机会话、分别创建完整男频和女频书、直接核对SQLite，并在退出时删除隔离数据。

### 完整工程门禁

- `npm.cmd run verify`：三端TypeScript检查通过；117个测试文件、357项测试全部通过；API、Web、Worker生产构建通过。
- `npm.cmd run migrate`：正式库当前Schema 25，`applied: []`。
- `npm.cmd run verify:backup`：生产库完整性`ok`、外键违规0；备份 `backup-2026-07-23T06-04-50-558Z-e477b399` 在隔离目录恢复验证通过，恢复副本随后销毁。
- 功能提交：`c6a35ca`（`fix: harden book creation confirmation`）。
- `npm.cmd run acceptance`：功能提交后验收测试3/3通过，完整审计 `failures: []`，工作树干净。
- 最新生产构建运行：Web返回200，API状态`ok`且release_id匹配，Worker状态`ready`，最新错误日志为空。

## 结论

创建书籍路径未发现其余已知阻断问题。当前证据证明被覆盖的创建、拒绝、冲突、重试、重复提交、回滚和数据完整性场景均符合规格；它不宣称任何软件在所有未知环境中具有数学意义上的绝对零缺陷。
