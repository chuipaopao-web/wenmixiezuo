# 阶段0：开工基线

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260719-09`
- 起点commit：`2587ac51b993bb7f39aa4393a96a46b5779aa5ee`
- 开工授权：DEC-028
- 结果：通过

## 环境

- Windows：Microsoft Windows NT 10.0.26200.0
- 电脑：Micro-Star International Alpha 17 C7VG
- CPU：AMD Ryzen 9 7940HX，16核/32线程
- 内存：16,299,364,352字节
- D盘：644,245,090,304字节；开工时可用485,376,086,016字节
- Node：v24.16.0；npm：11.13.0
- 远程：`origin` SSH私有仓库

## 设计审计修正

1. 激活状态由DEC-028统一，历史E0证据不改写。
2. 证据簇表统一为 `retrieval_evidence_clusters`。
3. 权威事务写 `projection_outbox`，Worker维护 `projection_jobs`。
4. 新release为11名创作成员加独立小文秘书；历史旧书9实例不改。
5. `RELEASE_ID`解析器支持版本化release族，不再硬编码首版 `wm-v1`；测试上下文从活动ID初始化，消除Worker release外键/领取连锁失败。

## 验证证据

- `npm run verify`：类型检查通过；63个测试文件、132项测试通过；API/Web/Worker构建通过。
- 初次激活回归暴露4项失败：1项release格式拒绝与3项Worker连锁失败。根因为解析器和测试数据库把首版ID硬编码；增加通用版本格式并让测试上下文使用活动ID后，原失败集5/5及全量132/132通过。
- 隔离空库：应用0001至0009到Schema 9；第二次迁移 `applied: []`。
- 现有数据：两次迁移均 `applied: []`，保持Schema 9并登记活动release；未恢复或删除生产数据。
- 长篇质量审计脚本：`PASS: docs\DESIGN_GOVERNANCE_AUDIT.md`。
- `git diff --check`：无空白错误；只有仓库换行策略提示。

本阶段只证明可以安全开工，不证明长篇新运行时已经实现。下一阶段允许范围是阶段1的本机会话、HTTP防护和能力探针。
