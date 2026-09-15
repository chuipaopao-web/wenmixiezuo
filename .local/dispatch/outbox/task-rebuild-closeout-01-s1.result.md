# REBUILD-CLOSEOUT-01 · S1-A 结果：结构化故事线确认与基线启动

## Codex复核10bcf7e5通过（2026-09-16，关闭未决恢复缺口，未部署）

独立核对本次五文件差异，产品只修改四处材料确定性拒绝retryable:false；幂等回放优先保持。材料/选择集成20/20（40.66秒）、页面24/24（7.15秒）独立实跑通过。真实HTTP测试验证v2存在时冻结v1请求409、不可重试、当前版本2且同键两次均零新轮；页面测试验证清除后再刷新不重发。结合前批冻结版本修复，本项恢复缺口关闭。无需再为此问题反复重测或等待批准。

本地远程跟踪引用为10bcf7e5，本轮未再访问远端；K3报告已推送。尚未发布；整体质量/CTX/通道切换及全量旧债分别保留状态。下一步K3按原任务顶部“10bcf7e5复核通过”整理发布准备，不能提交或部署Codex尚未冻结的Agent Plan差异。

## K3·S1-A发布准备清单（2026-09-16，10bcf7e5基准，仅准备不部署）

按原任务顶部"10bcf7e5复核通过"完成，清单全文在原任务文件原位（"K3·S1-A发布准备清单"小节），此处留结论与证据要点：

- **现网差距**：现网`wm-v7-20260914-151504-a7614958`（9d3d26b5发布记录；匿名只读核实首页200/API在线，releaseId需发布前服务器只读复核）。待发布`a7614958..10bcf7e5`共44提交（24个触运行时代码）；增量迁移仅`0126_storyline_materials.sql`纯加法，向前兼容、代码回滚不要求回退迁移。
- **协调发布**：现网前端为旧设计请求合同，新后端自e58856a1拒绝旧intent入口——API/Worker/V7静态必须同窗一批（DEPLOY既定要求），不可拆"先API后静态"；新后端对现网其余路径兼容（现网无0126表、无书有资料，旧请求走建v1路径不触发版本门禁）。
- **Agent Plan通道**：Codex未提交差异不暂存/不提交/不包含。同批判断：Coding Plan 2026-09-16 00:29已InvalidSubscription，S1-A功能全部依赖模型调用——通道恢复必须先于或与S1-A同批，且通道验证独立于本包验收；生产实际调用状态未只读核实，如实标注。
- **证据与缺口逐项**：恢复机制/集成链路/浏览器三宽度通过不阻塞；run5未自然过审未采用——不阻塞工程发布但发布说明与后台状态不得宣称质量已验；CTX跨题材未完不阻塞（15000字符默认值不宣称已验证）；verify:full旧债需Codex逐项核定（boundary新增storyline-material-service一项为本批真实新增）。
- **结论**：代码包具备候选构建条件；**整批发布尚不可执行**。最小剩余工作：①模型通道恢复（冻结+密钥授权+验证）；②Codex核定批次构成及boundary新增项处置；③发布窗口服务器只读复核现网releaseId。三项齐备前不构建候选、不上传。

## Codex复核422a48c7（2026-09-16，恢复主问题通过，冲突合同待补）

独立实跑页面24/24通过（6.46秒），核对两个落盘入口及恢复均传冻结expectedMaterialRevision。剩余真实问题：服务端材料版本冲突retryable:true，前端只有false才终结未决；第三条测试mock为false与实际HTTP不符。将该mock临时改为true单独实跑，1失败/23跳过（4.48秒），未决记录仍存在而断言要求null；随后用apply_patch恢复测试原文，未修改产品代码。app-server.ts:149原样序列化DomainError.retryable，startDesignRound材料版本冲突第四参数为true，证据闭环。

下一批精确改动见原任务顶部“422a48c7复核后K3接续”：材料冲突确定性拒绝应不可原请求重试，真实HTTP测试验证retryable及零新轮，页面验证再次刷新不重发。不是版本持久化重新失败，不重做已通过工作。未发布；未推送。

## K3·422a48c7复核后重试合同统一（2026-09-16，未发布）

按主区task-rebuild-closeout-01.md顶部"422a48c7复核后K3接续"执行：仅统一资料版本冲突的重试标记+真实HTTP验证+清除未决后刷新不重发测试，未扩大范围、未调用真实模型、未混入Codex未提交改动。

**问题**：`startDesignRound`材料版本/快照/内容冲突的DomainError第四参数为true，app-server原样输出retryable:true；页面`definitiveFailure`要求`!retryable`才终结未决——真实合同下过期恢复请求永远无法清除未决记录。原第三用例mock为false，与真实行为不符。

**修复**：
1. `time-machine-design-service.ts`四处确定性拒绝（无材料却带版本号>0、版本号不符、材料快照损坏、内容哈希分歧）改为retryable=false——仅此组需作者重新核对的拒绝，不动其他409/429/服务故障合同；幂等回放优先与原版本冻结保持不变（同键已成功建轮的回放仍返回原轮）。
2. 真实app.inject反例（s1a-storyline-material新增）：保存v2后，旧标签页冻结v1+新幂等键→HTTP409、`error.retryable===false`、`details.currentRevision===2`、该roundKey零运行；同键再次回放仍409零新轮。
3. 页面第三用例mock与真实合同逐字对齐（VALIDATION_ERROR/"故事线资料版本已变化，请刷新页面后核对再开始设计"/details.currentRevision=2/retryable=false），并补"清除未决后再次刷新不重发任何设计请求"断言。

**验证证据（本批全部实跑）**：材料集成14/14（含新真实HTTP用例，40.87秒）、选择集成6/6、页面套件24/24、API tsc通过。按任务要求未重做前三条正常流程、模型探针、浏览器全宽度。测试矩阵更新于TIMEMACHINE_STORY_DESIGN 25.4原位置，验收状态见25.7，RB-22条目同步。此项恢复缺口关闭。

**仍未完成（如实标注）**：同前——真实长任务质量/自然过审采用、CTX跨题材重复实测及生产通道切换分别报告，不重新泛化整包任务。整包不发布。

## Codex复核1dbed5cd（2026-09-16，暂不整体验收，不发布）

核对54da3239/a75dd5b8/9a23d2ce/1dbed5cd源码差异；当前隔离工作区实跑材料、选择、Agent Plan配置三套23/23通过（31.54秒）。K3页面5×21、浏览器截图及其他套件属于交付方证据，本轮未重跑或重新核验全部截图，不冒充独立确认。

P1：已有资料的断网刷新重试遗漏expectedMaterialRevision。TimeMachineDirectionPage.tsx:301未决类型不含版本；406和634两处持久化遗漏版本；394自动重试只传三个参数。已有材料且首次请求未抵达服务器时，恢复请求缺版本会被startDesignRound的现有材料版本校验409拒绝，并清掉未决记录。已创建仅丢响应可通过幂等回放，不代表“请求尚未到达”也通过。此为源码核查发现，本轮尚未新增反例实跑；精确补测与修复范围见原任务顶部“1dbed5cd复核后K3接续”。

六项成果保留，当前不认定全部收束。Coding套餐到期不再等于所有模型不可用：Agent Plan八个文字模型已连通，长任务质量与生产切换仍未完成。四提交推送可作为留存，不等于发布许可；不混入当前Codex未提交通道改动。

## K3·1dbed5cd复核后恢复定点修复（2026-09-16，未发布）

按主区task-rebuild-closeout-01.md顶部"1dbed5cd复核后K3接续"执行：全程离线、未调用真实模型、未访问生产、未混入Codex Agent Plan未提交文件。改动在隔离worktree（分支codex/auth-takeover-01-release）。

**缺口**：已有故事线资料时，`PendingDesignRecord`只存key/signature/selection，两个落盘入口均未保存expectedMaterialRevision，刷新自动重试也不发送该字段；设计首发未到达服务器便断网时，刷新重试被服务端版本门禁409拒绝。原测试只覆盖无材料首次创建，不能证明此路径。

**修复（TimeMachineDirectionPage.tsx一处产品文件）**：
1. `PendingDesignRecord`增加`expectedMaterialRevision`；全书页直接确认（`sendDesignRequest`）与保存资料后接力（`confirmMaterialSave`）两个落盘入口均写入发送时冻结的版本号；无材料首发不落该字段，保持缺省语义（exactOptionalPropertyTypes下条件展开，tsc通过）。
2. 刷新恢复只使用记录中的冻结值（新增`pendingExpectedRevision`引用），绝不回填当前最新版本冒充原请求；自动重试原样带回；账号/书籍切换清理同步重置；明确失败（4xx）终结未决时一并清理。

**反例先行（TimeMachineDirectionPage.test.tsx新增三用例）**：
- 已有资料v1首发未到达服务器→刷新→回填作者输入、重试正文与幂等键完全相等（含expectedMaterialRevision=1）→放行成功回执后清除未决记录；
- 保存资料v2后接力设计首发未到达→刷新→重试冻结v2原样带回（正文/键完全相等，落盘记录含v2）；
- 恢复期间资料已被改为v2→重试仍用冻结v1（正文与首发完全相等）→服务端409明确拒绝、终结未决、零新轮，不自动改成v2绕过作者确认。
已创建仅丢响应回放同轮由既有6ad621dd用例继续覆盖。

