# R209-A第二次限定返修：统一真实测试及报告

仅执行本文。先读outbox/task-209-a.codex-review-2.md。仍只允许修改outbox/task-209-a.result.md及outbox/task-209-a/下证据；不改业务、任务书、Codex审查，不调用模型/生产、不部署、不提交，不进入B。

1. 只保留一个权威可运行的tag-repair-engine.mts测试入口。S3修正为从tools.candidates中取kind=opening_package的实际保存content来验证tags，或显式记录gateway响应；不要从OpeningModelRequest读取output。使用bad→good→reviewPass三次输出，assert实际调用数=3、保存设计与审核候选、非空标签纠错反馈一次、最终状态。S2调用2且修复0，S4失败4且留4条attempt，S5字段区分。修复测试fixture，不改产品解析器。
2. 如果需要完整确认schema验证，只对已保存opening_package使用适当校验器；不要用开书校验器检查审查JSON。fixture需满足所断言schema，不通过则如实失败。
3. 运行上述唯一入口，记录实际退出码、stdout/stderr及生成证据。失败时不得宣称通过。旧s3-final等保留标调试，不用其exit=0替代断言。不要求重跑其他已经通过的资产计数。
4. Q03核实真实alias/定义，无同义证据改为conditional/歧义并解释；全标注relevance仅direct/conditional/none。只修已指出项，不为了验收重新设计方法。
5. 报告命令表逐项匹配最新实际结果；删除A8/改名浏览器等无关残留，统一源码种子≠实际任务供应，记录当前HEAD。以本次实际结果写结论，不沿用“全部通过”。

结束前自行复读报告与日志是否矛盾，写返修对应记录后停止。若权威脚本仍失败，报告明确阻断即可，不能切另一份脚本掩盖。Codex验收后才能进入B。
