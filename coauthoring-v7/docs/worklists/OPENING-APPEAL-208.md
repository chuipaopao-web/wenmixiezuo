# R208 开书核心卖点与阅读味道：GLM实施合同

状态：Codex已核查代码并确定本批设计，待GLM在隔离副本实施。尚未修改产品代码、尚未上线。本文件是本批唯一实施合同，不以旧讨论或GLM自行提出的方案替换。

## 1. 交付目标与边界

作者输入想法后，开书候选能够生成、展示和编辑“核心卖点、阅读味道”；确认建书后原样保存到信息→资料页，修改后能被后续任务读取。独立管理后台更新本功能介绍、输入输出、执行规则、开发证据与待办。长期期待、全书钩子、主线支线和分卷仍在时光机，本批不提前设计。

本批是既有开书链路局部补全，不是整体重构。保持现有青绿风格、成员头像、导航、创意尺度及主/辅助创意偏向、自动保存原始想法、异模型开书审查、候选编辑与确认、书名/封面/简介、设定前置门禁和R207故事线恢复能力。

题材创作思路库与方法映射另批设计。本批不得偷偷创建空壳库、假检索、硬编码三国推荐或声明已能按题材查询阅读偏好。不承诺100%文学正确或无BUG，按下面可核对的验收项交付。

## 2. 已核查事实，必须据此修复

1. `OpeningPackage.positioning.coreAppeal` 已存在，新AI开书JSON要求8—800字符；不是从零新增第二个卖点字段。
2. `apps/api/src/application/books/v7-opening-package-contract.ts` 的 `toV7OpeningBlueprint` 没把coreAppeal写入正式blueprint；仅在建书定位草稿text中使用。后续时光机读取blueprint而不是定位草稿，不能以草稿存在判定链路完整。
3. `coauthoring-v7/author-app/src/book-profile-presentation.ts` 不展示核心看点或阅读味道。`BookProfileDialogs.tsx` 的profileToPackage从storyTraits回填coreAppeal，而建书时storyTraits为空。
4. blueprint已有stylePrimary/styleSecondary/styleIntent等兼容字段；新开书转换将styleIntent置为空。作者输入的CreativeProfile另存，不等于一份面向作者的本书阅读味道说明。不能删掉既有创意偏向或把偏向等级当阅读味道。
5. 当前作者生产构建是 `coauthoring-v7/author-app`，独立后台是 `coauthoring-v7/admin-console`，API为 `apps/api`；不要只改 `rebuild/apps/author-web` 的历史/预览页面。
6. 开书engine兼容入口导出 `@wenmi/opening-runtime`。真正运行的开书prompt/compiler/contracts/validation位于 `rebuild/packages/backend/src/legacy-opening`，不能只改coauthoring-v7/backend中相似文件、靠旧测试通过冒充生效。
7. 管理后台FunctionManagement从执行路线中“管理·…”字段显示功能说明。只更新一份新Markdown但不接路线入口，不算后台更新。
8. 本轮浏览器读取线上资料页超时，未取得新截图。页面现状核查来自上述源码；GLM实施时必须补同视口前后截图，不得写“已做线上视觉验收”。

## 3. 定稿字段与语义

| 作者标签 | 候选字段 | 正式blueprint字段 | 含义与边界 |
| --- | --- | --- | --- |
| 核心卖点 | positioning.coreAppeal，复用 | coreAppeal?: string，新增 | 本书区别于同题材的一句话创意和吸引力；不写完整故事、长期问题或预设分卷 |
| 阅读味道 | positioning.readingTone?: string，新增 | readingTone?: string，新增 | 本书希望产生的阅读感受及简单表达方式，如轻松反差、热血成长、紧张解谜；不是语言标签堆砌 |
| 故事方向 | longTermDirection.centralConflict，保留 | storyDirection，保留 | 作者已有的大致内容方向，可空；不借本批强制扩写 |
| 结局方向 | possibleEnding.direction，保留 | storyEnding，保留 | 作者/现有候选已给的方向保留，可空；不新增长期期待字段 |