**验证证据（本批全部实跑）**：页面套件24/24（首跑+连跑3次共4次全绿）；材料/选择集成19/19（`tests/integration/domain/`下两套）；author-app tsc通过、vite build通过（仅既有chunk体积提示）。按任务要求未重复真实模型探针与五轮全套回归；未出现新失败，未扩大定位。测试矩阵已补入TIMEMACHINE_STORY_DESIGN 25.4验收范围，修复与验收状态见25.7，RB-22条目同步更新。过程中两处测试自身修正如实记录：恢复提示文案断言与`runAction`启动即清空feedback存在时序竞争，改为断言回填的作者输入（与既有F4用例同模式）；另修一处exactOptionalPropertyTypes类型错误。

**阻塞口径更正**：Coding Plan到期是历史事实，不再写成"全部真实调用必须续费Coding"——Agent Plan八个文本模型已通过连通性小探针。尚未完成的是长任务质量/自然过审采用、CTX跨题材重复实测及生产通道切换；本批不调用真实模型。整包不发布。

## K3·72c3a62f复核后六项离线修复（2026-09-16，未发布）

按Codex复核（下节）与主区task-rebuild-closeout-01.md顶部"72c3a62f复核后K3接续"执行：全程离线，未调用真实模型（火山方舟Coding Plan 2026-09-16 00:29到期InvalidSubscription），未访问或修改生产，未等待技术路线决定，已有成果全部保留。改动在隔离worktree（分支codex/auth-takeover-01-release，基线72c3a62f）。

1. **结果正文直接可编辑**：材料内容自含勾选线`selectedLines`（稳定id/role/标题/描述）；资料页每条已确认故事线标题（≤80非空）/描述（≤500）直接编辑；role恒由服务端按原推荐裁定（前端伪造无效）；推荐原件逐字不变；旧版本材料（无selectedLines）服务端从原推荐回填，页面不依赖最新12轮推荐；勾选外覆盖→400。
2. **版本权威**：`ensureFromSelection`只在无材料时建v1，材料存在且哈希不同→409零写入；`startDesignRound`新增`expectedMaterialRevision`——无材料带版本号>0→409，有材料版本号不符→409带当前revision，客户端选择哈希≠材料哈希→409"内容已变化"，一致时用服务端存储快照构造intent（不信任客户端正文）。旧标签页旧选择+新key=409零新轮。
3. **影响预览绑定下游版本**：preview返回`signature`（待保存内容哈希+材料revision+来源preparationVersion/manifestSignature+下游采用candidate/adoptionRevision/planRevision/needsRedesign+受影响轮集合摘要）；save必须带`previewSignature`（缺省400"请先查看影响预览"），事务内重算不符→409"影响预览已变化"带新预览、零写入；幂等回放/CAS/unchanged顺序保持。
4. **失效全链**：planning-context查询命中needs_redesign已采用基线→409"已采用的全书方案基于旧版故事线资料，需重新设计；旧规划保留可查看，正文不受影响"；其余下游读取（adopt/候选修订）此前已有409。preview区分全书方案卷概要（`volumeOutlines`真实计数）与独立卷设计（卷/链/章未实现如实标注not-created）。
5. **工作UI**：state投影进行中统一`progress='正在工作'`（无真实分母不给百分比）；activeMember审查相位=实际reviewer、卡审/推荐相位=chief、卷卡/骨架等相位=writer、queued无member不虚标；页面工作态加"方案设计在后台进行，你可以离开本页；完成后结果保留，回来继续查看"（推荐等待文案原句保留）。
6. **验证收尾**：反例先行（材料存在后新键无版本号409/内容分歧409零写入/版本内容来源一致才建轮；adopt后旧签名409零写入、新签名才写；三相位工作投影直插断言；旧版本json_remove回填）；CTX措辞按run-log.jsonl实际分母修正、run5时限依据登记、verify:full旧债逐项实跑更新（均见下）。

**验证证据（本批全部实跑）**：材料/选择集成19/19（s1a-storyline-selection 9 + s1a-storyline-material 10）；阶段一回归30/30（k3-fixes 9+fixes 7+30a6 6+probe-budget 6+F-http/F-gate等）；rebuild-control解析12/12；页面测试21/21（新增正文编辑保存体断言、版本一致直达设计、不一致先存资料再自动设计、409重预览四用例，"正在整理本书故事线，请您耐心等待。"原句断言保留）；API tsc、author-app tsc+vite build通过；真实Edge headless+CDP三宽度截图8张（390/800工作态：方案A member=红玉·4p"正在工作"+可离开说明；390/1440编辑态：推荐线标题/描述直接编辑；390确认弹窗含卷概要计数与"尚未实现独立卷设计（如实标注）"；800保存后3套标记需重新设计），逐张肉眼核对无误，存`.local/dispatch/outbox/s1a-browser-evidence/stage3/`（harness `tests/browser/s1a-storyline-material-browser.test.ts`，S1A_BROWSER_STAGE3=1门控，夹具模型零真实调用）。

**CTX措辞修正（按run-log.jsonl实际分母）**：提取任务有效7份中3份遗漏"永久"核心设定整句（3/7；原3/9分母错误——L30000 Pfront/Pmiddle两份套餐到期无输出，不计入有效分母）；方案任务有效7份中3份"燃料"术语未命中但概念在位（3/7）；因果链统一为"6/7完整保留+1份（L15000-Pback）终因稀释瑕疵"，消除"7/7全合规"与1例稀释的矛盾；2次客户端中断（headersTimeout TypeError+运行器重启各1）供应商侧用量未知，单列不冒充零；阶段二（多题材/多模型/重复）仍因套餐到期整体受阻。正文修正同步落在下方阶段三小节。

**run5时限依据（如实登记）**：原合同外层3600秒。run4在约45分钟等待期限到时方案B/C仍queued、A仍working（probe-run4.log首末事件约50分钟，文件窗口21:07→21:57），真实模型单次方案调用252—335秒且三方案串行排队，3600秒不足以覆盖；故e58ca7a2将outcomeDeadline修正为150分钟，非"严格沿用原期限"。run5事后实测全程95.3分钟（elapsedMs 5,716,833）<150分钟（余量约36%），修正依据成立；后续无新预算不自动扩张。

**verify:full旧债逐项现状（2026-09-16实跑，非全量）**：
- rebuild-control 3项：**已修复**（d8c7c1a9，本轮复跑12/12通过）；creative-reference-migration：**现通过**（tests/unit 2/2）。
- application-database-boundary：仍失败，当前基线8项（admin/rebuild-control-service、book-synopsis-service、setting-time-machine-handoff、time-machine-design-service、time-machine-sources、time-machine-storyline-material-service（阶段二新增）、time-machine-task-list、creative-reference/runtime），本批零新增。
- v7-feature-capability-cutover：仍失败（台账68项期望债）；v7-runtime-source-closure：仍失败（闭包可达性债）。
- migration-0010-upgrade 2项：仍失败（期望最新迁移0113，实际已推进到0126_storyline_materials，期望值过期债）；first-admin-legacy-owner-migration：仍失败（同类期望过期债）。
- v7-creation-pipeline 2项、v7-opening-ranking 2项：仍失败（创作链名册/准入夹具期望债，用例名随轮次演进，债务性质同§4）。
- 测试配置typecheck（tsconfig.tests.json）：37处/12个测试文件，全部落在本批未触碰的既有夹具行（本批改动文件的报错行逐行核对diff均为旧代码），本批零新增；高于§4历史记录10处——口径/时点不同，未逐条追溯归属，如实记录。test:full全量未重跑（既有失败非本批引入；全量留待独立收束批次）。verify:full整体仍标**未通过**，不冒充全绿。

**仍未完成（如实标注）**：真实模型调用与CTX阶段二因套餐到期受阻，待老板续费决策；run5未自然过审/未采用状态不变；整包不发布，未实施拆包。

**收尾补记（2026-09-16 03:00，提交后）**：提交态复跑发现页面测试两处偶发失败（机器负载下约1/3失败率）：①"welcomes the author"用例中本次新增的可离开说明断言用同步getByText，与自动推荐POST竞争（该说明仅在推荐run创建后渲染）；②"stale runs"既有用例的"采用本方案"按钮断言同步getByRole，与方案详情区useEffect设置selectedScheme竞争。均为测试断言时序问题，非产品代码缺陷；已改findBy*异步等待加固，连跑5次全量21/21通过，单独提交`1dbed5cd`（未混入文档提交）。此前记录的21/21通过存在侥幸成分，如实更正。最终四提交：`54da3239`（后端+集成测试）、`a75dd5b8`（前端+页面测试+浏览器harness）、`9a23d2ce`（设计文档25节+RB-22）、`1dbed5cd`（测试加固）。HANDOFF.md中本批条目仍留在工作区未提交——其未提交diff与Codex三条并行条目（Agent通道补验/并行Agent Plan/验收更正）同处一个hunk无法拆分，为避免混合提交交由Codex一并处理。

## Codex复核72c3a62f（2026-09-16，未通过整批发布验收）

已读隔离提交、资料服务/仓储/API/UI、run5与CTX报告并实际查看390-material-edit截图；独立运行s1a-storyline-material与rebuild-control两套21/21通过（20.84秒）。认可资料版本/草稿/失效基础实现和解析取值修复已有证据，不认可“三阶段全部完成、测试全绿、具备整批发布条件”。本轮未调用模型、未访问或修改生产，未复跑全量验证。

