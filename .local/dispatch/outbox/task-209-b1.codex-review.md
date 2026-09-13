# R209-B1验收：不通过，禁止合入或进入B2

审查结果commit b712325a，隔离树task-209-b1。Codex复跑四文件20 tests全部通过，但独立内存探针发现下面实际缺陷。原测试通过不能证明完整合同通过。

复现入口：`.local/dispatch/outbox/task-209-b1.codex-probe.mts`（仅内存库，真实本批类）。运行`node --import tsx .local/dispatch/outbox/task-209-b1.codex-probe.mts`。

## P1必须修复

1. **用途/层级筛选直接失败。** repository.listAdmin查询cards表的payload_json，但该列在revisions。实际layers=['volume']及usageTree='结构与节奏'均报no such column。应关联目标revision，并对明确JSON字段过滤，不用整个JSON LIKE误匹配描述文字。测试没有传这两个筛选字段。
2. **旧快照被退役状态破坏。** setStatus原位更改revision.status；memberReadExact又读取该可变状态。探针发布revision1后退役，旧release从found变notFound。应区分当前可用状态与冻结版本资格，退役禁止新选择但旧release仍可读。
3. **新内容绕过审核。** updateCard继承card.status，已发布卡更新后新revision仍published，reviewActor=null；探针无需审核即可publish新版。setStatus还允许draft直接published且未维护审核证据/expectedVersion。必须实现明确状态转换与版本并发规则，新内容进入draft，已发布内容保持不可变，审核与发布有actor证据。
4. **同实体旧引用被重复发号。** importLegacyMapping对audited-v4/complete-v3各建一张卡，实际得到法003/法004。原测试甚至断言internalId不同，违反同实体映射要求。需显式canonical目标与多别名映射；未经确认的不自动合并，但确认同实体必须一个稳定编号。不能把所有同名合并。
5. **创建幂等性随编辑失效。** 重放原create比较当前revision而非原请求；卡修改后重放原创建报“幂等键已用于不同内容”。须保存不可变请求指纹与结果，涵盖legacy/assetKind等有意义输入；事务内竞争重检，避免并发同键误报SQLite唯一错误。

## P2合同与测试缺口

6. 发布关系表为跨release唯一边，同关系再次发布将重复插入；listRelations没有release范围，不能精确返回冻结图谱。发布还未检查关系两端是否都在本release、entries是否重复及revision冲突；manifestHash依赖数组顺序，未做canonical化。发布active无预期版本保护。需要按冻结manifest保持一致并测试重复发布/并发发布和中途写失败回滚，不只是发布前输入校验失败。
7. 原“歧义”测试最终断言found，并未触发ambiguous；编号竞争允许零成功也通过；版本竞争是同线程DatabaseSync+Promise调度，不能宣称独立事务重叠。应实测双worker/process或可验证的事务竞争屏障，并断言成功/冲突类型与最终状态。按release的冻结分页也尚未体现，不能只拿管理工作区分页代替。
8. 任务书再次被移出inbox：主树git diff显示删除task-209-b1.md。该操作未授权，恢复原文，保留归档证据，不自动清理。业务主树未见本批代码修改；不推定谁执行了移动，要求说明。

其他审查注意：validation存在未被调用的legacy校验，payload.assetKind改变时未与卡类型核对；需补输入不合法与字段一致性。reference投影应保留必要适用条件，硬长度与整次预算要分清，不能为测试方便删内容。

## 验收决定

拒绝合入b712325a；保留实现供原树返修，不回退或删除GLM工作。不做生产迁移/部署。限定返修完成后重新审查上述不变量；没有证据说它已满足B1全部要求。
