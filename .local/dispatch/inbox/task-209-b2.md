# R209-B2：创作库后台管理闭环

状态：可由老板手动触发。执行者GLM5.3；Codex验收与合入。只执行本文件，不领取C/D/E/F，不推送、不部署、不调用模型。

## 1. 接管与边界

基准提交：`e4c867f6b0cc11bab2e28f4ddec63501c5d0a48c`，已包含B1合并9f6f0d6c、最终实现eaf0361d。之后主目录的派工文档提交不影响此代码基准，不回退主目录。
隔离分支：`codex/dispatch-task-209-b2`；隔离目录：`D:\wenmixiezuo\.local\dispatch\worktrees\task-209-b2`。不存在才创建；已存在先检查，不reset/覆盖。允许只在该分支提交白名单内容；主目录产品零修改。结果写主目录`.local/dispatch/outbox/task-209-b2.result.md`，证据在`outbox/task-209-b2/`。不得移动、删除、归档任何inbox任务书。

先从主目录只读最新根AGENTS、HANDOFF、开发流程/验收标准相关小节，以及总规格`coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md`第8、12、18、19、20节和B1验收报告。固定基准只用于代码隔离，晚于基准的本任务与第20节仍有效；在隔离副本更新第20节时仅补入该节及本批实际记录，不覆盖整个主目录规格。本批具体执行以本文件为准；工程细化可在范围内决定，不能自行更改产品目标。问题先查证，可独立部分继续；确需越界时报告最小依赖，不另造替代系统。

目标：管理员在真实挂载的现有后台，通过真实API完成查询→建草稿→修改→审核→发布完整库版本→查看旧版。B1提供存储，本批完成管理闭环；不承诺创作内容已齐全或AI已使用。

## 2. 允许修改的文件

- `apps/api/src/application/creative-reference/**`：必要应用服务、DTO、校验和仓储接口增量，保留B1语义。
- `apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts`。
- 新增`apps/api/src/http/creative-reference-admin-routes.ts`；`apps/api/src/http/v7-server.ts`仅导入/注册本路由，复用现有database/config。
- 仅必要时新增`apps/api/src/infrastructure/db/migrations/0123_creative_reference_admin_audit.sql`：下述管理操作审计和幂等补充。不编辑已合并0122或其他迁移。若0123已被他人占用，停止迁移部分并报告，不覆盖。
- 后台新增`coauthoring-v7/admin-console/src/CreativeReferenceLibrary.tsx`、同名`.test.tsx`、`creative-reference-api.ts`、`creative-reference-api.test.ts`、`creative-reference-library.css`。
- `AssetAdminApp.tsx`及其测试：仅新增库入口、URL解析与挂载；`platform-api.ts`仅按需导出已有platformRequest和共享错误类型，不能重写身份/请求体系。
- `tests/unit/creative-reference-*.test.ts`、`tests/fixtures/creative-reference/**`、新增`tests/integration/security/creative-reference-admin.test.ts`。
- `apps/api/src/application/admin/v7-feature-capability-registry.ts`、`coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md`：只记录本批真实能力/证据，不改其他功能。先核对路线读取的数据源；若该registry不供给相应栏目，报告准确缺口，不写死假卡片。

禁止修改作者端、worker、模型网关、开书/设定/故事线/基线生成、提示词、旧资产正文、其他页面样式、package/锁文件。无新依赖、无向量服务、无定时任务、无全量导入、无语义去重、无删除资产。现有128/341资产仍留原入口与供给，切换由后续批次处理。

## 3. 技术路线与权限

现有后台会话→`requireAdministrator(request)`→CreativeReferenceService→Repository→现有SQLite。参考`v7-admin-console-routes.ts`和安全集成测试，不新增登录或数据库。
所有读写均检查管理员身份；actorId只能来自验证后的`account.userId`，时间来自服务器，客户端actor/role/时间不得赋权。应用服务继续校验授权，不能新增无校验的发布捷径。复用现有跨站请求防护、响应success/error封装，管理接口no-store。
前端复用platformRequest，不导入服务器运行代码/SQLite。可用type-only合同，但构建不得将Node模块打进浏览器。所有数据库写入参数化，分类、枚举、字符串、数组、页大小由后端校验，错误不泄漏SQL/堆栈。

## 4. 页面与交互（固定本批边界）

在资产方法论现有页签增加“创作库”，URL沿现有section机制使用`creative-reference`。库内切换“方法”“创作参考”；原分层方法/创意与金手指等入口保持可访问。本批新库空时明确“尚未录入”，不注入假种子或把旧库数量算入新库。