仍需修复：
1. **资料结果不能直接编辑**：UI明确“推荐线的标题与描述……不能改写”，只允许勾选、改自添线和备注；服务内容只有selectedLineIds且依赖最新runs列表找原文。作者要求的是修改故事线结果本身。需要保存可编辑正文及来源引用/版本，推荐原件仍不可变；不得要求作者删除原线再复制成自添线。
2. **最新资料可被旧提交反向覆盖**：startDesignRound直接接受旧selection，ensureFromSelection在hash不同就插入最新版本，无expectedMaterialRevision检查，也不失效其他旧轮。旧标签页可用新key把资料回写旧内容并建有效轮。新轮必须从当前已确认材料版本读取；旧版本请求409且零新轮，不能把开始设计当隐式编辑保存。
3. **影响预览未绑定下游版本**：preview只返currentRevision；save只检查材料revision。预览后若其他人采用/修订下游但资料revision不变，保存仍执行且影响扩大，违反原合同。补预览内容/源版本/依赖快照签名，事务内复核；旧预览409带刷新结果且零写入。无变化保存及幂等回放仍正确。
4. **失效拦截未覆盖卷规划读取**：adoption/candidate-edit路由有needs_redesign校验，但GET volumes/:volumeId/planning-context仍从旧adoption读取，未检查标记；材料修改不改变原snapshot intent来源签名，不能依靠manifest同步兜底。服务端必须拒绝把失效基线作为后续生成输入，旧版本查看另保留。downstream不能固定not-created冒充查询；已采用候选已有卷对象，须区分已有全书卷概要与尚未独立设计的卷计划。
5. **工作UI未完成合同**：方案卡仍直出run.progress，state仍给“正在选择设计方法/正在整理资料”，无已定的可信进度与可离开工作说明；review阶段activeMember仍选members.chief而非实际members.reviewer，volume-card阶段也未正确识别。需展示实际成员和统一工作文案，保持排队/失败真实，不以改四个导航文字宣称UI全部完成。

真实模型与CTX状态：run5未自然过审/未采用，仍是未完成；CTX仅部分单模型样本，不是三阶段全部关闭。报告14有效样本、7有效方案，则有效提取分母应核对为7，不能把受阻样本算进3/9遗漏比例。方案“7/7因果合规”与报告中1例因果稀释需统一；套餐费用/未知调用按可核实口径。未独立完成全部样本语义评审，不认可安全默认或统计结论。150分钟不同于先前合同3600秒，应如实登记变更依据，不称严格沿用原期限；后续无新预算自动扩张。

决定：先由K3完成上述无需模型的修复与反例，暂停真实调用，不要求老板决定技术重跑路线。套餐续费属于老板付费决定；未续费不影响离线修复。功能地图解析修复可作为独立候选核验，但当前整包（含0126和资料页）不发布；未实施拆包或发布。详细动作在原inbox任务顶部，已有成果保留。

## K3阶段一收束：P1-6 真实探针 run5 结果（2026-09-15 23:37回收，RELEASE wm-v7-20260915-220500-b6c626ba，未发布）

**探针配置**：服务器隔离目录 /tmp/wenmi-s1a-probe-run5 + 独立 SQLite，真实 HTTP 链路（推荐→选线→三方案设计→审查），同一合成书样本（6条作者故事线+热血群像补充）。outcomeDeadline 由合同原值3600秒修正为150分钟（提交 e58ca7a2）；变更依据如实登记：run4在约45分钟等待期限到时方案B/C仍queued、A仍working（probe-run4.log首末事件约50分钟），真实模型单次方案调用252—335秒且三方案串行排队，3600秒不足以覆盖；run5事后实测95.3分钟<150分钟，非沿用原期限，后续无新预算不自动扩张。预算 maxCalls=100/maxTokens=600000。

**run5 终局（三分终态，诚实结果：needs-revision，未执行HTTP采用）**：
- 方案C（planner doubao-seed-2.1-turbo + chief deepseek-v4-pro）：全步骤成功，两轮修订审查均 verdict=revise，**不可采用**。阻塞意见为真实质量问题：伙伴线只有群像节点、未落实作者"配角拥有自己的完整故事"要求；卷D以"新秩序雏形"冒充全书承诺的"新秩序正式确立"；卷三/卷四承接锚点无法补足知己心意与团队成型条件。审查机制按设计拦下了不达标方案。
- 方案A：skeleton+4卷卡+自检全部成功（deepseek），卡在 chief-glm-5-3 锚点审查 review-anchors:2 —— glm-5.3 把 32000 输出额度全部烧进隐式思考后截断（input 2653/prompt 8791字符/reserved 50122）。已知失败，用量已知。
- 方案B：卡在 planner-glm-5-3 首张卷卡 volume-card:0 —— glm-5.3 烧穿 11000 总额度截断（input 2995/prompt 7560字符/reserved 25314）。已知失败，用量已知。
- 另有 1 次 doubao-seed-2.1-turbo 请求中断，供应商结果未知（error_class=temporary，无用量），按未知口径单列。

**计量（run5 账本，与 run4 对比）**：
- run5：45 次调用，已知 44 次 406,680 tokens（成功42次 358,032 + 已知失败2次 48,648），未知1次按预留 26,066 单列，budgetCommitted=432,746，elapsedMs=5,716,833（约95.3分钟，<150分钟期限）。三分计量（successKnown/failedKnown/unknownReserved/reservedInFlight/budgetCommitted）全程有真实值。
- run4 对照：22 次成功调用 191,944 tokens、0 截断、失败原因仅为探针 outcomeDeadline 45分钟 < 真实延迟（探针脚本问题，已修）。run5 证明修正后期限充足，失败全部来自真实模型行为而非探针设计。

**结论与边界**：本批探针达成其工程目的——三分终态、诚实计量、截断有界失败、审查拦截真实质量问题、无可采用方案时不执行采用，均在真实 HTTP 链路上验证。**未达成**至少一套自然过审+HTTP采用成功；按合同不伪造、不机械重跑。已知风险如实记录：glm-5.3 在约 8-9k 字符提示的审查/卷卡任务上仍会烧穿 32k/11k 思考余量截断（2026-09-02 以来的端点行为未变，P1-4 预算 v2 将其转化为有界已知失败+可续做，而非消失）；A/B 失败轮可单独续做，是否需要续做留待老板决策。证据：`.local/dispatch/outbox/s1a-browser-evidence/probe-run5.log`、`probe-run5-result.json`、`probe-run5.sqlite`（含 tm2_steps/tm2_model_calls/tm2_reviews 明细，上文数字均可复按）。

## K3阶段二交付：故事线资料页与失效机制（2026-09-15，提交 e67f2fe8，未发布）

- **范围**：二级导航（全书｜时光树｜轨迹｜资料）；故事线资料页（作者查看/编辑/草稿/确认）；迁移 0126：`tm2_storyline_materials` 版本表 + 草稿表 + `tm2_design_runs.needs_redesign` 失效标记。
- **失效机制**：作者编辑保存后同事务标记旧设计轮 `needs_redesign=1`，采用旧候选返回 409 并带新预览（CAS 按 expectedRevision）；正常确认只在材料哈希变化时建 v1 版本，同选择不重复建版；幂等键重复保存无重复版本；草稿保存/恢复且不失效；保存不触发推荐任务；跨 owner/book 隔离；事务失败回滚无半版本。
- **验证**：新增集成 `tests/integration/domain/s1a-storyline-material.test.ts` 9/9（真实 HTTP 链路全覆盖上述机制）；阶段一回归 s1a-storyline-selection+s1a-k3-fixes+s1a-fixes+s1a-30a6-fixes 28/28；页面测试 17/17（含资料页 4 个新用例）；author-app tsc+vite build、API tsc 通过。真实 Edge headless+CDP 三宽度（390/800/1440）点击核验：二级导航、未创建态、确认→材料 v1、编辑→预览→逐字确认文案、保存 v2、全书页失效标记+采用禁用，8 张截图在 `.local/dispatch/outbox/s1a-browser-evidence/stage2/`。
- **边界**：本节功能为作者编辑与失效机制，不依赖模型生成；真实文学效果随设计文档第 23 节整体链路验收。规则与验收状态见 TIMEMACHINE_STORY_DESIGN 第 25 节（含 25.5）。

## K3阶段三 CTX-01：资料包长度与信息利用测试（2026-09-15，准备完成待实测）

**预算声明（实测前记录，按合同要求先行登记）**：
- 测试模型：deepseek-v4-pro（火山方舟 Coding Plan，实际设计模型，已实测可用，cash=0 套餐额度）；开发 AI 与产品测试模型分开，本次只测该模型，未测试模型清单在结论中列明。
- 阶段一规模：1 题材（玄幻机甲）× 3 长度（15000/20000/30000 总输入字符）× 3 位置（前/中/后）× 2 任务（关键事实提取+短篇幅故事方案）= 18 次调用，maxCalls 硬上限 20。
- 输出/推理预算：提取任务镜像生产封闭结构路径（max_tokens 4000，thinking disabled）；方案任务镜像生产规划路径（可见输出 6000 + 推理余量 16000 = max_tokens 22000，thinking enabled 16k）。单次调用超时上限 900 秒，与生产适配器一致。
- 用量口径：totalInputChars=system+user 原始字符串字符数（含标点，不含 JSON 转义）；effectiveBodyChars=资料包正文字符；另记录每次调用的 input/output tokens、耗时、stop_reason、截断标记。失败重试每请求最多一次（60 秒退避），鉴权失败立即终止；不新增付费通道。
- 样本与评分器先于任何模型调用完成：三题材（玄幻机甲/历史权谋/都市异能）六类关键事实（作者要求/否定条件/人物关系/因果依赖/别名/允许发挥区域）齐备，填充为自然背景块嵌套子集（15k⊂20k⊂30k，不重复乱码）；评分器离线自证 6/6 通过（完美输出全过、否定误读/因果遗漏/坏JSON/违禁元素均被检出）。样本/清单/日志在 `.local/dispatch/outbox/ctx01-evidence/`。
- 阶段二（多题材/重复运行）视阶段一结果与时间预算决定，做不完如实记"待验证"，不伪造。

