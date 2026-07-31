# 设定大纲术语与模型资料包验收证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260801-public-setting-outline-language-v1`
- 日期：2026-08-01

## 根因与修复

- 根因：开放对话把内部 `story_bible` Artifact JSON、来源编号、空决定数组和资料包哈希原样发给模型，而作者输出层没有当前产品术语投影。
- 修复：内部类型、原始消息和ContextPack完整保留；模型输入只使用中文资料名、用途和自然语言摘要；新回复和历史读取统一投影为“设定大纲”。
- 权威修正：开书资料和未确认设定是可修订规划，不是正史；只有规划证据时使用“规划差异”。

## 自动化结果

| 门禁 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 通过，API/Web/Worker/测试类型均无错 |
| `npm.cmd test` | 通过，133个测试文件、490项测试全部通过 |
| 有效输出+开放对话专项 | 通过，2个文件、30项测试全部通过 |
| `npm.cmd run build` | 通过，API/Web/Worker均成功构建 |
| `npm.cmd run migrate` | 通过，正式库版本34，待应用迁移0 |

## 当前书实机验证

- 书：《少女的实验笔记》，`book_id=ba9883f0-dd34-4557-a232-22ef0e3db082`。
- 重启文秘写作自身API、Worker和Web后，API健康状态 `ok`，Web HTTP状态200。
- 读取4条当前对话消息；作者响应中 `故事圣经` / `story_bible` / `premise` / `sourceId` / `confirmed_decisions` / `contextPackHash` / 来源编号匹配数为0。
- 返回内容保留真实创作结论、依据、风险、问题和下一步；旧规划误判话术按已知句式投影为“规划差异”，没有删除真正的正史冲突能力。

## 数据与回滚

- 没有修改、删除或覆盖历史消息、模型调用、Artifact版本、正文或正史。
- 内部兼容类型和存储标题维持不变，避免同名Artifact唯一键冲突。
- 回滚只需Git恢复资料包和作者投影层，不需要生产数据恢复。
