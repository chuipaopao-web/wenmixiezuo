# B1第三轮验收：剩余两项阻断

基于de914acd。Codex独立复跑五文件35项测试，exit=0。上一轮五个发布/别名缺陷的实现及对应回归已修正；本轮不要求重做。

1. 真并发证据仍不成立：creative-reference-revision2.test.ts写`const results = [run('proc-a'), run('proc-b')]`，run使用spawnSync，第一个完成后第二个才开始。worker头注称hold-release/sleep350ms，实际代码没有该模式或持锁屏障。这是串行两个进程，不是并发。需异步spawn/worker+可观察的锁持有/竞争信号，不能靠同时启动或睡眠猜测竞争。
2. 冻结分页cursor未绑定release：listReleaseEntries与memberListRelease参数仅{lastInternalId}，没有releaseId或指纹，更没有失配检查。注释和报告说“cursor绑定release”与代码相反。应返回带releaseId/筛选指纹的游标，并拒绝跨release或参数不合法的使用，限制limit且保持旧快照结果不变。当前测试只查active改变后旧release第一页，没有跨release游标测试。

主树本轮未见跟踪文件删除。结论仍暂不合入，B2未放行；仅修两项，保留已通过实现。语义质量与生产接入继续为本批范围外。
