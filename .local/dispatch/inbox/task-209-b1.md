# R209-B1：编号、版本存储与精确读取底座

待老板手动触发；执行者GLM5.3。A已通过限定验收，B分为B1底座、B2后台与发布管理。本次只执行B1，不自动执行B2、C、D、E、F。完成不等于新库已上线。

## 1. 基准与隔离

业务/规格基准：327900d6b423fa22c4775ef1e90a940cdb53d4f4。后续派工文档提交不要求回退。
工作树：D:\wenmixiezuo\.local\dispatch\worktrees\task-209-b1
分支：codex/dispatch-task-209-b1
开始前检查主工作区与同名工作树；不存在时用上述commit创建独立worktree。已存在不得覆盖/reset。产品改动只在工作树，报告在主目录outbox。

先读根AGENTS、HANDOFF最新状态、R209总规格第8/11/18/19节、A验收记录。源码路径名v7/rebuild不决定是否活跃，以实际导入链为准。不得修改产品目标、分类或引入另一套后端。

## 2. 精确写入白名单（相对于隔离工作树）

- apps/api/src/application/creative-reference/**：新类型、纯验证/投影、Repository接口与应用服务。
- apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts：SQLite适配。
- apps/api/src/infrastructure/db/migrations/0122_creative_reference.sql：新增兼容迁移；开工若0122已占用，报告冲突，不改占用文件或猜下一号。
- tests/unit/creative-reference-*.test.ts、tests/fixtures/creative-reference/**：合成样例与测试。

主目录只可写.local/dispatch/outbox/task-209-b1.result.md及.local/dispatch/outbox/task-209-b1/**证据。
禁止修改既有迁移、迁移执行器、根依赖/锁文件、路由注册、UI、模型名单、既有资产正文、开书/时光机业务和提示词、任务队列、生产脚本。新模块暂不挂HTTP/生成入口。报告建议不等于可越界实施。

## 3. 必须实现

### B1-1 稳定编号与原标识兼容
法用于现有方法实体，参用于创作参考实体。本批沿用已存在方法key及创意G/C/W/H/R/V id作legacy映射，不根据assetType重新将剧情样式拆成另一套参号。两种实体的全局displayCode分别递增，至少三位显示；改名/排序/换分类不改号，退役不回收。不能用数组下标当永久编号。
内部主键与displayCode分开；legacy引用含来源命名空间、旧key、旧版本。编号分配与卡创建在事务中，带幂等请求键；同键异内容报冲突。数据库约束保证唯一，不只靠内存锁或模型发号。缺号可接受，重号不可接受。
complete-v3/audited-v4同实体别名的映射本批用已核对合成样例验证，未经逐条审定不自动合并全部实库。仅提供明确映射的导入服务，不自动导入生产种子。

### B1-2 版本与发布快照
按总规格建设cards、revisions、relations、releases所需最小表及索引；本批不创建模型评测/书籍事实/新任务表。新增表只能保存库资产，不能复制作者数据。
状态区分draft/reviewed/published/retired；已发布版本不可覆盖，修改创建新revision。更新以expectedVersion避免丢改。发布release原子完成，验证引用有效，保存不可变清单/hash及active指针；失败回滚所有改动。只读旧release保留原内容，退役不使已冻结引用失效。相关实现通过内部服务测试，本批没有对外发布API。
写操作由服务要求明确管理者上下文及actor标识，禁止可伪造的HTTP参数示例或默认管理员。授权端口用测试替身验证允许/拒绝；B2再接现有鉴权。库是全局编辑资产，不为它错误添加书籍归属；未来成员读取只可获取任务冻结release内允许的已发布内容。

### B1-3 精确查询与三档投影
支持真实id、displayCode、明确legacy key/alias及指定revision或release精确读取。默认成员读取必须传冻结release，不默默读最新；无编号返回not-found，别名有歧义返回ambiguity，不能近似替换。旧版/退役状态可追溯。
管理列表支持用途/层级/状态过滤与稳定分页；冻结release分页不得因中途发布变动，cursor须绑定查询条件。层级多选只是适用信息，不复制实体。
投影分引用、短目录、详情，保留短语和影响含义的条件；不按字符位置直接截正文。shortPhrase/summary来自审核内容，B1不调用AI写短语。提供准确Unicode字符计量（不是UTF16 code unit），超预算返回明确信息让上层缩请求，不静默丢关键约束；本批不改既有15,000调度实现。
统一包装assetKind=method/reference；reference内容沿第8节合同，method保留现有含义字段并通过适配投影，不将旧key重命名为书内主线ID。不引入语义/向量重排、网络查询或“相似即同义”逻辑。

### B1-4 分层边界与迁移
应用模块不直接依赖SQLite/HTTP/旧书籍对象；SQLite实现Repository接口。复用当前node:sqlite与迁移方式，不另建数据库服务。迁移仅增加新表/索引，无历史表UPDATE/DELETE/触发作者任务。
测试真实执行现有迁移器并验证重复执行安全，不能只手工create table后声称迁移通过。只在内存或工作树证据目录的合成数据库运行，不启动生产migrate命令。

## 4. 验收与执行证据

至少覆盖：
- 并发/竞争创建及幂等重复、同键不同内容；法/参编号唯一，重命名/退役不变。
- 两个连接竞争同数据库的版本更新，expectedVersion正确冲突，不以顺序调用冒充并发测试。
- 发布后不可变、快照历史可读、发布过程中故障回滚；新release不改变旧读取。
- 管理权限拒绝、成员读草稿/未知release拒绝；空结果/歧义别名/不存在编号不能误匹配。
- legacy映射多视图一致；不同含义不因同名合并。
- 过滤/分页边界及cursor条件改变；跨层不复制卡。
- 中文与emoji字符计量、三档投影、超预算不截断。
- 真实迁移器初次及重入，既有合成表数据不变。

只运行相关测试、API类型检查及必要构建；从本worktree启动，证明实际解析的是本次源码，不能共享node_modules链接回主目录后假通过。不得安装新依赖或更改共享node_modules；无法安全运行时报告原因，保留已完成结果。
测试命令按现有工具实测后完整写入报告；失败不删断言，不换无断言脚本宣称通过。报告列测试文件、每项规格对应位置、实际退出码、未验证项、完整diff文件清单、迁移影响。SQL/接口可验收不等于语义质量验证。

## 5. 提交和停止

允许在指定隔离分支提交本批白名单文件，提交前审完整diff。禁止推送、合入、部署、读取.env/私有作品、调模型、自动启动下一批。报告记录真实base/result commit，说明未接路由/UI/生成流程，B2仍待派单。
发现规格冲突或必须改白名单外公共合同，先记录位置/原因/最小建议，继续独立部分；不擅自设计替代架构。完成后只告诉老板“B1完成，等待Codex验收”，附报告路径。