桌面：顶部紧凑工具条，左侧用途筛选约180–220px，列表占剩余空间；点条目进入详情/编辑，可返回且保留筛选。手机390px：筛选折叠，列表与详情分开显示；不横向挤压多列。保持现有绿色风格，CSS以本组件类名前缀隔离，按钮约44px触控区。不得重做全站导航/主题。

用途树采用总规格18.3的八个主类及其已列子类，不另建九类：题材与融合、卖点与阅读体验、人物与关系、故事与因果、结构与节奏、信息与表达、衔接与收束、审查与修订。第12节旧“九种用途”按18.3修正。用途与层级是多维适用信息，同卡不因多层复制。引用类facets.purposes支持多用途，方法usageTree暂为单路径，不擅自改变schema。

工具条：编号/名称/短语搜索、用途、适用层级、状态、重置。创作参考再提供题材/机制/体验筛选。列表每页默认20，最大100，显示编号+短语、名称、简短介绍、内容版本状态及是否已退役；不放全库勾选框。筛选必须服务端生效，不只筛当前页。精确编号无结果就无结果，不近似替代；普通文字查询是词法匹配，不显示语义分数。枚举来源和中文标签集中维护，允许合法旧分类保留显示，不能静默抹掉。

详情：基本内容、适用条件/限制、原始依据及局限、关联条目、版本记录。reference/method分类型表单覆盖现有payload全部字段；高级信息折叠，不能只用JSON大框替代。名称、短语、简介区别说明简短。关联显示编号+短语，内部提交id+revision；不让管理员猜UUID。版本对比展示字段改动前后，不能仅比较hash。

编辑只保存草稿，用expectedRevision；保存失败/409保留本地输入，提示刷新对比，禁止自动覆盖重试。草稿保存成功不自动审核/发布。审核按钮表示人工审核，不冒充AI；可填简短审核意见，记录实际管理员与时间，不强制不同管理员账号。修改审核过/发布过的内容生成新草稿并重新审核。

退役只影响后续选择，历史版本可读；界面不得把setAvailability暴露成任意“设为已发布”按钮。恢复退役需显式操作，不能修改就自动恢复。恢复后的发布仍通过正常审核/快照校验。

加载、无数据、无结果、错误重试、保存中、版本冲突、发布中均真实显示；请求返回乱序不能覆盖新选择。离开未保存表单提示一次，成功保存后不反复提示。不能用toast“成功”替代服务器确认。

## 5. 接口合同

统一前缀`/api/v1/admin/creative-reference`。字段复用B1，不改变既有ID含义。新增接口如下，均有鉴权与运行时校验：

| 方法/路径 | 行为 |
| --- | --- |
| GET /cards | 类型/关键词/用途/层级/状态及reference facets组合筛选，绑定全部筛选的cursor，items包含当前revision摘要，nextCursor；页大小1–100 |
| GET /lookup | 明确by=displayCode或legacy参数精确定位；不存在404，歧义返回结构化候选不能擅选 |
| GET /cards/:id | 当前详情、可追溯别名；未知404 |
| POST /cards | payload+创建幂等键；编号服务器分配；重复同请求只建一条 |
| POST /cards/:id/revisions | payload+expectedRevision，新增草稿；冲突409 |
| GET /cards/:id/revisions | 有界分页版本摘要；具体版本GET /cards/:id/revisions/:revision |
| POST /cards/:id/review | expectedRevision+意见；只审核该版，意见与审核结果同事务留痕 |
| POST /cards/:id/availability | 仅退役或显式恢复，携带所见版本/状态用于防并发覆盖；记录原因和操作者 |
| GET /releases | 分页历史release摘要，标明active；GET /releases/:id读取冻结清单/关系，条目使用B1绑定release分页 |
| POST /releases | 完整entries+relations+expectedActiveReleaseId+幂等键，成功原子发布；服务端不从当前过滤结果猜清单 |

active无版本时返回明确null，可在releases列表响应一并提供activeReleaseId。错误统一400非法输入、401未登录、403非管理、404不存在、409版本/幂等/引用冲突；数据库锁忙用可重试503，不能报成成功。
HTTP cursor拒绝畸形、缺字段、跨筛选、跨release，编码不是安全验证。B1管理列表仅有CardRecord，允许扩展仓储查询/投影补摘要和上述筛选，不在浏览器加载全库补筛选。