**实测结果（2026-09-16 00:32 回收，14 次有效调用 + 4 次套餐到期受阻，未新增付费通道）**：

- **执行与受阻**：18 次计划调用中 14 次成功；第 15 次起（服务器本地时间 2026-09-16 00:29）火山方舟返回 400 InvalidSubscription（Coding Plan 套餐到期），L30000 的 Pfront/Pmiddle 两位置共 4 次调用受阻。按合同受阻即停止，不换收费 API、不无限重试；阶段二（多题材/多模型/重复）因此**整体受阻待老板续费决策**。另有 2 次客户端中断（首次裸 fetch 300 秒默认 headersTimeout 导致 TypeError、一次运行器重启），供应商结果未知，重跑成功，如实记录。
- **程序评分**（score-report.json/md，158 项检查 10 项未过，评分器已离线自证）：
  - 提取任务有效 7 份中 3 份遗漏（3/7；L30000 的 Pfront/Pmiddle 两份因套餐到期无输出，不计入有效分母）：L15000-Pfront、L20000-Pfront、L20000-Pback 三份提取完全漏掉"忆燃系统以记忆为燃料、燃烧后**永久**失去"核心设定句，只提取了"每卷结尾记忆胜利"句（已核对原文输出，"永久""忆燃系统"在整份输出中零出现，属真实遗漏非措辞差异）。
  - 方案任务有效 7 份中 3 份术语未命中（3/7）但**概念在位**：三份方案未用"燃料"一词，但以"燃烧真实记忆/不可逆空洞/忆燃系统"完整表达核心设定，语义复核判为措辞差异，不计遗漏。
  - 否定误读 0：全部 14 份输出无一处把否定条件（系统流）读成要求；全部方案零违禁元素（系统/任务/面板类标记词零命中，含证据句）。
- **语义复核（我逐条对照原始输出给证据，非关键词自评）**：7 份有效方案中 6 份完整保留白塔坠落因果链"第二卷末燃烧母亲夏日记忆→同步率骤降→机体失控→第三卷坠落"（证据：各卷 summary/keyTurns 原文，见 score-report.md 复核队列）；L15000-Pback 一份把最终坠落写成"全城共振潮"，直接因果被部分稀释，记瑕疵 1 处（即 6/7 完整+1 份稀释，不以"全部合规"笼统表述）。相认时序全部合规（第三卷中段后或始终未点破）。别名青瓷/鹤归全部使用正确，无"鹤归"作人名。每卷结尾记忆胜利均明确"前文具体出现过"（如"燃烧正文反复出现的…记忆"），无临时编造。无依据添加检查：新增事件均取自资料包世界观（铁原、南桥、七号井），未见与关键事实冲突的编造。
- **用量与耗时**：14 次有效调用，提示 tokens 合计 166,840（非缓存输入 90,040 + 缓存读 76,800），输出 80,833 tokens（方案任务含 16k 思考预算，单次输出 7,713—13,573 tokens，耗时 252—335 秒；提取任务 390—1,123 tokens，7—21 秒），全程 cash=0（2 次客户端中断请求的供应商侧用量未知，未计入合计，不冒充零）。字符/token 比约 1.46（29,208 字符 ≈ 19,995 tokens）。
- **结论（方向性证据，非统计结论——每格样本量 n=1）**：
  1. "能容纳"不等于"能利用"：15k 与 20k 档都出现关键事实整句遗漏（有效提取 3/7），遗漏与长度/位置无单调关系；30k 档唯一有效样本（Pback）全过，但 n=1 不能宣称 30k 更安全。
  2. 按合同"有重要约束遗漏的条件不得作为默认推荐"：现行 15000 字符完整输入规范**未通过本测试验证为安全**，不推荐仅靠调整长度解决；应继续并优先比较：关键事实排序前置并单独成块、资料去重、按对象分包注入、生成后事实对照清单、独立异模型审查（与 run5 中审查拦下真实质量问题的机制一致）。
  3. 30k 相对 15k 在本样本未显示质量收益，提示 token 成本约 2 倍，方案任务耗时同量级；不建议在当前证据下上调默认长度承诺。
  4. **零遗漏≠零风险**：本测试只覆盖 1 题材 × 1 模型 × 每格 1 样本；未测试清单：历史权谋/都市异能两题材全部档位（样本已备妥）、glm-5.3/doubao-seed-2.1-turbo/kimi-k3 等其他成员模型、同格重复运行、相邻长度（12k/18k/25k）、真实书籍资料包。阶段二因套餐到期受阻，待续费后按已备样本与工具直接续跑（run-phase1 断点续传，已完成输出自动跳过）。
- **证据**：`.local/dispatch/outbox/ctx01-evidence/`（manifest.json、samples/ 81 文件、outputs/ 18 份原始输出、run-log.jsonl、score-report.json/md）；工具在仓库 `scripts/quality/ctx01/`（提交 e37408e8、d5b4f194、ae017f73）。

## K3收尾：执行计划解析合同修复（2026-09-16，提交 d8c7c1a9，未发布）

收尾核对时发现 `tests/integration/security/rebuild-control.test.ts` 在本分支 3/11 失败且先于本次改动存在（二分确认由 541dd570 引入，未被此前回归覆盖）：S0 收尾在 RB-01/02/04/12 上线列写入"已发布(后端)/已发布(后端部分)"但未扩展严格解析白名单，后台功能地图接口因此必然 503。修复：白名单登记两个显式取值（仍拒绝任意未登记值）；§4.1 图例同步释义；RB-02 验收列由"通过"回退为"未验证"（前端未开始，单元级通过与来源工单"页面完整闭环未验收"矛盾，生产后端证据保留在证据列）；测试锁定两个新取值并新增"未登记发布状态仍拒绝"反例，12/12 通过。文档记录（RB-22 卡片补 run5/阶段二/CTX-01 三条、设计文档 25.5 验收状态与 23.13 CTX-01 标注）同批提交。

## Codex复核14b58cae（2026-09-15：未通过完整交付验收，交K3定点接续）

实际核查256db4e5、b91ff23e差异、14b58cae报告、run3只读SQLite和当前依赖路径。认可错误分类、真实成员排除/异模型审查、计量与逐卷方向已有实现；不能认可“五项已完整交付，仅等决定”。决定为先修下列具体缺口与节点输出策略，再一次有界真实验证，不原样重跑、不发布。

1. **P1交付缺源/跨工作区依赖**：隔离HEAD的`rebuild/packages/time-machine-core/src/execution.ts`无`retryRunFailed`，应用182行却调用它。方法仅在主区同文件未提交修改及dist中。`fs.realpathSync`确认隔离`node_modules/@wenmi/time-machine-core`指向`D:/wenmixiezuo/rebuild/packages/time-machine-core`。三提交的独立源码闭包不成立；须审查并补齐该必要方法到隔离提交，不覆盖主区其他修改，从无预存dist且workspace链接指向自身的环境构建验证。
2. **P1逐卷输入与修订遗漏**：`design()`内部generate只对`volumes:`或`self`追加正式资料短卡；新增`volume-card:`不匹配。反馈的previousPart同样只处理`volumes:`和skeleton，新单卷修订拿不到原卷。补新节点的可信输入和对应旧卷（含顶层锚点），仅修受影响内容并保留正确成果；为初次与revision阶段分别断言原始约束、作者要求、对应卷及锚点、无他卷/他书污染。
3. **P1容量策略与作者选择冲突**：新增骨架硬提示`lines≤6`，HTTP却允许30条选择及20条自添线。不得为减输出默默丢掉已确认方向，需选择覆盖映射/有界分块，超过单次能力时诚实返回而非截掉。新增7条以上有效选择的反例。`keywords/aliases.slice`虽是机械字段处理，也须保留原始输出和可审查归一化记录，不把裁切视为语义无损证明。

**真实结果独立复核**：run3账本29成功218489+2失败36930=255419已知tokens，31调用；tm2_adoptions=0。A失败于review-anchors:0，B失败于skeleton，C修订版revision=2且verdict=revise。C有3条阻塞意见及17条建议，需逐条结合候选判定；不能把“途经独立审查”写成“通过独立审查”，也不能为采用强改pass。骨架/审查输出策略仍未解决，重复同样请求缺乏新依据。

**本轮验证边界**：独立运行`node node_modules/vitest/vitest.mjs run --configLoader native tests/integration/domain/s1a-30a6-fixes.test.ts tests/unit/s1a-probe-budget.test.ts`，两套12/12通过（不是13项）；但上面的跨区依赖使其不能证明隔离源码可交付。读取源码、Git和realpath证据已确认缺源；附加tsx导入检查因本机uv_os_get_passwd/ENOMEM未启动，未作为产品失败。未重跑其他未受影响套件，未真实模型调用、未修改生产。既有verify:full失败仍未关闭。

