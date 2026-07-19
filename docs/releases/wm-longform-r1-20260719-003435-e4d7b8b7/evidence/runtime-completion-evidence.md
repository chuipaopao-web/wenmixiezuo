# 运行闭环补缺证据

- release：`wm-longform-r1-20260719-003435-e4d7b8b7`
- design review：`DR-20260719-10`
- 唯一开发者：当前Codex；未调用其他开发Agent
- AI智囊团：未读取、修改、停止或重启

## 本地模型与向量

- 资产：`Xenova/bge-small-zh-v1.5`，revision `75c43b069aac4d136ba6bc1122f995fedcfd2781`，MIT，512维，量化ONNX。
- 8个文件、24,562,446字节；聚合SHA-256 `15e807c8ed3f95e7a701a43674bd6af6cb00963fac668f31fbb967d6fdd76a2d`。
- `npm run models:verify` 和 `npm run models:probe` 通过；运行时 `allowRemoteModels=false`。
- `npm run runtime:vector-e2e` 使用真实模型建立LanceDB表，FTS/向量水位为ready，四通道公开检索召回宣战规则，无答案命中0，第二本书命中0。
- 向量无答案策略为 `bge-normalized-l2-v1`：归一化向量平方L2最大0.9（约等价余弦0.55）。这是保守起始线，不声明为全体小说语料的最佳阈值。

## 冻结检索集与缺陷修复

- 金标：`tests/fixtures/retrieval-gold-v1.json`，SHA-256 `77650514cbeb50721a9f55fdcc5dac0d5b5896290cabba0f6c2454a4b85dfb09`；10份独立资料、13条精确/语义/无答案查询，在执行前冻结。
- 首次运行失败：棒球规则仅凭“规则”误命中宣战规则，无答案准确率2/3。没有放宽阈值；中文FTS改为滑动双字词元且长查询至少匹配两个词项。
- 第二轮发现FTS与向量的同一来源跨E/I车道重复；聚类键改为来源血缘，采用H>E>I的最强车道，禁止重复投票和重复注入。
- 最终：混合Recall@5=1、MRR=1、语义混合Recall@5=1、语义向量Recall@5=1、无答案准确率=1、跨书泄漏0；FTS-only与vector-only Recall@5均为0.9，混合为1。
- 证据标签为 `E3-retrieval-candidate`，因为查询集与实现文件分离且冻结，但没有独立人类评测者；不冒充完整E3或文学E4。

## 套餐模型真实连通

所有探针均在 `subscription-plan`、`strictPlanOnly=true`、`cashFallbackAllowed=false` 下执行，只保存模型身份、Token、耗时和输出哈希，不保存回复正文或密钥。

| 岗位通道 | 模型 | 输入/输出Token | 结果 |
|---|---|---:|---|
| 主编 | Codex GPT-5.6 Sol | 20612 / 7 | 成功，现金0 |
| 编剧 | DeepSeek V4 Pro | 346 / 15 | 成功，现金0 |
| 设定 | GLM 5.2 | 354 / 3 | 成功，现金0 |
| 审校 | Kimi K2.6 | 355 / 5 | 关闭隐藏思考后成功，现金0 |
| 体验 | 豆包Seed 2.0 Pro | 357 / 2 | 成功，现金0 |

## 运行、规模与恢复

- 最终 `npm run verify`：100个测试文件、209项测试全部通过；API/Web/Worker及测试类型检查和三端生产构建通过。
- 生产迁移：Schema 18，`applied: []`。
- 构建产物真实运行：API 43111、Web 43110、Worker心跳、HttpOnly会话、SQLite FTS5、本地向量能力全部ready；当前按桌面入口保持运行。
- 满规模：5本书、主书5,000,000个规范化字符、1500章、15卷、7500块；122个分布锚点Recall@5=1，跨书0；删掉7500条FTS后重建为7500条，恢复库Recall@5=1、`integrity_check=ok`、外键0；P50 0.49ms、P95 0.66ms。
- 正式数据备份：`backup-2026-07-19T12-13-21-143Z-0617d27a`；数据库SHA-256 `24179aff406cf09c9e459ef3f576d92e35b735fa86251da4b7616606d3b5d079`，清单SHA-256 `ec6e536a0310ebd5a7c552c2db4e668606a3ca53be444a916c8c3e5fe1d57112`；隔离恢复验证后删除验证副本，未覆盖正式库。
