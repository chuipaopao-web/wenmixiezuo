# B2第三轮复验：提交失败恢复尚未闭环

对象6d223a12。同步事务方案消除了前轮合法管理调用中的跨请求await；授权端口与应用层接口也已补齐，API类型检查exit0。前轮UI不要求重做。

## 必修：COMMIT异常不回滚、不复位

仓储runInTransaction的COMMIT在try/catch之外；COMMIT抛错后transactionDepth仍为1，数据库事务仍可能开启。下一次runInTransaction误认为嵌套，返回成功却不提交。报告声称“COMMIT/业务失败路径finally复位”与实际代码不符。

Codex探针`task-209-b2.commit-probe.mts`在临时SQLite使用DELETE journal模式，第二连接持读锁令COMMIT产生SQLITE_BUSY；释放读锁后同实例第二次操作返回成功，但外部连接仍被锁、两次写入仍挂在旧未提交事务。实际输出：commitError=database is locked，retryReturnedSuccess=true，sameConnection=[1,2]，otherConnection=database is locked。该场景证明工作单元异常恢复不完备；不宣称生产WAL已发生此锁路径。生产的磁盘/IO等提交错误同样必须安全处理，不能用部署模式掩盖遗漏。

修复：BEGIN、执行、COMMIT的异常出口统一处理；任何提交失败都不返回成功，尝试回滚并保证实例状态与连接真实状态一致。回滚本身失败时使连接不可继续写或明确隔离/关闭，不清零后继续误写。添加COMMIT失败→同实例重试持久化→独立连接可读且无首笔残留的测试，以及操作异常后恢复测试。

## 测试证据不一致（需核实，未定为新代码回归）

六文件独立复跑实际44/45：双try进程并发创建okCount=0，exit1。随后单独`-t 双try`通过，exit0，属于时序相关失败线索，不能直接说稳定通过，也不能删除断言。检查子进程错误输出/迁移与创建的并发阶段，记录根因；原夹具已有问题则如实归属，可作最小夹具修复，不改业务放宽断言。

未合入、未部署。其余已通过的B2功能不重做。
