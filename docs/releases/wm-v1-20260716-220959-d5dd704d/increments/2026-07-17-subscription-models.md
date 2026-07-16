# MODEL-20260717-01 九岗位订阅与套餐模型验收记录

## 追踪信息

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 决定：`DEC-007`
- 实施计划：`docs/superpowers/plans/2026-07-17-ark-plan-models.md`
- 岗位提示词：`docs/ROLE_PROMPTS.md`
- 唯一开发与复核人：当前Codex；未调用其他开发Agent。

## 生效模型映射

| 成员 | 岗位 | provider / model_id | 通道 |
|---|---|---|---|
| 貂蝉 | 主编 | `openai-codex-subscription/gpt-5.6-sol` | 本机Codex的ChatGPT登录态 |
| 婉儿 | 编剧 | `volcengine-ark-coding-plan/deepseek-v4-pro` | 火山方舟Coding Plan |
| 文姬 | 设定师 | `volcengine-ark-agent-plan/glm-5-2-260617` | 火山方舟Agent Plan |
| 秋香 | 主笔 | `openai-codex-subscription/gpt-5.6-sol` | 本机Codex的ChatGPT登录态 |
| 妲己 | 审校 | `volcengine-ark-agent-plan/kimi-k2-6-modelhub` | 火山方舟Agent Plan |
| 昭君 | 体验官 | `volcengine-ark-agent-plan/doubao-seed-2-0-pro-260215` | 火山方舟Agent Plan |
| 清照 | 文编 | `volcengine-ark-agent-plan/kimi-k2-6-modelhub` | 火山方舟Agent Plan |
| 道韫 | 研究员 | `volcengine-ark-agent-plan/glm-5-2-260617` | 火山方舟Agent Plan |
| 弄玉 | 版权顾问 | `volcengine-ark-coding-plan/deepseek-v4-pro` | 火山方舟Coding Plan |

“Kimi 2.7”没有可核验的方舟型号。本增量使用实际可调用、响应中确认型号为 `kimi-k2.6` 的Kimi K2.6，不伪造2.7；未来型号升级必须新增配置快照和验证记录。

## 交付范围

1. 九岗位都具有运行时权威提示词，完整定义身份、定位、职责、输入、输出、硬边界、记忆、可用能力和停止条件。
2. 主编和主笔通过临时、只读、忽略用户配置的Codex子进程调用GPT-5.6 Sol，不读取OpenAI API Key。
3. 方舟适配器只接受 `https://ark.cn-beijing.volces.com/api/coding` 和 `/api/plan`，拒绝查询参数、其他主机、端口和 `/api/v3` 按量端点。
4. 模型凭证只从进程环境读取；桌面冷启动只导入白名单用户环境变量，值不打印、不落盘；Worker和Web子进程显式移除模型凭证。
5. 现有书籍通过新增不可变模型快照切换九个当前Agent；旧快照和历史调用不覆盖。新书在建书事务中直接使用当前岗位配置。
6. 老板指定的GPT主笔记为 `owner_specified`，没有虚构盲选样稿或评分；GPT主笔与Kimi审校的来源不同，否则流水线阻断。
7. 开放讨论和章节初稿、审校、定点重写都从Agent快照解析适配器；真实调用保存上下文包、输入/参数哈希、Token、耗时、结果哈希和0现金费用。
8. 审校只接受严格JSON，空白证据、非法枚举、缺字段或越界评分不能进入正式审校记录。
9. 设置页显示脱敏运行模式、五组模型和岗位，不显示API Key；健康接口同样只返回脱敏摘要。

## 自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 模型与提示词目标测试 | `npm test -- tests/foundation/role-prompts.test.ts tests/foundation/structured-review-parser.test.ts tests/integration/runtime/subscription-model-pipelines.test.ts` | 3个文件、6项通过 |
| 设置页、健康与Codex目标测试 | `npm test -- tests/integration/experience/workspace-ui.test.tsx tests/foundation/api-health.test.ts tests/foundation/codex-subscription-model.test.ts` | 3个文件、11项通过 |
| 类型检查、全量测试、构建 | `npm run verify` | 通过；59个测试文件、117项测试全部通过；API、Web、Worker构建成功 |
| 发布验收测试 | `npm run acceptance` | 3/3通过；提交前审计仅按设计提示“工作树未提交”，其余检查通过；干净树终验在功能提交后记录 |
| 差异格式 | `git diff --check` | 通过 |

## 真实通道与桌面冷启动

- `codex login status` 确认使用ChatGPT登录态；未设置或读取OpenAI API Key。
- GPT-5.6 Sol实际返回“GPT-5.6主编通道正常。”，现金费用记为0。
- DeepSeek V4 Pro实际返回“DeepSeek通道正常。”；GLM 5.2实际返回“GLM通道正常。”；Kimi K2.6实际返回“Kimi通道正常。”；Doubao 2.0 Pro实际返回“豆包通道正常。”。
- GLM调用显式关闭思维输出，防止输出预算只消耗在不可用的thinking字段而没有正文结果。
- 使用与桌面入口相同的全新PowerShell进程冷启动后，健康接口返回 `requestedMode=subscription-plan`、`activeMode=subscription-plan`、`missingCredentials=[]`、`profiles=5`、`cashFallbackAllowed=false`；Worker为 `ready`。
- 生产工作区实际返回1本书和9个当前Agent，九个 `provider/model_id` 与上表完全一致。

## 迁移、隔离与恢复

- 现有库执行 `npm run migrate`：Schema 9，`applied: []`。
- 空目录 `data/verification/subscription-models-empty-final` 首次执行应用 `0001` 至 `0009`，第二次执行 `applied: []`；现有库和空库均 `quick_check=ok`、外键违规为0。
- 当前数据库有1本活动书、9个当前Agent；模型快照只追加不覆盖，所有当前指针均指向本次指定模型。
- 真实恢复验证：备份 `backup-2026-07-16T22-14-20-232Z-925095e2` 状态为 `verified`，恢复副本通过数据库哈希、完整性和外键检查。
- 本增量没有修改、停止或重启 `D:\AI智囊团`，也没有形成对它的运行时依赖。

## 安全、限制和回滚

- 现金按量回退固定关闭，模型适配器返回和调用账本的现金费用固定为0；真实套餐不可用时失败关闭，不改走付费API。
- API Key未进入源码、SQLite、日志、上下文包、前端、备份清单、导出或Git；错误信息会移除密钥和代理URL中的用户信息。
- 当前模型调用不直接联网或调用工具；岗位“可用能力”只描述平台随任务注入的只读材料，避免伪造工具执行。
- 代码和文档可对本增量功能提交执行非破坏性 `git revert`；环境回滚可把 `WENMI_MODEL_MODE` 改为 `deterministic`。历史模型快照、正文和调用记录不删除；如需重新切换模型，新增后续快照。

## 代码复核

- 已复核Windows进程启动、环境隔离、端点白名单、取消与超时、错误脱敏、预算冻结、上下文包注入、快照隔离、主笔/审校独立性和审校解析边界。
- 修复了Codex `.cmd` 在Windows下的 `spawn EINVAL`、方舟调用缺少内部超时、GLM只有thinking无正文、真实章节提示缺少上下文包、Codex输入Token冻结不足，以及桌面冷启动退回确定性模式等问题。
- 独立复核后无Critical或Important遗留。