为何新增readingTone而不覆盖旧styleIntent：旧数组分别承载语言、情绪等维度，CreativeProfile又承载创意尺度；本书味道的短句不能无损塞成某一个旧标签。新增一个可选短句作为新版展示来源，旧字段完整保留，不建立第二套味道标签目录。

- coreAppeal沿用候选现有长度；正式字段0—800字符，旧书缺失可保存，作者手动留空不阻断整个旧书编辑。新AI输出沿用既有有效性要求，建议1—2句、约40—120字，不凑字数。
- readingTone最多300字符，建议1句、约20—80字；新AI输出schema可要求该字段，但历史候选解析允许缺失。新作者编辑可清空，空字符串明确表示留空。
- 超长给出中文错误，不用slice静默截掉作者文字。服务器和前端校验一致。
- 不增加“主要看点”“这本书有什么好看”“长期期待”三套重复字段，不使用retentionPositioning或readerPromise冒充新字段。
- 核心卖点属于创作意图，不是已发生正文事实；阅读味道是创作偏好，不是世界硬规则。不能写入mustFollow。

## 4. 页面规格

### 4.1 开书输入页

保持一句话想法、成员选择、尺度与偏向；不增加作者必须先填写的两个新问题，不增加独立类型页或新流程确认。AI输出后才给出两个可编辑结果。

### 4.2 开书候选与修改表单

在现有作品定位区，题材/融合题材/标签之后、预计总字数之前，增加两个普通文本区域：

```
核心卖点
[本书独特的创意和吸引力，1—2句话即可。]
阅读味道
[希望读起来是什么感受，例如轻松反差、热血成长。]
预计总字数
...
```

两项均复用ManualOpeningForm的输入组件与现有草稿onChange。不要每项再加确定按钮、单独生成按钮、单独审查按钮。不引入强制标签选择。保留候选原本的提交/审查/确认边界；不能把编辑中的文本悄悄写成已确认资料。

输入框默认2—3行，高度随内容合理展开或允许内部滚动；手机单列，桌面同一阅读流，不强行左右卡片。字体至少16px，按钮触控约44px。仅局部CSS；不修改全站字号、颜色或间距令其他页面变化。

### 4.3 信息→资料展示

顺序：书名/分类及标签 → 作者原始想法（已有则显示） → 核心卖点 → 阅读味道 → 时代与世界 → 主要角色 → 预计字数/故事方向/结局方向/必须遵守 → 现有操作与简介等。

两个字段各显示一次，不在上下区域重复。复用现有dl行视觉，不加大标题、宣传文案或新页面。点击现有“修改开书资料”进入同一编辑弹窗，回显真实保存值。

旧书缺coreAppeal：显示“暂未补充”或隐藏内容行并保留修改入口，统一采用“暂未补充”方便作者理解；绝不拿storyDirection、storyTraits、简介或书名拼成卖点。历史候选提取回填不在本批范围。

旧书缺readingTone：可只读展示旧stylePrimary/styleSecondary/styleIntent中已有非空文字，去重并标“历史风格”；没有则“暂未补充”。不得自动将这个展示回退写入readingTone。显式readingTone为空字符串时按作者已清空处理，不再次弹出历史回退值。原始旧字段继续保留。

编辑仍用现有整份“保存修改”和expectedVersion并发校验，不为这两字段改造整个资料页自动保存。保存失败保留输入，版本冲突不覆盖，成功后立即回显，刷新不丢；不影响最初想法已有的自动保存。

## 5. 数据链路与历史兼容

必须贯通：模型schema → 活跃runtime解析 → 候选保存 → 作者编辑/返修 → 主编决定字段白名单 → 候选一致性校验 → 确认建书映射 → blueprint校验/存储 → GET资料 → 编辑回映射 → POST资料 → 后续读取。

