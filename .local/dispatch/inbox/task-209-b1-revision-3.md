# B1最后两项限定返修

继续原隔离树/分支，从de914acd提交后追加修改，不reset。先读outbox/task-209-b1.codex-review-3.md。仅修两项：

1. 将spawnSync顺序测试改为真实独立进程竞争。用异步spawn/worker_threads及IPC/消息屏障，明确证实A持有BEGIN IMMEDIATE写锁时B尝试同库写入，然后释放并检查结果、编号及状态。不要通过“两个进程启动了”断言重叠，不用固定sleep替代就绪信号。夹具仍在tests/fixtures/creative-reference，使用现有Node内置能力，不加依赖。测试需有超时清理并回收子进程，避免留下持锁程序。
2. 冻结分页服务/Repository/types返回明确nextCursor，游标带releaseId（有过滤则含过滤指纹）和位置；服务校验与请求release一致，拒绝跨release、坏游标与非法limit；到末页nextCursor=null。测试：r1页1cursor用于r2必须拒绝；active改到r2后r1连续分页仍完整无重复；末页、空清单行为与limit边界。不要再用调用方手造位置代替真实返回游标。

允许修改原B1白名单内上述相关类型/服务/Repository/测试与worker夹具；不改其他产品，不接B2、不部署。任务书不移动不修改。更新原outbox结果报告，删去旧并发/游标误报，列真正测试命令和结果；跑相关回归与API类型检查。仅隔离分支提交后停止，交Codex验收。
