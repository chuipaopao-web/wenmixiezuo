# 四路混合检索编排设计增量验收

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- `design_review_id`：`DR-20260718-02`
- 任务：`DESIGN-20260718-08`
- 决定：`DEC-019`
- 核心提交：`b10630c docs: finalize four-channel retrieval orchestration`
- 验收日期：2026-07-18
- 执行与复核：当前Codex单独完成；按老板规则未调用其他开发Agent。

## 1. 验收结论

结构化事实、FTS/BM25、LanceDB向量和SQLite Wiki/关系的组合不再采用模糊的“全部召回后加权”。正式合同现在要求先做权威、三轴时间、实体和权限硬过滤，再按查询意图选择四路；结果分成H硬约束、E证据和I灵感，H不参加RRF，E/I分别融合。同源父子块、阶段摘要和Wiki只形成一个证据簇，关系只从已消歧种子有界扩展，确定性结论必须回查正式事实或最小原文。

方案覆盖500万规范化中文字符、1500章的活动工作集、阶段触发下钻、九岗位检索剖面、本地候选与模型Token分计、投影水位降级和创造性非劣效。E0起始Top-K、关系深度/扇出、RRF和闭环上限全部版本化，不能在独立金标前冒充最优。

本增量仍是E0文档设计，不修改业务源码、迁移、运行数据或模型配置。查询计划、四路适配器、LanceDB、融合、证据闭环和E1—E4运行证据仍未实现，不得声称产品已经具备最终混合RAG。

## 2. Skill影响

| Skill | 设计影响 |
|---|---|
| `wenmi-longform-quality` | 加入四种模式、H/E/I分层、自由创作区、旧文去锚和创造性非劣效 |
| `memory-systems` | 加入权威来源、实体消歧、三轴时间、冲突/无答案和派生可重建边界 |
| `context-compression` | 加入输出预留、最小充分上下文、硬资料不截断和本地候选/模型Token分计 |
| `systematic-debugging` | 将首次三项测试失败追溯为受限环境回环 `EACCES`，没有修改业务代码掩盖症状 |
| `verification-before-completion` | 在提交前后保留完整命令、退出状态、失败边界和干净工作树复核 |

Skill文件哈希和两轮设计审查保存在 `docs/HYBRID_RETRIEVAL_ORCHESTRATION.md`。Skill只是设计与验收门禁，不进入产品九岗位运行时上下文。

## 3. 测试与证据

| 门禁 | 命令或检查 | 结果 |
|---|---|---|
| 官方Skill结构 | Skill Creator `quick_validate.py`；PyYAML只临时安装到系统Temp并已清理 | `Skill is valid!`；未增加项目依赖 |
| 专项设计审计 | `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/HYBRID_RETRIEVAL_ORCHESTRATION.md` | `PASS` |
| 文档差异 | `git diff --check`、占位/冲突扫描、引用检查 | 通过 |
| 全量门禁 | `npm.cmd run verify` | 类型检查通过；63个测试文件、132项测试通过；API/Web/Worker构建通过 |
| 迁移/隔离/恢复 | 迁移、Repository、任务/正文恢复和备份恢复11个目标测试文件 | 11个文件、19项测试通过；本增量无Schema变化 |
| 提交前发布功能验收 | `npm.cmd run acceptance` | 3个文件、3项功能测试通过；审计仅按预期报告工作树未提交 |
| 提交后发布验收 | `npm.cmd run acceptance` | 3个文件、3项测试通过；审计 `failures: []`、工作树 `clean` |

第一次受限环境全量测试中，SSE、HTTP真实取消和Worker等待三项失败；错误分别直接或连带指向临时 `127.0.0.1` 连接被拒绝，核心错误码为 `EACCES`。相同代码和相同 `npm.cmd run verify` 在允许本机回环后63/63文件、132/132测试和三应用构建全部通过，确认根因是执行环境权限而非业务回归。

## 4. 安全、恢复与回滚

- 未读取、修改、停止或重启 `D:\AI智囊团`。
- 未读取或写入API Key，未调用真实创作模型或按量付费API。
- 未修改源码、迁移、SQLite、正式正文或生产数据。
- 临时PyYAML校验目录在确认绝对路径位于系统Temp后删除，没有进入Git、`package.json`或产品运行时。
- 文档回滚使用 `git revert b10630c` 及本证据提交；未来运行时可分别回滚Top-K、RRF、关系预算、重排和灵感模板，不回滚正史、安全、版权和隔离门禁。

## 5. 剩余证据边界

当前可以确认DEC-019的E0规格已形成可实施合同，并且没有破坏既有首版。不能据此证明向量检索已运行、参数最优、500万字实测通过或真实小说质量改善。后续必须依次取得E1机制、E2隔离/恢复/故障注入、E3独立金标/消融/满规模回放和E4真实模型纵向盲评。
