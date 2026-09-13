# R209-A第二轮验收：关键证据未通过

Codex复跑`node --import tsx .local/dispatch/outbox/task-209-a/probes/tag-repair-engine.mts`，实际exit=1，在第145行报“S3第三次调用无输出，脚本假设不成立”。报告中的exit=0与“全部assert通过”不成立。该失败来自测试读取请求对象的output字段：generateCalls保存OpeningModelRequest，本身不包含模型响应；第三次请求还是审查调用，不能用它验证纠正后的设计包。

已接受的改进：原任务书已恢复，当前跟踪文件未见删除；真实模型根因结论已降级；运行可用性已区分源码/种子/实际任务；覆盖不再全判零。实际文档仍有“当前供给真身”等残留措辞，应统一为源码默认种子，未读取生产数据不能确认当前启用。

其他证据问题：
- s3-final.mts没有assert，捕获失败后仍正常退出。S3脚本队列为bad,good,good,good,reviewPass，向审查岗位提供开书包；repair-scenario-final.json实际5次调用，中间有“审查结论不能为空”修复及换员，不是干净的标签一次纠正路径。
- 报告仍声称S2/S3/S4断言通过，不能把备用无断言脚本成功当成原脚本通过。
- Q03仍以four-act字面key证明“四幕式”同义，definitionBasis称“title即四幕结构”，但title实际为起承转合。必须按库实际别名/定义决定；无证据标为有条件参考或查询歧义，不作为精确同义金标准。relevance还出现未声明的direct-with-caveat，应统一枚举。
- 报告“首轮A1/A8、A2改名浏览器”不是本批核查项，应移除无关残留；本批HEAD信息要基于实际git读数，不沿用首轮数字。

结论：A3验收仍失败；本批已修内容保留，不重新盘点全库，但B批继续暂缓。没有新增生产诊断结论，无产品修改、无上线。
