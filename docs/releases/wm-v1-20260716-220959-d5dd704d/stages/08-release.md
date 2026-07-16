# 阶段8：全量验收与本地发布记录

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 目标：逐条完成 `docs/ACCEPTANCE.md`，执行跨阶段回归、两书五章、中断接管、版权、预算、稳定性、恢复、桌面入口和本地发布。
- 不做什么：不使用真实付费模型，不要求密钥，不推送远程，不执行生产恢复或永久删除，不触碰 `D:\AI智囊团`，不声称具备第二物理位置灾备。
- 唯一写负责人：当前Codex。
- 允许文件：全项目当前规格与实现、阶段8测试、桌面启动入口和发布文档。
- 禁止文件：项目外目录、来源快照、真实API Key、AI智囊团服务、未经确认的现金/永久删除/生产恢复操作。
- 依赖：阶段7提交 `b41d603`、Schema 7；阶段8实现提交 `fdfcb8a`。
- 实现约束：保持本地模块化单体+独立Worker；核心数据由API服务门禁；迁移只向前；正文不可变；全部状态来自持久事件；所有安全门禁默认拒绝。
- 验收标准：`docs/ACCEPTANCE.md` 所有条目有可复核证据，无 blocker/major，无未说明占位功能。
- 测试命令：`npm run verify`、`npm run test:coverage`、`npm run migrate`、`npm run acceptance`、桌面启动/停止实机探针。
- 失败停止条件：任何测试/构建/迁移/运行失败，跨书泄漏，版权绕过，取消未下传，恢复哈希不一致，端口越界，未说明假功能或密钥痕迹。
- 回滚方法：Git向前修复；数据库仅向前迁移；正文与备份保留不可变版本；桌面启动失败自动精准停止本项目进程。
- 独立复核人：当前Codex以 `CODE_REVIEW.md` 的证据化第二遍复核执行；根据老板规则未调用其他开发Agent。

## 交付实现

- 增加两书全链路验收：主书连续5章、第二章后中断、第3章前双主编接管、D级待决、旧epoch拒绝、第二书独立创作、文件/哈希隔离、投影重建、备份和干净恢复。
- 版权门禁补齐换名近写、跨语种事件链、多来源拼接、生成前干净室包和生成后全来源自动检查。
- 自然语言讨论形成真实Worker闭环：按问题激活相关岗位、两次确定性模型调用、不可变上下文、预算、真实意见、主编汇总和完整方案ID确认。
- 模型来源增加配置快照、适配器和返回值三重一致校验；同模型岗位仍如实显示共同来源。
- 新增受限HTTP和无shell子进程工具适配器，任务取消向下传播到真实Abort/进程终止，调用账本保留interrupted。
- 预算70%事件保存剩余Token/现金和确定性降级预测；100%继续由原子冻结拒绝新调用。
- 接管包补齐章节、正文指针和确认范围/影响；工作台直接展示重大确认并提供明确接受/拒绝。
- 消息API使用最多500条的稳定游标窗口，界面只挂载最近200条并显示数据库全量历史数。
- 补齐归档、恢复、严格永久删除、任务审计、预算用量、备份和隔离恢复验证REST入口，API文档只列已注册契约。
- 增加桌面启动/停止入口：启动校验release_id、品牌Web、API和Worker；停止前验证完整进程树，只终止本项目登记进程。

## 验收证据

| 门禁 | 命令/检查 | 结果 |
|---|---|---|
| 类型/测试/构建 | `npm run verify` | API/Web/Worker/测试类型通过；52文件、96测试通过；三应用生产构建通过 |
| 覆盖率 | `npm run test:coverage` | statements 80.19%、branches 67.64%、functions 76.88%、lines 85.42% |
| Web产物 | `npm run build` | JS 273.77 kB（gzip 82.90 kB）；CSS 19.37 kB（gzip 4.69 kB） |
| 生产迁移 | 两次 `npm run migrate` | `currentVersion:7`，两次 `applied:[]`，已执行迁移未修改 |
| 两书五章 | `release-journey.test.ts` | 主书5章、第二书1章；每章2500—3500字；消息/记忆/FTS/文件/模型上下文零串线 |
| 中断与接管 | 同上 | 第2章后暂停；第3章前接管；待决在包内；旧epoch拒绝；从第3章继续 |
| 真实恢复 | 同上及`backup-restore.test.ts` | manifest/哈希、integrity、外键、正史修订和正史正文数量一致 |
| 24小时逻辑稳定性 | `worker-logical-soak.test.ts` | 1440个一分钟周期、24个小时探针全部成功；无僵尸/暂存；堆增长<32MiB |
| 真实Worker进程 | `worker-process-liveness.test.ts`、`worker-execution.test.ts` | 空闲驻留/心跳前进；经HTTP完成正式章节流水线 |
| 讨论运行闭环 | `discussion-runtime.test.ts` | 两岗位、两调用、两上下文包、0现金、主编汇总、明确确认、专家收口 |
| 取消下传 | `tool-calls.test.ts`、`model-calls.test.ts` | HTTP Abort、子进程终止、任务取消向下传播、interrupted保留 |
| 版权全门禁 | `copyright-cleanroom.test.ts` | 预检、后检、换名、翻译、拼接、事件链、授权全部通过 |
| 长对话与UI | `message-pagination.test.ts`、`workspace-ui.test.tsx` | 游标历史、全量计数、DOM 200窗口、三千字正文、axe零违规 |
| 运维API | `operations-api.test.ts` | 乐观版本归档/恢复、任务审计、备份/验证、模糊删除409 |
| 代码复核 | `CODE_REVIEW.md` | 发现项全部修复；Critical 0、Important 0、未阻塞Minor 0 |

## 项目经理签署

当前Codex以项目经理复核角色，基于实现提交 `fdfcb8a`、本阶段证据、`ACCEPTANCE_MATRIX.md`、完整测试和本地运行结果，签署首版通过。签署不改变以下明确边界：真实外部模型质量尚未启用、未配置第二物理备份、未配置Git远程，24小时稳定性为确定性逻辑时钟覆盖而非24小时墙钟等待。
