# R209-C1 内容包与导入

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