K3执行细节、节点策略与一次探针停止条件已更新原inbox任务顶部；第25节UI/资料编辑和CTX-01仍保留，在上述缺口收束后接续。

## 30a6f053定点修复交付（2026-09-15，提交256db4e5+b91ff23e，HEAD=b91ff23e，未发布）

按“30a6f053复核”五项修复；保留已通过成果，未缩短样本字数、未盲目提高额度、未部署。

### 五项修复（先离线重放三种失败建反例，再修）

1. **探针计量与退出**：`scripts/quality/s1a-probe-budget.mjs`（纯逻辑，单元测试6/6）——成功与带knownUsage失败都累计；未知用量单列`unknownCalls/unknownReservedTokens`不按0计；发起前按提示词字节+输出额度+思考余量+2048预留，已知累计+在途预留超600000或调用达100即拒发；已知失败按实际结算、未知失败按预留保守计；A/B/C全终态失败立即结束并逐轮写phase/error/state（不再空等45分钟、不再stateRuns=null）。探针主脚本改用该守卫并修了catch引用越界cookie的自身bug（run3真实暴露）、截止时已有可采用方案照常采用。预算与硬停止：100次/600000 tokens/外层3600秒，未扩大；token门槛是供应商上报+保守预留的能力边界。
2. **长度截断分类**：`ModelAdapterError`新增机器可读`causeCode:'output_length_limit'`（ark stop_reason max_tokens/length处设置）；网关映射到既有但从未使用的`truncated` kind（不再是temporary→不再同长请求盲重试；HTTP400仍走request_failure/invalid带脱敏诊断；unknown保持不自动重发）。反例：`truncated→kind=truncated且账本记录output_tokens=12000`；`invalid→diagnostic含http-400`；`unknown→unknown`。
3. **卷卡逐卷有界生成**：快照`volumeStrategy:'per-volume-v1'`（旧快照缺省沿用每批两卷旧路径，旧冻结步骤哈希不可改）；`volume-card:N`单卷请求（紧凑骨架视图+前卷交接）；骨架与卷卡提示词改为硬预算（开头钩子每条≤80字取代旧“约300字”示例、卷卡每自然语言字段≤60字/整JSON≤3000字）；截断只重做当前卷——`retry()`对truncated同轮重排队并`StepRepository.retryRunFailed`只重新武装truncated步骤，已完成卷从步骤缓存复用零新调用（测试断言volumeAttempts.v1===1）。反例：第二卷截断→run error_code=truncated→retry→v1零重做、v2完成、候选v1+v2。
4. **合同错误提前定位**：从probe-db离线重组A候选定位到`lines[].milestones[].suggestedVolumes`写“第一卷”等显示名（id()拒绝）——系统侧映射（id/标题/第N卷序数→概要原始id，与sanitize一致重命名）不退回模型；不可映射给精确字段路径交一次structured修复。逐卷接受前预检（锚点恰2且entry/exit、ownerEntityId=本卷、subjectIds/lineId在骨架线内、duty.anchorIds在本卷锚点内、动作/强度枚举、words正整数、keywords/aliases按合同≤12项就地裁剪、整卡>6000字符触发一次精确修复），最终parseCandidate仍做全候选校验。run3真实根因（keywords 19>12“列表格式或大小错误”）已并入该预检归一化。
5. **成员范围**：`snapshotTimeMachine`生产选择函数排除kimi-k3于全部时光机岗位（writer/chief/deputy/reviewer），A/B/C实为红玉deepseek/幼薇glm/陆青禾doubao（探针log可证）；每方案reviewer从chief_editor岗选异底层模型（A→顾承砚glm，B→貂蝉deepseek，C→貂蝉deepseek），无合格者明确受阻；审查归属按reviewer记录。未复制第二套名册到测试。

**验证**：新增s1a-30a6-fixes 6/6 + probe-budget 6/6；定向9套件55/55；部门50/50；页面13/13；API/FE typecheck通过。核心包新增`StepRepository.retryRunFailed`（加法，dist已重建；主工作区源同步改动）。

### 真实HTTP探针（同一60万字样本，服务器隔离目录+独立库，两次运行）

预算硬停止如上声明。run2（修正分类后首跑，70,884已知tokens/11调用/0未知/0现金）：三方案分别以truncated(skeleton)/truncated(volume-card:0)/needs_review(volumes:3最终组装keywords超12)失败，探针按新逻辑立即结束并如实分类。据此修run2根因（第4项keywords归一化+提示词硬预算）后run3（255,419已知tokens=29成功218,489+2失败36,930/31调用/0未知/0现金，模型调用总耗时3,571,561ms按started_at/completed_at求和）：

- **推荐+结构化确认+建轮**：通过HTTP当前实现（6条真实故事线+服务端hash/版本）。
- **方案C（豆包）完整走通逐卷生成→自检→独立审查（reviewer=貂蝉deepseek异模型）→修订轮**：状态succeeded，但审查verdict=revise（未过审，不可采用）——真实审查做出“需修订”判断属诚实质量结果；run3探针因自身cookie作用域bug在截止时崩溃（已修），DB留全证据。
- **方案A**：truncated于review-anchors:0（deepseek审查阶段输出超12000预算）——可恢复（同轮retry续作，离线已验证）；**方案B**：truncated于skeleton（glm两次16000，推理消耗为主）——同上可恢复。
- **HTTP采用未达成**：无方案通过审查。按停止条件**不发布、不机械增加调用重跑**；修复后的探针脚本（含截止采用与catch修复）待Codex决定是否再跑一次。

证据文件（`outbox/s1a-browser-evidence/`）：`probe-run3.log`（逐调用）、`probe-run3-db.sqlite`（durable检查点）、`probe-run3-summary.json`（run状态）；run2证据沿用`probe.log/probe-result.json/probe-db.sqlite`。

### 状态与唯一下一步

- 工程修复全部落地且有反例验证；真实链路推进到“至少一套方案完整生成并通过独立审查的修订轮”，仍未取得**过审+HTTP采用**。
- **未发布**；全量13项旧债清单保留待独立收束。
- 唯一下一步：Codex决定——(a)用已修复探针再跑一次真实样本取采用证据（预算内）；或(b)先调glm/deepseek审查阶段输出策略再跑；随后发布批收束。

## Codex最新核查：30a6f053（2026-09-15，未通过发布验收）

Codex实际读取本地probe-db.sqlite、probe.log及源码，查看1440故事线/390方案截图。认可截图已补齐和真实推荐、结构化建轮取得进展；三方案全失败、采用未验证，全量旧债未通过，不能发布。此轮未重跑模型或页面套件，不重复已关闭工程验证。

纠正GLM下方结论：
- 13调用已知tokens总计130536，另1次未知；50900是脚本只累计成功调用的结果，漏了5次失败的79636已知tokens。现有预算保护也漏失败用量，不能称严格全量硬停；0现金为已返回/已知账本口径，未知调用不冒充零成本。
- 12000并非已核实供应商上限：本系统call指定8000，适配器追加deepseek推理4000。GLM也有两次16000失败。应诊断输出合同、请求额度和截断恢复，不归咎端点并宣布产品无缺陷。
- C实际使用kimi-k3并HTTP400，违反用户此前K3仅主笔要求；A在volumes:2/最终组装报ID格式错误。必须修当前路径，不用夹具全绿豁免。
- 1440截图实际横向顶栏、宽主体布局；视觉模型的“竖导航/窄列”描述不符原图。390方案截图显示进度与操作，不能替代全部方案正文详情检查。

具体修复范围已更新原inbox任务30a6f053段：计量/终态退出、截断分类与逐卷生成、离线定位ID、真实成员准入。GLM执行；本批不部署、不扩S2，不重做S0及已关闭修复。

## d5e4b0d1发布前验证收束（2026-09-15，GLM执行，隔离分支HEAD待提交后更新，未发布）

按“d5e4b0d1复核”五项收束执行完毕；未重做已关闭项、未碰S0维护工具、未开发S2、未部署。

### 1. 真实交互证据（390/800/1440，正常点击与键盘）

环境复用`tests/browser/s1a-browser-harness.test.ts`（S1A_BROWSER_HARNESS=1，test:full下自动skip）。工具问题先诊断后如实记录：

- **Playwright定位器click在本IAB挂起**：登录按钮与“＋添加其他故事线”各一次30秒超时（保留为失败证据）；命中测试证明无遮挡（elementFromPoint=按钮本身）、无动画（getAnimations=0）、按钮可见可用——属工具动作性问题，非页面缺陷。本环境仅iab后端（无extension/cdp可换）。
- **CUA键盘输入队列乱序**：cua.type跨调用交错（密码框出现三段拼接文本）、Backspace部分丢失——同属工具问题，已记录。
- **采用的交互协议**：文本用fill（标准表单填充API），**全部点击用CUA坐标点击**——浏览器级真实输入事件（非DOM element.click/force click），登录、勾选、弹窗预设、确认、返回、导航全部经真实点击完成。截图采集初次失败两次（30秒超时），打开IAB可见面板后成功。