- OpeningPackage复用coreAppeal；readingTone可选字段需要在活跃runtime合同、解析器、前端接口、提交校验与作者调整白名单同步。
- `toV7OpeningBlueprint`明确保存两项。不得删除已有styleIntent、CreativeProfile或作者原话。
- `profileToPackage`只从blueprint.coreAppeal读取；readingTone从正式字段读取，旧数据未触碰时保留缺键语义。`packageToBlueprint`保留旧字段并准确写回新字段；只改书名也不能丢失两项。
- 新字段放入现有JSON，不需要新数据库表或迁移；禁止全库回填、修改历史候选、重跑作者任务或修改管理员现有作品。
- 旧候选没有readingTone时，public规范化、一致性比较不能因为undefined与空字符串差异让原样确认失败；两边采用同一兼容规则，不能无条件给历史结果编造阅读味道。
- 作者修改readingTone的返修必须进入精确允许字段范围，未修改的主角/题材/卖点不得顺手重写。
- blueprint版本/hash自然覆盖新增字段；修改形成新版本，旧任务快照不变。新资料包不得命中旧来源版本的缓存。已经采用的全书方案不能静默重写；已有失效/重设计提示按当前机制保持，未完成的全局依赖失效仍记录待办，不虚称解决。

## 6. 提示词变化（有明确效果，不只加“要好看”）

在实际开书compiler的stageBoundary.keepNow加入核心卖点、阅读味道；长期期待/读者承诺/分卷仍不属于本批开书输出。修改提示源对应岗位/技能的矛盾描述时只改此责任，不批量改库。

设计指令应清晰表达：

> 核心卖点从作者想法、题材融合、独特身份/能力/关系/处境中归纳本书吸引力，写成具体短句，不以“精彩、爽、值得期待”等空话代替。阅读味道结合作者明确的尺度与偏向，说明本书希望带来的阅读体验。没有作者明确限制，不以合理性为由默认削弱金手指、禁止人物成长或补一长串硬禁令。不新增全书长期期待、故事线或分卷。题材常见写法只是可能性，不强制三国收名将、后宫、争霸，也不强制所有作品爽文化。

审查指令：检查作者意图是否保留、卖点是否具体、阅读味道是否与作者选择冲突；文学建议与事实错误分开。禁止因为无感情线、无战争、无牺牲等主观模板判不通过。检查限制是否来自作者，不把“开局弱”解释成“永远弱”，不把“升级不自动获得身份”改写成“始终不能获得身份”。不输出思维链。

修改活跃shared compiler及校验；coauthoring兼容compiler若仍用于入口或测试，应转为指向同一实现的兼容导出（确认导出列表），或明确同步必要合同并证明真正执行入口通过。禁止只改不运行的同名文件。

后续短卡：在现有六栏不新增第七栏，coreAppeal明确归入premise，readingTone归入preferences。只补充`time-machine-card-template.ts`及资料审查提示对这两项的保留责任，不改R207合并算法、来源别名、预算或恢复逻辑。只要来源有这两项，主编核对需要检查是否被遗漏/反向改写，不能要求原文逐字照搬或固定长度。新模板revision递增，历史成功结果不修改。预算仍为完整输入15000字符。

改变已有持久化节点prompt时，必须遵守步骤input_hash不变原则：新任务使用新版本节点，旧成功节点不可覆写；不得导致旧失败任务重试出现“接续不能改变输入”。为更改的资料节点提供版本兼容测试，优先限定新模板任务启用新提示，旧快照继续旧提示。不能为了兼容重写历史快照或清空步骤表。

## 7. 独立管理后台

复用FunctionManagement及OpeningContextGuide现有入口，不新建第二份管理应用，不误改rebuild/apps/admin-web。

