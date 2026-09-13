# B1第二轮验收：发布与别名不变量仍失败

审查commit 9c410bbb。原四文件28项测试、第一轮7项不变量探针均已独立复跑PASS，原问题的简单路径修复有效；但不能据此放行。独立复现脚本outbox/task-209-b1.codex-probe-2.mts仅使用内存库和实际源码。

## 必须修复的实际结果

1. **发布权限旁路**：service.publishWithStaleActive无context/requireManager，构造canManage=false的服务仍可成功发布。不能把测试辅助入口留在应用服务里并绕过权限。删除该方法；正式publish要求调用者显式提供其读取的expectedActiveReleaseId并验证管理权限，不得自行取最新值掩盖陈旧编辑。测试经正式接口或直接Repository隔离测试，不能新建旁路。
2. **关系无法在新release复用**：同关系A1→B1加入增加C1的新release仍INSERT全局唯一边，实际UNIQUE constraint失败。可复用同一不可变边并建立release关联，或采用明确按release存储方案；不抹去历史。
3. **关系版本不存在也能发布**：清单A1/B1/C1，边A999→B1被接受，因为只查ID。必须对(internalId,revision)成对校验属于清单且存在，关系类型/重复边也需校验；测试不存在、存在但不属于清单的revision。
4. **退役被发布复活**：A退役后publish([A1])成功，cards状态回published。review也未充分隔离可用状态。必须保证退役不影响旧release但禁止审核/发布进入新release，不允许普通操作隐式恢复；当前可用状态与revision审核状态分离要落到真实数据字段及规则。
5. **别名冲突假成功**：先把namespace/key映射B，随后同映射请求canonical=C；服务返回C而读取仍是B。已有alias必须核对目标及请求指纹，不一致ConflictError；不能只检测存在。NULL版本的SQLite UNIQUE不约束重复NULL，要正确规范化/索引处理并测试竞争。不可改变已明确旧引用含义。

## 仍未落实的验证

- 两个DatabaseSync在同一线程Promise.all不足以证明独立事务重叠，不能写“真并发已测”。上一轮已要求worker/process或事务屏障；请完成并保证至少一方真实持锁、另一方竞争。
- 冻结分页仍以memberProject单条旧版读取代替，需实现/测试release绑定列表cursor，不随active发布改变；不是管理工作区列表的替代。
- 主树再次显示删除inbox/task-209-b1-revision.md。只读任务书不得移走；恢复并说明，后续只提交允许路径。

结论：9c410bbb不合入、不部署、不进入B2。原修复保留，继续同树有限返修，不推倒整个实现。