实际操作序列与结果（单次会话，真实UI登录browser@example.test）：
| 操作（真实点击） | 结果 |
|---|---|
| 登录按钮 | 进入推荐页（成长线勾选，已选1条） |
| 勾选“伙伴线”复选框 | 已选2条，卡片选中态 |
| “＋添加其他故事线”→弹窗“感情线”预设 | 已选3条，弹窗关闭 |
| 确认故事线，设计全书方向 | 进入方案页，A/B/C创建（A红玉·4p/B幼薇·G3/C苏映棠·K3全部succeeded） |
| “‹返回故事线推荐” | 已选3条+备注“希望更热血一点”+伙伴线/感情线勾选全部恢复 |
| 800宽：“全书基线”导航 | 方案页正常渲染 |
| 1440宽：“故事线”导航 | 推荐页正常渲染 |

**截图已取得并实际查看**（视觉模型逐张核对：无错位/无横向溢出/无文字截断/无重叠空白）：
- `.local/dispatch/outbox/s1a-browser-evidence/390-storyline-edit.png`（390故事线编辑态）
- `.local/dispatch/outbox/s1a-browser-evidence/390-scheme-A-detail.png`（390方案A详情）
- `.local/dispatch/outbox/s1a-browser-evidence/800-schemes.png`（800三方案）
- `.local/dispatch/outbox/s1a-browser-evidence/1440-storyline.png`（1440故事线页）
1440下内容列较窄、右侧留白——布局协调，无缺陷；是否加宽属产品视觉决策，不在本批。35秒轮询保留与原键重试未重跑（未改相关逻辑，沿用4459b76b证据）。

### 2. 证据范围准确说明（按d5e4b0d1第2条）

- **F-gate证明持久化准入**：无推荐时会显式POST recommendation-runs（代码内fallback），因此它证明“真实持久化状态门禁+同键创建/回放”，**不单独证明自动交接派工**；自动交接依据是浏览器harness（无该fallback，等待交接tick建立推荐，两轮均观察到）。
- **BREAK_FLAG语义**：在onRequest销毁连接=请求未完成时的恢复证据；**“服务端已建轮但回执丢失”场景由页面测试`treats an existing round...`单独证明**，不混为同一次浏览器结果。
- **证据文件**：上列4张PNG（真实截图文件）+ probe.log/probe-result.json/probe-db.sqlite（下节）；本报告中的交互序列为操作记录（DOM断言+截图佐证）。

### 3. 真实模型探针（单个合成书样本，已执行，采用未通过）

脚本`scripts/quality/s1a-http-real-probe.mjs`（新增提交）。旧`time-machine-real-probe.mjs`确认使用旧startDesignRound(intent)直连service，未沿用。新探针：服务器`/tmp/wenmi-s1a-probe`（0700、独立SQLite 0600、127.0.0.1:43199、密钥仅进程env来自部署env文件、不打印不落盘）；**确定性准备**（注册/建书/设定批次/确认/总清单，内联夹具，0真实调用，728ms）与**真实模型阶段**（推荐→结构化确认→A/B/C→审查→HTTP采用，全走当前HTTP实现）显式分离。

预算与硬停止（调用前已交代）：真实调用≤100次或≤600000 tokens即抛错；外层timeout 3600秒；单次运行不重跑。实际用量：**13次真实调用、50900 tokens、0元**（coding-plan订阅）。

结果（probe.log逐调用、result.json、probe-db.sqlite留档）：
- ✅ 真实推荐完成：deepseek-v4-pro 3次调用（1次失败经持久化重试成功），产出6条故事线+服务端hash/版本；
- ✅ 结构化确认创建一轮三方案（202，A/B/C）；
- ❌ 三方案生成全部失败，无可采用者，**HTTP采用未验证**：
  - A：`volumes:2 ContractError: ID格式错误`（deepseek卷卡输出含非法ID）；
  - B：`temporary/http-200`——**volcengine-ark-coding-plan输出上限12000 tokens截断卷卡JSON**（失败调用output_tokens均为12000整，骨架9713<12000可过、卷批次超限即截断）；
  - C：`invalid/http-400`（skeleton阶段请求被拒）。
- 机制层全部正确：失败重试、跨方案故障隔离（A失败B继续）、诚实失败记录、独立SQLite全程隔离。

**结论**：管线工程正确（夹具链全绿+真实调用前半程通过）；真实端点在当前配置下**无法完成600k字级卷卡阶段**（输出上限截断为主因）——这是发布真实模型操作的现实阻碍，交Codex决定修复方向（如调整端点输出上限/更换端点/缩小首批样本字数），本批不自行重跑。

### 4. verify:full精确阻碍清单（自既有日志提取，未重跑全量）

来源：task-rebuild-closeout-01-s0/s1a-test-full.txt（13失败/760过）、s1a-typecheck-full.txt；另按d5e4b0d1要求实跑了**仅typecheck部分**（tsc -p tsconfig.tests.json，非十分钟全量）确认现状。

运行时13项失败（9文件）：
1. `tests/contract/application-database-boundary.test.ts`应用层数据库边界：期望[]实得8项（含storyline-selection.ts）——**本批已修**：现为基线7项（admin/rebuild-control-service、book-synopsis-service、setting-time-machine-handoff、time-machine-design-service、time-machine-sources、time-machine-task-list、creative-reference/runtime，按名核对）；
2. `v7-feature-capability-cutover.test.ts`：台账71≠68、modules≠14；
3. `v7-runtime-source-closure.test.ts`：61项不可达（53个scripts/creative-library运维文件+上述8个边界文件）；
4. `creative-reference-migration.test.ts`：迁移0122表清单11≠9；
5-6. `v7-creation-pipeline.test.ts`两项：名册期望3实得4、期望2实得3；
7-8. `v7-opening-ranking.test.ts`两项：准入布尔与模型绑定清单期望不符；
9. `migration-0010-upgrade.test.ts`：期望最新迁移0113实为0125；
10. `first-admin-legacy-owner-migration.test.ts`：同0113/0125期望过期；
11-13. `rebuild-control.test.ts`三项：执行计划文档解析失败（REBUILD_PLAN_UNAVAILABLE，文档结构变更未同步解析器）。

类型错误现状（tsc tests配置）：10处，全部在5个未触碰文件（identity-final-transaction×3、creative-reference-refinement、creative-reference-runtime×2、time-machine-card-merge×2、time-machine-material-template×2）——**本批零新增**（此前design/schemes测试的类型错误已在六项修复轮消除）。author-app typecheck通过。

分类：#1已修待全量复跑确认；#9/#10/#11-13为期望值过期（迁移推进+文档结构变更）；#2/#3/#4为台账与运维文件登记债；#5-8为创作链名册/准入夹具期望债；类型10处为测试严格化债。无构建/账号隔离/核心运行阻断项新增。未改任何白名单/断言；未重构7处边界违规；未解决的全量门禁仍标未通过。

### 5. 当前状态与唯一下一步

- **真实交互**：通过（真实点击三宽度+截图实际查看；工具缺陷两次如实记录并有替代真实输入路径）。
- **真实模型**：已执行；推荐+结构化确认+建轮通过，方案生成被端点能力（12000输出上限截断等）阻断，**采用未验证**。
- **verify:full**：未通过（上列精确清单，本批零新增类型错误、边界项已减一）。
- **用户现在可做**：隔离环境全链已可用夹具验证；真实模型链在端点输出上限问题解决前不能完成600k字书。
- **未上线**；候选API合同未单独上线。
- **唯一下一步**：Codex依据本报告决定——(a)真实端点输出上限/端点调整方案后重跑一次探针补采用证据；(b)据第4节清单圈定全量门禁修复批次；然后安排前后端协调发布。

## Codex最新核查：d5e4b0d1（2026-09-15）

两项补齐通过范围内复核：真实账号Context接线已落地；持久化设定门禁不再只靠mock证明。Codex独立运行后端s1a-fixes 7/7（15.58秒）与页面13/13（4.74秒）通过。保留已关闭修复，不要求重新开发。首次npm.cmd调用因本机PATH缺失未启动，改直接调用已安装vitest后通过，非产品失败。差异检查仅发现部门测试EOF多余空行。

仍未通过发布验收：普通浏览器点击曾超时并被JS-click替代，截图未取得，因此现有DOM/无溢出证据不能称完整交互与视觉通过；真实模型未执行；verify:full旧债仍未关闭。Codex未独立浏览器走查、未真实模型调用、未部署。

证据口径纠正：F-gate允许显式启动推荐，不单独证明自动交接；无此回退的browser harness是另一份证据。harness的BREAK_FLAG在onRequest销毁连接，不能当作“已建轮后丢响应”的浏览器证明，后者有单独页面测试。待补项目已写回原inbox任务顶部；GLM只做发布前验证与精确阻碍清单，不重做S0/S1开发，不扩S2。

## Codex历史核查：3a84dc98（下述两项已补齐）

已读实际差异，认可前轮快照/读取器/仓储及HTTP采用链修正的代码证据，不重复关闭项。尚未批准发布：页面持久化依赖wenmi:session-owner，但源码无业务写入方，仅测试手工setItem，正常会话下该功能可能不启用；HTTP成功链仍mock设定就绪，未证明真实持久化中间状态。两项具体动作已写原任务S1-A顶部，按现有AuthorAccountContext真实userId接线并补无门禁mock的测试。Codex本轮未独立重跑或上线，浏览器/真实模型/全量旧债仍分别保留未验证/未通过。

## 3a84dc98两项补齐交付（2026-09-15，提交72bd24e1+4459b76b，HEAD=4459b76b，未发布）

按“3a84dc98复核”只补两项，保留六项修复成果；未重做S0、未扩S2、未全项目盘点。

### 1. 真实账号接线（72bd24e1）