B1欠缺的历史列表、审核意见、操作审计和发布幂等仅在本批模块补充：可新增0123管理审计/请求记录表，记录动作、目标id/revision、实际actor、时间、简短意见、结果引用；不存密钥/用户作品/思维链。成功写入与审计同事务；幂等键绑定动作/请求摘要，异内容409。请求结果未知时同键重试不得多建release。审核记录不可覆盖旧记录。

## 6. 发布必须满足的规则

页面显式进入“发布版本”：读取当前active完整清单，管理员选择加入已审核版本、替换指定版本或明确移除条目；保留未调整的原条目与关系。初次无active从空开始。勾选仅用于这一步选发布条目，不是“方法必须执行”。预览完整数量、增删改编号、关联变化，确认后发送完整manifest。
严禁把当前搜索页20条当全库覆盖。不默认发布全部草稿，不自动纳入所有最新revision。移除被关联目标须同时处理关系；悬空关系/未审核版/退役卡拒绝，不能偷偷删边。未改的published版本可沿用；新draft须审核。B1若已满足不重写。
发布用打开预览时的expectedActiveReleaseId；冲突保留编辑意图并重新比较，不自动拿最新值重发。双击/超时重试幂等。旧release清单与对应内容可读不变。
“库已发布”表示可供后续接入读取，页面同时明确“AI检索接入待后续批次”；不得声称当前开书已使用新库。不提供生产模型探针或生成按钮。

## 7. 文档与当前供给

更新总规格20节本批状态和证据入口，后台相应功能档案记录：GLM实施、Codex待验收、已完成范围、未接AI/未导入全部内容/未上线、测试证据、已知缺陷。只记录重构近期批次，不恢复旧V7日志。
本批不开发全题材覆盖评测页或任务调用追踪；这些需要C/D/E/F真实内容与运行数据，不能用空图/假百分比冒充。后台新库计数从数据库查询，暂不设“100%全题材完成”。

## 8. 验收（按docs/ACCEPTANCE.md相关API/UI/加法迁移行）

1. 保留并复跑B1五文件36项；新增真实API+临时合成SQLite集成：未登录401、普通账户403、伪造actor无效，非法输入/查无/歧义/冲突状态准确。不能只测应用服务冒充HTTP验证。
2. 创建→编辑→审核→发布→再编辑→历史读取完整链，数据库重开后仍可读。重复创建/发布、发布并发冲突、审核意见持久化、失败原子性、退役历史读取均断言。
3. 至少45张合成卡验证跨页筛选、分页/游标改变条件拒绝；active含45条时，只修改一条发布后仍保留其他44条；两版本关系冻结和悬空拒绝。
4. 如新增0123，执行现有迁移器首次与重复迁移；已有合成0122数据保持不变，禁止直接改生产DB。
5. 组件测试成功/加载/失败/409输入保留、发布预览与重复点击、返回列表保持筛选；原AssetAdminApp入口与既有platform-api相关回归。
6. API和后台typecheck/build，依赖用现有安装，不新增依赖；共享node_modules不得让测试实际指向主树旧源码，报告解析路径。命令找不到时可用现有node运行对应工具，记录真实命令与exit。
7. 本地浏览器1440与390截图及操作证据：导航进入、搜索筛选、详情、修改保存、审核、发布预览和成功、旧版本、错误/窄屏操作可达。使用本地合成数据，不登录生产。若浏览器不可用，完成其余检查并明确未验证，不能用组件测试代替截图证据。

## 9. 交付与停止

老板新增重构收尾要求：执行前/提交前回读主目录总规格第19.6节“替换旧实现与空间清理”。本批旧入口保留只是过渡，不是永久双系统。结果报告增加旧入口/旧供给实际依赖、替代位置、未替代能力和退出条件清单；不得按v7文件名删代码/数据，不扩大本批为生产清理。C/D/E完成对应接管后由Codex逐模块删除旧实现、清理本地及服务器冗余空间，并报告实际释放量。已经进行中的B2继续原范围，无须重做。

先自查完整diff与白名单，允许隔离分支提交。报告写base/result commit、文件清单、接口清单、迁移影响、逐项验收实际证据、失败和未验证项。不能仅报测试总数或“全部完成”。不删/弱化失败断言。小范围必要B1修正说明根因与回归，不借机重构。
完成后停止，告诉老板“B2完成，等待Codex验收”，附结果路径。下一批不自动执行；生产发布由Codex验收后另行安排。
