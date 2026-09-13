# R209-C2：创作库逐条内容复核（GLM执行，Codex验收）

## 目标与当前事实

C1已由Codex直接实施并录入生产542条**草稿**：346方法来源、128旧创意、38新题材入口、30跨题材判断。不能报告“正式全题材库完成”。本任务只交付内容修订与独立复核结果，不接D/E、不部署，不调整模型或页面。

老板要求以新书为准，不处理旧书状态，不删除任何用户书籍。旧创作资产与旧书是两回事：有效方法要保留。当前生产API/Worker正常，严禁操作服务。

## 先读与固定输入

1. `AGENTS.md`、`HANDOFF.md`和`coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md`第3—8、13、18、19及R209-C合同。
2. `scripts/creative-library/README.md`。
3. `scripts/creative-library/generated/seed.json`（SHA256：ef065f3dab1b196cac7b1cff0e473de9024cc443fc928963a60c1b5a910148a9）及`content-audit.json`。
4. `apps/api/src/application/creative-reference/types.ts`、`usage-tree.ts`、`validation.ts`。只读，不能修改schema来迁就内容。

只从这些输入工作，不查作者作品、凭据或生产数据库，不调用额外付费API，不重新爬平台内容。所有内容为编辑建议，不虚构用户调查、模型实测或资料来源。

## 执行范围

本任务允许输出到`.local/dispatch/outbox/task-209-c2/`和`.local/dispatch/outbox/task-209-c2.result.md`；产品代码、源种子、生成种子、库状态和正式规格均只读。输出内容修订方案，Codex验收后负责应用。不要另开一套资产库或修改旧方法引擎。遇到额外工程问题记录，不顺手改。

逐条读取542条内容，不按正则/名称/旧layerHints直接得出语义结论。可分批处理并持久化完成记录，但不能只抽查后宣称全部正确。

### 方法346条

- 解释是否真的对应名称？缩短应保留条件与关键动作，不是只换同义词。
- 按内容判断适用层级：opening/setting/book/volume/chain/chapter/prose；不再使用旧book_backbone等值。宏观节奏可用于完整小故事，不能一律只适用全书；描写、对白、视角等要区分上层规划与正文执行，不强行排除其规划用途。
- 每条写一句实际使用条件和一句误用边界。`method.instruction`写操作要点，`boundary`写条件/误用；`usageTree`用现有八主类或已有子类之一。
- 原旧库338＋后补8共346来源；旧运行341是合并5条后的视图。两套合并清单互有差异，必须重新判断。组合/更窄场景不自动等价于通用方法。保留每个来源键的去向；有实质差异就独立保留，重复才提merge到真实目标，附理由。
- 不物理删除、不自行改已分配编号，不虚构最终数据库ID。合并仅输出建议，执行者不直接改关联或退役卡。

### 参考196条

- 128旧创意补真实使用情境、提问、可选发展方向和误用边界；作者不想要外挂时不能把金手指卡强塞进去。
- 独立复核Codex写的68条；不要因为Codex写的就默认通过。题材不等于所有读者统一偏好；不强制恋爱、复仇、称帝、毁灭危机和固定节拍。
- 38题材入口不是子类型穷尽；逐行记录哪些子方向已有实际可用内容，哪些需要补卡。不得一个“成长”卡覆盖全部打完成。
- 横向机制检查：穿越、重生、回归、系统、无敌、弱起点、隐藏/互换身份、时间循环、无限/多世界、快穿、空间、直播/通信、召唤/御兽、非人、模拟经营、群像、多主线、单元、反套路、衍生；先核对128旧卡是否已有，不为凑数量重复创建。
- 新增卡仅在确有语义缺口时提出。参考relatedCards/methodRefs用本批种子键在提案层关联，另列引用表；不得把这些种子键冒充产品内部ID写入正式payload。Codex应用时解析真实ID/版本。
- 不输出模型思维链，提供简短可核对的结论、理由及必要反例即可。

## 交付文件（机器可读，UTF-8）

1. `reviews.json`：schemaVersion=1，reviewer真实写GLM5.3，sourceSeedSha256；entries每条包含seedKey、decision（keep/revise/merge-proposal）、reason、issues数组、proposedPayload（无修订可null）、mergeTargetSeedKey（非合并null）。542来源键恰好一次，不能遗漏/重复。
2. `additions.json`：新增候选的temporaryKey、payload、gapReason、相似已有键与区别。无必要新增可空数组，不追求数量。
3. `relations.json`：fromSeedKey、toSeedKey、type（supplement/fusion/related_method）、reason。不能指向不存在对象；不要全连接。新卡用temporaryKey且明确候选。
4. `coverage.json`：38题材和横向机制分别列已有键、缺口、建议动作；不要仅计数。
5. `validation.txt`：实际运行的结构核查命令/退出码、source hash、原键集合相等、payload校验、引用目标存在、分类有效、短语≤30字符/摘要≤500字符等结果。结构通过与内容判断分开。
6. `task-209-c2.result.md`：实际处理数量、修改/合并/新增数、剩余缺口、文件清单、未做事项。禁止把待审提案描述成已入库或已发布。

## 内容验收反例

- 三国送外卖：职业能连接名将、军需、救援、阵营变化；不能永久跑腿，也不默认加入美女或称帝。
- 温暖小店：关系、小愿望与日常变化成立；不强制毁店或世界危机。
- 无外挂悬疑：以证据/假设推进；不能新增读心系统解案。
- 多主线群像：人物有独立目标与因果；不必平均戏份或最终全部交汇。
- 起承转合：全书、卷、链、章可在完整故事尺度参考，不绑定4卷，不把任一章都强制完整四步。
- 视角与声音：上层可规划信息分配与人物声音，正文落实表达；不能据此允许生成成员写当前任务范围外的正文。

完成后停止，等Codex验收。不要自动接检索、发布或下一批。
