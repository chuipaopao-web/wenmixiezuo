# R209 创作库内容整理与导入

## C2-M最新状态（2026-09-13）

Codex逐条阅读346方法来源后明确归类，合并5组同义内容，新增8条创意/卖点/阅读期待判断方法。现用349条，另保留5条退役来源、196参考卡。所有方法有编号、用途子类、适用阶段、具体做法、条件及误用边界。内容已入生产；状态仍为草稿，没有伪造独立审核。旧GLM C2任务已撤回。

- `method-review.ts`记录逐项分类、修正与合并判断；不是从关键词推断语义。
- `build-method-review.ts`对冻结C1种子hash及346来源覆盖进行校验，生成`generated/method-review.json`和sha256。阶段用法存于已有method.boundary的中文标记行，具体方法说明仅存一次，不重复膨胀上下文。
- `apply-method-review.mjs <release-source> <db> <plan> <sha256> preview|apply`使用现有管理事务写新revision及审计，保留旧号别名，5条来源退役而非删除。实际编号从仓储读取，不假定法001开始；后台人工修改冲突则整批回滚。重复执行无新增。
- `verify-method-review.mjs <release-source> <db>`通过管理仓储验证349/5数量、用途父子查询、阶段组合及旧号查询。生产证据在当前API release的`content-r209-c2/`。
- 28项测试通过（13内容/事务，15前端/API客户端）；类型检查、构建及公网14文件hash通过。浏览器连接超时，未冒称真人点击或移动端视觉验收。
- 后台入口统一为创作库，按8用途主类→细分用途→阶段筛选；运行中的旧供给尚待D/E替换，不在本批删除。UI发布不代表AI检索已接入。
- 后续分卷VP-01已定：默认6—10卷、单卷预算上限50万字，500万字10卷；阶段职责不机械绑定卷数。唯一规格docs/TIMEMACHINE_STORY_DESIGN.md第24节，后台RB-22待开发，不在方法库重复配置，尚未实施生成逻辑。

以下为C1原始导入过程，不能作为当前内容状态。

当前内容是**待审草稿**，不是已审核正式库。Codex编写68张参考候选（38题材入口＋30跨题材判断），保留原338方法及后补8方法、128创意来源。共542条。原运行341方法是346来源减去5条历史合并；此批尚未确认合并，不删除任何来源。

唯一实施状态见`coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md`的R209-C合同。C2必须完成逐条简介/适用范围/误用边界、语义合并、引用、机制和题材子方向缺口及独立内容审核；没有这些证据不能发布全部草稿。后台数量不等于AI可用数量。

## 可重复构建与验证

```powershell
node node_modules/tsx/dist/cli.mjs scripts/creative-library/build-seed.ts scripts/creative-library/generated
node node_modules/vitest/vitest.mjs run tests/unit/creative-reference-seed.test.ts tests/unit/creative-reference-numbering.test.ts tests/integration/security/creative-reference-admin.test.ts
```

`generated/seed.json`为冻结可导入内容；`seed.sha256`校验上传完整性；`content-audit.json`保留每条旧来源和两套合并候选，不含作者资料、凭据或模型推理。编辑候选正文在`editorial-seeds.ts`，原库引用仅用于离线构建，生产导入命令不依赖旧书或旧资产模块。

## 运维导入

命令由已授权本机/服务器运维身份执行，不新增HTTP接口，不向成员开放数据库。使用当前API构建内的仓储及管理服务；actor为`codex-r209-c1-import`，不得冒充独立审核人。输入为初始化完成且含0122/0123的数据库，命令不运行迁移。

```text
node import-seed.mjs <release-source> <database-path> <seed.json> <sha256> preview
node import-seed.mjs <release-source> <database-path> <seed.json> <sha256> apply
```

先用合成库检查与当前生产相同构建的导入，再生产preview→核对数量→apply→重复apply验证零新增。preview执行同一事务但回滚，包括计数器和审计；返回的临时内部ID不用于后续引用，apply结果才是正式映射。单批事务失败全回滚；同键不同内容拒绝；后台后续编辑不被重复导入覆盖。只有新建草稿与create审计，无审核、发布、退役、删除或活动版本切换。生产不重启API/Worker。

## C2交接必须遵守

按每条种子键核对，不按名称或卡片数量决定语义合并。原宏观节奏可适用完整的小故事，但不得自动供给所有层；表达技法也可在上层规划其使用原则，需写明用途而不是一律禁止。人物动机、群像、关系与反派不采用统一模板。所有阅读体验均是可选方向，不能断言某题材所有读者都喜欢同一种欲望。

未经核查不能把`legacy-unreviewed`批量改为已审核。68张新参考也须独立复核；同一个Codex的自查不伪装成另一个模型。修订采用新revision，不删除作者在后台的编辑。正式发布前记录条目清单、审核者真实身份和意见、关系目标存在性及活动版本预期值。
