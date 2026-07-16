# 文脉写作

这是一个与“AI智囊团”完全独立的、本地优先的小说创作平台。目标是让老板只需要通过自然语言表达想法，由多个真实Agent完成讨论、规划、写作、审校、知识沉淀、正史结算和长期一致性维护。

项目已于2026-07-16正式授权开发，按八个阶段连续实现和验收。运行数据固定保存在 `D:\wenmixiezuo\data`，与 `D:\AI智囊团` 完全独立。

## 文档阅读顺序

1. `AGENTS.md`：任何开发Agent必须遵守的规则。
2. `docs/PROJECT_CHARTER.md`：产品边界和最高约束。
3. `docs/PRODUCT.md`：用户体验、功能范围和业务流程。
4. `docs/ARCHITECTURE.md`：系统架构与模块边界。
5. `docs/DATA_MODEL.md`：数据实体、隔离键和状态机。
6. `docs/AGENT_SYSTEM.md`：9个岗位、Agent运行循环与权限。
7. `docs/MEMORY.md`：长篇小说的分层记忆和上下文组装。
8. `docs/API.md`：首版接口和事件契约。
9. `docs/DEVELOPMENT_ROADMAP.md`：八阶段实施顺序。
10. `docs/ACCEPTANCE.md`：阶段门禁和最终验收。

需要核对讨论原文时，再读取：

- `docs/SOURCE_REQUIREMENTS.md`：老板原始需求。
- `docs/FINAL_SOLUTION.md`：讨论生成的最终方案摘要原文。
- `docs/CONSENSUS_LEDGER.md`：24条完整共识原文。
- `docs/DECISIONS.md`：讨论结束后的老板最新决定。
- `docs/COVERAGE_MATRIX.md`：24条共识到开发文档的映射。

## 直接使用

- 双击 `文脉写作-启动.cmd` 启动并打开工作台。
- 双击 `文脉写作-停止.cmd` 只停止本项目登记的进程。
- 老板使用说明见 `docs/USER_GUIDE.md`。

## 开发状态

首版已进入阶段8全量验收。默认Web端口为 `43110`，API端口为 `43111`，均只监听 `127.0.0.1`；未配置真实模型凭证时使用确定性假模型，且未获单次明确授权前不产生现金费用。当前版本只保存在本地Git，未配置远程仓库。