- RB-19功能介绍：开书候选生成核心卖点与阅读味道，可编辑，长期期待留在时光机；明确题材思路库尚未接入。
- RB-20功能介绍：两项正式保存、读取、编辑与历史缺失显示，不承诺全局自动重算。
- 功能流程显示：作者想法→成员设计→异模型主编审查→作者确认→信息页保存→后续按来源版本读取。
- 资料/输出/校验/异常规则更新对应“管理·…”条目；开发记录写实施者GLM5.3、审计者Codex（未审计时必须写待审计）、批次、实际测试、未验证项。
- OpeningContextGuide样例中可以解释新字段在currentCandidates/outputJsonSchema中的位置，读取当时冻结样例。没有新字段的旧样例不得补假值；没有新调用不得声称有新实测数据。
- 概览状态必须区分计划、已编码、测试通过、已发布和真实业务验证。本批执行中写“待实现/待验收”，不得把整个RB-19已发布标志当作新增字段已经上线。
- 使用现有代码来源摘要校验函数更新受影响单元核对值；更新前先检查说明确实与最终代码一致，不能为通过校验而随意刷新所有摘要。
- 开发路线 `docs/REBUILD_EXECUTION_PLAN.md` 与详细规格 `docs/REBUILD_DEVELOPMENT_SPEC.md` 原位更新相关节，不删除正文、不恢复旧V7日志、不另造完整副本。产品上线与服务端文档发布由Codex处理，GLM只交付本地实现。

## 8. 文件范围与运行入口

允许修改以下业务文件及直接同名测试；增加聚焦这两字段的辅助模块/测试需列入结果清单，不得扩展到无关模块：

- `apps/api/src/contracts/opening-blueprint.ts`
- `apps/api/src/application/books/v7-opening-package-contract.ts`
- `apps/api/src/application/books/v7-opening-agent-service.ts`（仅调整字段白名单/兼容）
- `apps/api/src/application/books/book-profile-view-service.ts`（若现有openingBlueprint透传足够，无需新增顶层重复字段）
- `apps/api/src/application/books/time-machine-card-template.ts`及`time-machine-design-service.ts`（仅第6节字段归属和审查提示）
- `rebuild/packages/backend/src/legacy-opening/opening-agent/`的contracts、output-validation、prompt-compiler及对应测试；`runtime.ts`若需导出共享兼容函数。
- `coauthoring-v7/backend/opening-agent/`的兼容compiler/validation及测试（保持同一运行实现）。
- `coauthoring-v7/author-app/src/ManualOpeningForm.tsx`、`BookProfileDialogs.tsx`、`InformationPage.tsx`、`book-profile-presentation.ts`、`opening-api.ts`及相邻测试/局部CSS。
- `coauthoring-v7/admin-console/src/OpeningContextGuide.tsx`及测试；`FunctionManagement.tsx`仅确有必要时修改展示，不重做后台布局。
- 两份正式规格文档、本合同的执行记录、相关集成测试。

禁止改动：模型名单/密钥/路由/价格/用量、方法资产批量清理、题材数据库、树/卷链章、部署脚本、数据库迁移、全局CSS、依赖版本/锁文件、作者正式数据。遇到必须越界的根因，记录具体证据和最小建议，不顺手改。

## 9. 验收用例（每项给可复查证据）

