# 长篇终局release验收矩阵

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 判定依据：`docs/ACCEPTANCE.md`
- 当前状态：八阶段适用E2工程门禁通过；E3/E4缺失证据按边界如实保留

| 范围 | 当前证据 | 状态 |
|---|---|---|
| 开工授权、唯一release、任务账本 | DEC-028、`RELEASE_ID`、`TASKS.md` | 通过 |
| 旧首版零退化基线 | 阶段1回归66个测试文件/139项、三端类型和构建 | 通过 |
| 空库、重复和生产升级迁移基线 | 0001—0026；正式库当前Schema 26且重复迁移 `applied: []`；完整性ok、外键0；旧版本逐级升级与隔离恢复证据继续保留 | 通过 |
| 对话附件、左右布局和归档书严格永久删除 | DEC-034、DR-20260719-12、Schema 0019、102个测试文件/221项、实机1600×900截图、Schema 18→19升级与隔离恢复 | E2通过；E3/E4未声称 |
| 阶段1安全入口与能力探针 | `stages/01-security-capabilities.md`、安全负面集、真实三进程smoke | 通过 |
| 阶段2—6数据、检索、连续性与创作闭环 | `stages/02` 至 `stages/06`、`evidence/runtime-completion-evidence.md`；真实BGE/LanceDB/混合RAG/秘书路由及五模型连通 | 通过 |
| 阶段7最终工作台与可移植入口 | `stages/07-experience-portability.md`、三进程smoke、导入导出往返、桌面入口 | 通过 |
| 阶段8规模、恢复和发布 | `stages/08-scale-recovery-release.md`、500万字符/1500章最新回放、正式备份隔离恢复、逻辑1440周期、真实启动/停止 | 通过 |
| DEC-040生产创作链真实性补缺 | `evidence/production-chain-remediation-20260720.md`；正式岗位混合RAG、三席并发、主编真实综合、事实候选、自动接管、任务/调用栅栏、增量全书清单、向量复用及旧水位保护 | E2通过；E3/E4边界保留 |
| DEC-049持续会话、最小上下文与最佳稿保护 | `evidence/persistent-creative-session-context-20260725.md`；单活动会话、双编剧有界轮次、锁定后滚动规划、试写分流、4200字符主笔包、阶段选择、质量快照/回退、Web工作区 | E2通过；E3/E4边界保留 |
| 冻结检索候选评测 | 13条冻结集：混合Recall@5/MRR/语义召回/无答案准确率=1，跨书0；同一开发者，无独立人类评测 | `E3-retrieval-candidate`，不冒充完整E3 |
| E4真实模型纵向文学质量 | 只按实际20/50/100—200/1000章跨度记录；本次五模型连通不等于纵向质量 | 尚无证据，不伪造 |

全部适用条目已经映射到实现、测试、运行、恢复或明确的证据等级边界；没有未说明跳过、blocker、major或假状态。远程代码备份以最终提交后 `origin/main` 与本地HEAD一致验证；第二物理小说数据副本仍未配置并明确披露。
| DEC-110卷驱动V2 P8—P17工程收口 | `evidence/workflow-v2-engineering-acceptance-20260809.md`；Schema 0039—0041、事件/章链/结算、上下文职责隔离、SSE、统一创作台、旧前端精简、641项全测、构建/迁移/运行/UI冒烟 | E2通过；P15条件任务未授权，E3/E4未声称 |