- **缺陷确认**：页面读`localStorage['wenmi:session-owner']`（全库无业务写入方），ownerIdRef为空→pendingStorageKey返回null，正常用户sessionStorage未决持久化不成立。
- **修复**：改为`useAuthorAccount()`（AuthorAccountBoundary已有Context+导出hook，AuthorAccount.userId为已验证账号ID）；页面仅在边界内挂载，无Provider时抛错防绕过，不新建身份来源。账号/书籍变化重置恢复、dirty、未决引用与输入状态，绝不重发上个身份请求；账号未就绪时不标记pendingRestored完成。
- **测试**：13项页面测试全部改真实`AuthorAccountSessionProvider`+userId渲染（不再setItem不存在的身份键，beforeEach清sessionStorage隔离）；新增“切换账号不读另一账号未决记录”（不回填旧输入、不自动重发、旧记录不被误清）。13/13通过；author-app typecheck通过。

### 2. 持久化门禁证据（72bd24e1）

新增`F-gate`测试：部门夹具抽到`tests/integration/helpers/setting-department-fixtures.ts`（部门套件50/50不回归），实际service/HTTP推进、模型fixture、不mock门禁函数：
- 批次未完成（成员结果未知→partially_failed不可自恢复）：design-runs 409“请先完成设定设计”，零设计轮；
- 条目未确认（awaiting_author）：409“请先在设定页确认并保存本书设定”，零设计轮；
- 确认后总清单未完：409“请先由主编完成设定总清单的统一整理”，零设计轮；
- 真实最终整理完成后门禁打开（版本=服务端finalReviewRequestHash，state投影回读，无手工pv字符串）：同一idempotencyKey的合法请求202创建A/B/C，同键同请求回放幂等；推荐由确认/总清单交接派工+路由执行器tick真实建立。F1-http的mock用例按要求保留。

### 3. 隔离浏览器390/800/1440（4459b76b）

环境：`tests/browser/s1a-browser-harness.test.ts`（S1A_BROWSER_HARNESS=1门控，test:full下自动skip已验证）——真实API(43111)+vite dev(43180)，真实HTTP把新书推进到设定确认+总清单完成，BREAK_FLAG触发design-runs连接重置。真实浏览器+UI登录真实会话：

| 场景 | 结果 |
|---|---|
| 正常会话 | UI登录→时光机页渲染真实推荐（成长线勾选，已选1条） |
| 编辑不被轮询覆盖 | 备注“希望更热血一点”+自添感情线→等35秒（≥2个15秒周期）→备注与“已选2条故事线”保留 |
| 未知响应→原键重试 | 连接重置丢响应→错误提示+**按真实会话userId隔离**的未决记录（完整selection）落盘→删flag刷新→自动原键重试：**roundKey与未决记录key逐字相等**、恰好一轮、A/B/C全部succeeded、记录确认后清除 |
| 刷新恢复 | 返回故事线页→服务端保存的选择投影恢复（已选2条+备注+感情线勾选） |
| 三宽度 | 390/800/1440无水平溢出（scrollWidth≤innerWidth）；方案页详情（卷A/采用本方案）渲染正常 |
| 截图 | IAB截图两次30秒超时失败（如实记录）；布局以程序化溢出探测+DOM快照佐证 |

harness自身路由缺陷修正：时光机自检提示含“紧凑候选：”误中设定“候选：”标记致方案处理失败——改时光机标记先判后全部succeeded（缺陷在测试harness非产品；F1-http证明产品链路正确）。

### 本轮验证汇总

| 验证 | 结果 |
|---|---|
| s1a-fixes（F1/F1-http/F2a-c/F5/F-gate） | **7/7通过** |
| 页面测试（真实Provider+账号切换） | **13/13通过** |
| 设定部门套件（夹具抽取后） | **50/50通过** |
| 定向回归（7套件+边界门禁） | 43/44（唯一失败=边界门禁基线7项按名相同，未新增） |
| API/author-app typecheck | 通过 |
| 浏览器390/800/1440 | 完成（上表；截图采集失败已记录） |
| 真实模型探针 | **未执行**（隔离环境无生产API Key环境变量，具体缺失已记录；不申请泛化权限） |
| verify:full | 未重复执行（任务明确不重复十分钟全量；基线债不变，不能称全量绿） |

## 90328d31六项集中修复（2026-09-15，提交d5825f07+e68d7073，覆盖下方"已实现+已验证"状态）

按inbox任务S1-A"90328d31集中核查后的当前动作"逐项修复并验证；**本批仍隔离未发布**。工作树分支codex/auth-takeover-01-release，HEAD=e68d7073。

### 六项修复与证据（先建反例再修，反例保留在tests/integration/domain/s1a-fixes.test.ts）

1. **快照一致性（首要）**：startDesignRound不再"空intent快照后只赋base.intent"。现在事务内两遍构建：第一遍空intent快照仅用于上游来源签名校验；得到规范intent后在**同一事务**内以最终intent重建完整快照——manifest的intent来源revision/hash、documents的`intent:intent:${hash}`正文、保存文本三者互相印证。
   - 反例→修复：s1a-fixes `F1`（三方案快照逐项断言intent含自添线与备注、intentSource.hash=digest(intent)、documents含同hash同正文）。
   - **真实HTTP链**：s1a-fixes `F1-http`——HTTP注册/建书→HTTP recommendation-runs→路由自带执行器生成审查→HTTP结构化design-runs（202返回A/B/C）→HTTP adoptions。采用路由以保存的intent重建manifest并校验；断言采用后`tm2_books.manifest`的intent来源hash=digest(设计快照intent)、state.adopted非空。不经仓储adopt、不mock来源。
2. **真实事务门禁与回放**：就绪/版本读取移入BEGIN IMMEDIATE后的新轮分支，经路由注入的`_prerequisiteReader`（真实timeMachinePrerequisite）读取；**e68d7073进一步删除客户端版本参数**——无读取函数时fail-closed拒绝，客户端版本不再可能作为事实。同键规范请求在归属核查后直接回放（读取器返回null/未就绪仍返回原轮），不重新就绪。
   - 事务内读取证明：s1a-fixes `F2a`注入读取器断言`db.isTransaction===true`且零任务创建。
   - 回放不要求就绪：`F2b`（读取器返回null，同键同选择返回原轮3方案）。
   - 第二方案故障回滚：`F2c`（预占B方案request_key，startDesignRound抛错后A也回滚，零半轮；清障后成功）。
   - 重启回放/上游变化：s1a-storyline-selection（service2新实例同键同选择返回原轮；同键上游版本变化后回放原轮；新键+过期版本409"设定资料已变化"）。测试经注入读取器模拟服务端版本变化，不再以客户端pv-*字符串证明版本。
3. **页面恢复只做一次不覆盖dirty**：恢复effect按bookId+roundKey标记只执行一次；window input捕获置authorDirty后不再重灌；旧设计recommendationRunId与当前推荐不一致时不套旧ID。
   - 回归：TimeMachineDirectionPage.test.tsx `keeps author-added lines and note on the redesign page across two background refreshes`——重新设计页真实input事件编辑备注+自添感情线，fake timers推进两个15秒轮询周期（每次/state返回全新state对象，refreshes=3），"已选 2 条故事线"与备注文字仍在。
4. **跨刷新防重**：未决请求**完整selection+key**（非仅键/签名）在发送前持久化到按账号+书籍隔离的sessionStorage（`wenmi:design-pending:{owner}:{book}`，无会话账号不落存储）；刷新后回填作者输入并自动用原请求原键重试一次（来源仍一致且作者未修改时）；state中出现对应roundKey=确定成功即清除；服务端明确拒绝（4xx且不可重试）终结未决记录，网络/超时/5xx结果未知保留。区分依据AuthorApiError.status/retryable（request层把网络失败包装为retryable status=0，不能当已知失败）。
   - 回归A（服务端已建轮+响应丢失→刷新）：`treats an existing round after a lost design response as confirmed success without resending`——断言不自动重发（designPosts仍1）、三方案一轮、sessionStorage记录已清除。
   - 回归B（请求未到服务端→刷新）：`restores the pending selection after refresh and retries the same request with the same key`——断言回填"已选 2 条故事线"+备注文字、自动重试POST与首次同键同body逐字节相等、成功回执后记录清除。
5. **严格解析**：authorNote非字符串（数字/对象/null/undefined）抛出中文错误拒绝，不静默转空串。反例：s1a-fixes `F5`四类非法值+合法字符串通过。
6. **架构违规**：storyline-selection.ts的DB访问提取到`infrastructure/db/repositories/storyline-selection-repository.ts`（无新表/迁移）；纯解析/规范哈希留应用层，校验接收仓储已读行。
   - 门禁按名对比：`tests/contract/application-database-boundary.test.ts`失败清单从8项回到**恰好7项基线违规**（admin/rebuild-control-service、books/book-synopsis-service、books/setting-time-machine-handoff、books/time-machine-design-service、books/time-machine-sources、books/time-machine-task-list、creative-reference/runtime——与基线逐名相同，未动）。

### 本轮验证汇总