| 编号 | 操作 | 必须结果 |
| --- | --- | --- |
| A1 | 模拟AI返回两字段→确认建书→读资料 | 两字段原样存在，不能只存在候选或定位草稿 |
| A2 | 信息页打开修改，不改两字段仅改书名→保存→刷新 | 两字段不丢失、不串入storyTraits/storyDirection |
| A3 | 修改两字段→保存 | 新版本准确回显，旧版本与原始想法不变 |
| A4 | 保存失败/版本冲突 | 输入保留，不假显示已保存、不覆盖别人新版本 |
| A5 | 旧候选缺readingTone原样确认；旧书缺两字段仅改其他项 | 可用、不强制AI补写、不凭空创造卖点 |
| A6 | 旧书有styleIntent但无readingTone；作者清空readingTone | 历史风格只读回退；明确清空后不再自动回填，旧字段不删除 |
| A7 | 新AI开书及返修真实执行compiler | 两字段schema与提示存在；长期期待/分卷不新增；返修仅改允许字段 |
| A8 | 全书资料来源快照 | 新blueprint字段可读取，premise/preferences职责明确，旧任务冻结不变 |
| A9 | 现有异模型审查、候选一致性与跨书访问 | 原有安全回归继续通过，不为新字段放宽权限 |
| A10 | 管理后台RB-19/20及旧真实样例 | 功能说明与字段一致，题材库标待开发，旧样例无伪造字段，未上线不显示已发布本批 |
| A11 | 390/768/1440px，短文/长文/空值/键盘与保存状态 | 无横向溢出，两字段各出现一次，按钮可达，风格一致，前后截图 |
| A12 | 三国脑洞、温暖日常、悬疑无外挂三组合成输入 | 提示不强制同种爽点、不强制外挂/战争/恋爱；人工检查结果，若未真实模型调用就明确只做合同测试 |

建议命令（在隔离副本根目录，先确认workspace依赖链接没有指回主目录）：

```
npm run build -w @wenmi/v7-backend
npm run typecheck -w @wenmi/api
npm run typecheck -w @wenmi/v7-author-app
npm run typecheck -w @wenmi/v7-admin-console
node node_modules/vitest/vitest.mjs run --configLoader native tests/integration/domain/v7-opening-confirm-consistency.test.ts tests/integration/domain/opening-blueprint-revision.test.ts tests/unit/creative-opening.test.ts tests/integration/domain/time-machine-design.test.ts
npm run test -w @wenmi/v7-author-app -- src/InformationPage.test.tsx src/opening-api.test.ts
npm run test -w @wenmi/v7-admin-console -- src/OpeningContextGuide.test.tsx src/FunctionManagement.test.tsx
npm run build -w @wenmi/api
npm run build:v7:web
node --input-type=module -e "import{verifyFunctionManagement}from'./scripts/verify-function-management.mjs';console.log(verifyFunctionManagement('.'))"
```

新增的针对性测试也必须运行，不能只运行以上旧测试。兼容compiler测试使用所在包实际runner，别将node:test文件错误交给vitest。失败记录原因并修正，不删除有效断言、不依靠超长重试跑过、不运行需要生产凭据的脚本。浏览器缺运行条件时记录未验证，不能拿截图原型冒充工作页面。

## 10. 开发次序与派工纪律

1. 在隔离副本核对入口与上述事实，列实际文件清单；发现合同与代码有冲突，优先提出具体差异，不重做产品方案。
2. 先写A1/A2/A5的数据回归与修复，再补模型合同/提示和作者修改。
3. 完成候选和信息页UI，核对旧书及失败状态。
4. 补后续资料字段继承、后台说明和本批真实状态。
5. 完成测试、构建与页面验证，审查完整diff，生成outbox报告；停止，不领取下一批、不部署、不直接合入。

Codex之后审计并处理合入、相称真实模型验证和安全发布。若本批发现不可逆迁移、生产数据修复或新付费需求，留待Codex处理；不得用老板“最大权限”越过本任务具体隔离范围。

## 11. GLM结果报告格式

提交 `outbox/task-208.result.md`：基准commit/工作副本路径；实际文件清单；每项A1—A12通过/失败/未验证及证据位置；运行命令/退出码；before/after截图；是否新增依赖/迁移/生产操作（预期均否）；待解决问题；完整diff或git diff可读取位置。不要只写“全部完成”。

本批通过条件是字段与交互闭环及证据充分，不是写出漂亮承诺。不要求作者看代码或判断英文错误，由Codex验收。
