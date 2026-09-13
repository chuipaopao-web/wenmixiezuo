# B2返修复验：仍不通过，限定事务隔离和服务边界收尾

对象7e1316f1。Codex独立复跑六文件42项通过，exit0，23.41秒。前轮单次审核/发布回滚与用途/关系/分页的正式反例均通过，本轮不要求推翻或重做这些修复。手机r2-05截图已目视核对，创作库页签完整可见，无前轮重复页头伪影；这是本地截图证据，不是生产开放。

## 1. 共享transactionDepth误合并独立请求（阻断）

仓储80–100行以实例级transactionDepth判断是否嵌套，但runInImmediateTransaction允许await。路由只创建一个repository实例供全部请求使用。请求A持事务等待时，请求B看到depth>0就直接执行，被错误并入A；B能返回成功，随后A回滚把B一起撤销。
独立探针`task-209-b2.concurrent-probe.mts`实际输出：secondReturnedSuccess=true，existsBeforeOtherRollback=true，existsAfterOtherRollback=false。执行命令：隔离根`node --import tsx D:/wenmixiezuo/.local/dispatch/outbox/task-209-b2.concurrent-probe.mts`，临时合成库。不是理论风险。
需区分同请求嵌套与独立请求：可采用不跨await的同步SQLite事务工作单元，或请求归属+连接串行化；不能仅用一个共享深度变量，也不能只加AsyncLocalStorage而仍允许其他请求使用同一连接未提交事务。隔离还要覆盖并发读，不能返回稍后被回滚的未提交数据。

## 2. BEGIN失败污染实例状态（同一事务修复范围）

当前depth=1和BEGIN在try外；BEGIN因锁忙失败不会finally复位，下次调用会跳过开事务。应把开事务失败也纳入恢复，确保下次仍正常开启/提交/回滚。补第二连接持写锁→BEGIN失败→释放锁→同实例重试及故障回滚断言。

## 3. 管理应用服务绕过原授权边界

admin-service直接依赖两个具体SQLite仓储类型，且只接收{actorId}，没有原服务的授权端口。HTTP检查管理员是必要的，但不能把应用服务授权删掉；普通调用者直接传一个actor字符串即可写库。任务原本明确两层校验和Repository接口方向。补管理服务授权校验及窄Repository/事务端口，注入具体适配器；不用另建身份系统。所有管理写入验证未授权/空actor拒绝且零副作用。

未合入、未部署。不扩大其他UI/生成/模型范围。下一轮以本文件三项及既有回归为准。