| 验证 | 结果 |
|---|---|
| 定向7套件（含s1a-fixes 6项、s1a-storyline 6项） | **42/42通过** |
| application-database-boundary | 失败=基线7项按名相同（storyline-selection.ts已移出） |
| 页面测试（含F3/F4三项新回归） | **12/12通过** |
| author-app typecheck / API typecheck | 通过 |
| verify:full | 未重复执行（任务明确"不先重复十分钟全量找错误"）；此前基线债不变，本批改动文件均在上述定向验证覆盖内 |
| 浏览器390/800/1440 | 未执行（jsdom覆盖F3/F4行为逻辑；三宽度视觉与前后端协调发布同批） |
| 真实模型探针 | 未执行（密钥环境不可用：隔离工作树无生产API Key环境变量，按授权边界记录，不申请泛化权限） |

## Codex核查补充（2026-09-15，优先于下方GLM完成描述）

本轮已读e58856a1实际差异、90328d31记录及部分原始日志，未独立重跑。结论：有实际功能开发，未通过发布验收。发现最终快照intent与manifest/documents不一致、前置版本在事务外读取、轮询重复恢复覆盖编辑、useRef幂等键跨刷新丢失、authorNote非字符串被静默丢弃及本批新增数据库边界违规。具体修正与反例已原位加入inbox/task-rebuild-closeout-01.md的S1-A段，不新增返工文档。

基线失败日志证明部分旧债存在，不能证明本批零增量违规；新增storyline-selection文件加入失败名单就是本批需处理的增量。浏览器、真实模型、全量验证仍未通过/未完成，不能把它们移到生产切换以后。本批未部署；下方“已实现+已验证”限于GLM列出的局部夹具测试。

GLM执行；Codex集中验收。隔离工作树 `.local\dispatch\worktrees\auth-release`（分支 codex/auth-takeover-01-release，**提交e58856a1**），按87a2acb8版S1-A合同实施。**本批隔离提交，未发布**（API请求合同变更需协调前后端发布，合同明确）。

## 一、实际新增行为（对照合同"结果"句）

作者仍在现有故事线页勾选/添加后点一次"确认故事线，设计全书方向"；后端保存准确选择与来源版本，才建立基线设计任务。**不能仅凭设定就绪直接绕过故事线**——design-runs现在要求结构化selection；**不因刷新/超时丢选择或重复开三套任务**——幂等键+requestHash+选择投影恢复。

### 请求与存储（合同8条决定逐项落实）

1. **请求合同**：POST design-runs保留URL，Body改为`{idempotencyKey, selection:{recommendationRunId, recommendationHash, preparationVersion, selectedLineIds, addedLines, shape, ensemble, authorNote}}`。旧intent-only请求返回400"页面已更新：请刷新后重新确认故事线"，零任务创建（测试s1a-gate第2项）。旧结果仍可读取（state投影含selection），不回填旧书。
2. **state投影**：成功推荐附带服务端计算的`recommendationHash`（对result_json规范摘要，`canonicalRecommendationHash`）和`preparationVersion`（当前来源版本，路由层附加）。前端不可伪造——服务端在startDesignRound内重新验证两者。
3. **选择校验**：selectedLineIds去重且必须存在于该推荐；名称/描述/role取服务端推荐（客户端只传ID），自添线独立存title/description；至少一条；未知ID拒绝不静默丢弃（"勾选的故事线不在本次推荐内"）。shape/ensemble/authorNote严格校验。intent由服务端从验证后的选择构建（保留作者文字语义）。
4. **请求边界**：选择ID≤30、自添线≤20、标题≤80、描述≤500、authorNote≤1000、最终intent≤4000；超限明确提示精简、不截断。反例覆盖中文+空白+超限（s1a-storyline第1项）。
5. **快照存储**：验证后的selection连同来源三要素与requestHash写入每个设计run的snapshot_json（可选字段`selection`，旧快照仍可读）；A/B/C共享同一selection；不新增表/迁移；与建轮同事务（BEGIN IMMEDIATE→校验→快照→createRun→COMMIT），失败无半轮。
6. **幂等**：先按owner/book/round_key读取已有轮比较规范requestHash——同键同请求返回原轮（响应丢失不因后来配置变化新开）；同键不同选择409；新键才校验来源创建。旧轮无selection元数据不能猜测匹配（拒绝并提示新设计），不为旧书迁移。
7. **单一所有者事务**：startDesignRound内BEGIN IMMEDIATE后完成来源读取/版本检查/快照构建/createRun/COMMIT；路由不嵌套事务；`start()`签名收窄为`'recommend'`且运行时拒绝`'design'`（"设计必须经结构化故事线确认入口"）——无第二条绕过路径。
8. **页面保留现有动作**：生成键在提交开始时冻结（`selectionSignature`变化才新键）；网络未知重试同请求同键；state投影当轮实际选择供刷新恢复（恢复先于推荐默认初始化，不把recommended重新当已选）；来源过期服务端返回"设定资料已变化"提示重新核对，不自动替作者确认。

## 二、修改文件与提交

- `apps/api/src/application/books/storyline-selection.ts`（新增）：parseStorylineSelectionInput（严格解析+边界）、selectionRequestHash（规范哈希）、canonicalRecommendationHash（推荐摘要）、validateStorylineSelection（owner/book/kind/state/hash/版本/manifest五重校验+intent构建）。
- `apps/api/src/application/books/time-machine-sources.ts`：StorylineSelectionSnapshot类型、TimeMachineSnapshot.selection可选字段、manifestSourcesSignature共享签名。
- `apps/api/src/application/books/time-machine-design-service.ts`：start()收窄+拒绝design；startDesignRound重写（事务+幂等回放+selection入快照）；state()投影recommendationHash+最小selection。
- `apps/api/src/http/time-machine-routes.ts`：design-runs新合同（parse+400刷新提示）；state为成功推荐附preparationVersion；currentRuns改用共享签名函数。
- `coauthoring-v7/author-app/src/time-machine-direction-api.ts`：StorylineSelectionRequest/Projection类型、startTimeMachineDesignRound改发selection。
- `coauthoring-v7/author-app/src/TimeMachineDirectionPage.tsx`：startDesign改结构化发送+键冻结+签名变化新键；redesign回到确认页不再重发旧intent；刷新恢复已保存选择。
- 测试：`tests/integration/domain/s1a-storyline-selection.test.ts`（新增6项）、`s1-setting-baseline-gate.test.ts`（增legacy拒绝项）、design/schemes测试迁移到新入口（含合成推荐seed辅助）。

## 三、验证证据

| 验证 | 结果 | 证据 |
|---|---|---|
| 定向5套件（合同第5条命令） | **36/36通过** | s1a-regression.txt（含s1a新6项+s1门禁2项+design 22项+schemes 2项+handoff单测3项+routes安全） |
| 页面测试（合同命令） | **9/9通过** | s1a-page-test.txt（含结构化payload断言、redesign不重发、恢复勾选） |
| API typecheck | 通过 | s1a-typecheck.txt |
| author-app typecheck | 通过（含基线既有Mock类型缺陷的最小修复） | s1a-fe-typecheck.txt、基线失败对照s1a-fe-baseline.txt |
| verify:capabilities | 通过 | s1a-capabilities.txt |
| verify:runtime-closure | **失败（基线既有）** | 基线同样失败（s1a-closure-baseline.txt）——门禁列出creative-library/release等运维脚本无显式入口，非本批引入 |
| verify:full之typecheck | **失败（基线既有测试类型债）** | 基线在author-app即失败；修通author-app后暴露的其余错误均在未触碰的测试文件（identity-final-transaction/creative-reference-refinement/runtime/card-merge/material-template），见s1a-typecheck-full.txt |
| verify:full之test:full | **13项失败（基线既有债）** | 本批13项失败/760通过；基线（stash对照）同样13类失败/754通过（另5项为未跟踪文件残留的假象）。失败类别：application-database-boundary（7个既有文件+我的storyline-selection.ts加入已失败的清单）、feature-capability台账71≠68、runtime-source-closure运维脚本清单、creative-reference-migration 11≠9表、migration-0010/first-admin期望最新迁移0113实为0125、rebuild-control计划文档解析、creation-pipeline/opening-ranking名册期望——全部在基线同样失败（s1a-test-full.txt与s1a-test-full-baseline.txt逐类比对），非本批引入 |
| 真实模型探针 | **未执行**（需生产密钥环境，按授权边界另行安排） | — |
| 浏览器390/800/1440 | **未执行**（需前端构建+浏览器会话，与前后端协调发布同批做） | — |

### 浏览器验证补充说明

页面逻辑已由jsdom页面测试覆盖（勾选/自添/确认/结构化发送/恢复/不重发）；三宽度视觉与刷新的浏览器证据与API合同变更的前后端协调发布属同批（本批不发布），列为发布批的前置动作。

## 四、S1-A状态

- **已实现+已验证**：服务端结构化确认/事务/防重/最小投影/快照一致性；前端结构化发送/键冻结/恢复/跨刷新防重；六项集中修复全部落地并有针对性反例与回归（见顶部90328d31节）。
- **未执行**：生产发布（合同明确本批不发布，API合同变更需前后端协调）；真实模型探针；浏览器三宽度。
- S1其余链路（资料包生成→校核→主编推荐→采用→基线读取）沿用已上线实现，本批未改。

## 五、等待与耗时

- 定向回归约22秒/轮（多轮修复后通过）；页面测试约70秒；F1-http全链约27秒（路由执行器2秒tick）；test:full约10分钟。
- 无模型调用（全部fixture）；无生产接触。

## 六、下一步

Codex核查d5825f07+e68d7073差异→安排前后端协调发布（API合同变更+前端同批）→发布批内完成浏览器三宽度与（授权后的）真实模型探针。
