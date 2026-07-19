# 长篇终局release清单

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 产品：文秘写作
- 激活日期：2026-07-19
- 历史基线：`wm-v1-20260716-220959-d5dd704d`
- 起点commit：`2587ac51b993bb7f39aa4393a96a46b5779aa5ee`
- 唯一开发者：当前Codex；未调用其他开发Agent
- 数据目录：`D:\wenmixiezuo\data`
- Web/API：`127.0.0.1:43110` / `127.0.0.1:43111`
- 远程代码备份：私有 `origin`，`git@github.com:chuipaopao-web/wenmixiezuo.git`
- 现金费用保护线：0；真实密钥只读环境变量
- 第二物理小说数据副本：未配置，远程Git不冒充数据备份
- AI智囊团边界：不修改、不停止、不重启且不作为运行时依赖

## 阶段状态

| 阶段 | 状态 | 证据 |
|---:|---|---|
| 0 开工基线 | 通过 | `stages/00-baseline.md` |
| 1 安全入口与能力探针 | 通过 | `stages/01-security-capabilities.md` |
| 2 Repository与生命周期 | 通过 | `stages/02-repository-lifecycle.md` |
| 3 切片与本地语义 | 通过 | `stages/03-chunking-local-semantics.md` |
| 4 四路检索与上下文 | 通过 | `stages/04-hybrid-retrieval-context.md` |
| 5 连续性与11人团队 | 通过 | `stages/05-continuity-eleven-agent-team.md` |
| 6 正确创作闭环 | 通过 | `stages/06-creation-production-loop.md` |
| 7 最终工作台与可移植 | 通过 | `stages/07-experience-portability.md` |
| 8 全规模验收与发布 | 通过 | `stages/08-scale-recovery-release.md`、`evidence/final-scale-e2.json` |

八阶段E2工程证据已冻结，DR-20260719-10又补齐真实本地语义资产、LanceDB向量投影、公开四路检索、小文秘书语义候选、点名直达和五个订阅模型最小真实连通。冻结检索集取得 `E3-retrieval-candidate`，但因没有独立人类评测者不冒充完整E3；E4真实纵向文学质量仍未取得，不能与工程容量或连通性互相冒充。
