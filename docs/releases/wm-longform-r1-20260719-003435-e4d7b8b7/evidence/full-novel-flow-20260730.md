# 《这游戏上线就给钱》真实十章创作流程验收

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 验收日期：2026-07-30
- 活动书籍：`85ec2145-c0e6-480a-b80c-8e62bcc45428`（《这游戏上线就给钱》）
- 目标：使用现有开书资料，经产品的设定、分层规划、逐章生产、审校、作者确认和正史结算流程，保存完整设定大纲、剧情总纲、第一卷卷纲、十份章纲和十章正文，并在前端逐页展示。
- 边界：当前 Codex 单独开发和验收；未调用开发子 Agent；未修改、停止或重启 `D:\AI智囊团`。

## 最终数据状态

| 项目 | 结果 |
|---|---|
| 开书资料 | 男频；游戏体育；游戏异界、历史脑洞；热血、爽文、成长、逆袭、群像、经营、争霸、升级；主角夏炎，22岁 |
| 设定大纲 | 60项，60项有有效正文，60项均已确认 |
| 设定基线 | 活动版本 `ff8e149d-5781-4d84-b1c6-d6b70a47a708` |
| 剧情总纲 | 活动版本 `7b8f5585-c5bf-4157-82ff-1f5347151c79` |
| 第一卷卷纲 | 活动版本 `304ce6d1-40c9-4098-8230-b10a9a3c8610` |
| 章纲 | 第1—10章全部存在并为活动确认版本 |
| 正文 | 第1—10章全部生成完成、作者确认、正史结算 |
| 正史 | `canon_revision = 10` |
| 正文字数 | 共35,054个规范化字符；单章2,956—4,183字符 |
| 正文完整性 | 10个独立正史版本；文件均存在；10章内容哈希全部匹配 |
| 前端泄漏检查 | 未显示 `content_json`、`source_ids_json`、`projection_id`、`selected_manuscript`、`artifact_type`、转义JSON或 `dynamic` |
| 数据库 | `PRAGMA integrity_check = ok`；外键违规0 |

完整机器报告保存在：

- `data/verification/full-flow-20260730/data-flow-report.json`
- `data/verification/full-flow-20260730/ui-flow-report.json`

## 前端逐页证据

以下截图均由无头Edge连接实际本地服务 `127.0.0.1:43110` 后生成，不是静态Mock：

1. `data/verification/full-flow-20260730/01-chat.png`
2. `data/verification/full-flow-20260730/02-setting-outline.png`
3. `data/verification/full-flow-20260730/03-master-outline.png`
4. `data/verification/full-flow-20260730/04-volume-outline.png`
5. `data/verification/full-flow-20260730/05-chapter-outlines.png`
6. `data/verification/full-flow-20260730/06-manuscript-chapter10.png`

可重复执行：

```powershell
node scripts/evaluation/full-flow-data-audit.mjs
node scripts/evaluation/full-flow-ui-verification.mjs
```

## 本轮实际修复

1. 作者选定的现有稿不再被正文流水线静默覆盖。
2. 设定基线和规划状态使用最新版本，避免界面回到“待讨论”。
3. 讨论恢复不再读取过期或截断的检查点资料。
4. 已结算章节在正文目录优先显示“正史已结算”，不再被旧失败任务标成“受阻”。
5. 规划页把内部 `selected` 翻译为“已确认”，并隐藏无有效内容的旧版空设定卡。
6. 应用层新增SQL移入Repository；误判为数据库调用的正则 `.exec()` 改为无歧义实现。
7. Schema 32迁移加入空库和Schema 9升级验收清单，并校验新增设定确认字段。
8. 写作命令测试恢复真实规划门禁：切换设定版本会使下游规划失效，重新确认后才能排期正文。
9. 测试夹具的作品风格版本改为递增，支持同一本书重复建立确认规划。

## 新鲜质量门禁

| 门禁 | 结果 |
|---|---|
| 类型检查 | API、Web、Worker及测试类型全部通过 |
| 全量自动测试 | 130个测试文件、458项全部通过 |
| 生产构建 | API、Web、Worker全部通过 |
| 迁移 | 正式库Schema 32，重复迁移无新增；空库与Schema 9升级测试通过 |
| 真实运行 | Web/API/Worker在线；实际书籍前端逐页验收通过 |
| 备份恢复 | 49个文件备份；隔离恢复完整性和外键校验通过；验证副本随后销毁 |
| 正式验收功能旅程 | 3/3通过；提交前审计仅按设计报告工作树尚未提交 |

## 模型与人工确认说明

- 当前书模型调用记录中，DeepSeek V4 Pro成功148次，GLM 5.2成功74次，Kimi成功39次，豆包成功39次；没有使用Codex模型完成本轮小说生产。
- 第1—3章正史稿保留GLM写手来源；第4—10章在模型草稿和三席审校后经过模拟作者修订，最终版本如实记录为 `manual / owner-edit`，没有伪装成模型原稿。
- 本次证明的是一条真实十章流程、数据闭环和作者可见性，属于短流程工程与样本质量证据；不能外推为500万字长篇文学质量已经得到E3/E4证明。
