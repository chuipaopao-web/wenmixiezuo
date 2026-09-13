# B1第二次限定返修：发布权限、冻结关系与别名

先读outbox/task-209-b1.codex-review-2.md。继续原隔离树/分支，在9c410bbb上修；原B1白名单有效，仍可修未合入0122及同模块类型/接口/测试。禁止路由/UI/生成流程、生产、模型调用、合入或B2。

按审查五个实际失败全部修正：
- 删除无鉴权publishWithStaleActive，正式publish接受显式expectedActiveReleaseId并做权限检查；缺失、陈旧预期不能自动读取最新后放行。
- 同边跨release重用合法；关系按ID+revision与清单精确对应；失败事务不留下状态、边或active改动。
- 退役不可被review/publish复活，旧release仍可读。
- alias相同请求真正幂等，目标不同必须冲突，NULL版本唯一性与并发需约束；返回值须与重新读取一致。

补真实双worker/process竞争与冻结release分页回归；允许在tests/fixtures/creative-reference内加入worker夹具，不新增依赖。不用同线程Promise代替重叠事务证据。测试正式接口，禁止为让测试通过增加权限旁路。

主树只额外授权按git对象dab354fb原文恢复.local/dispatch/inbox/task-209-b1-revision.md，保留archive；不要移动本单和任何inbox文件。Codex验收文档/探针不修改。

执行原回归+新失败场景+API类型检查；报告列真实命令、退出码、完整diff、结果commit和每条审查的证据，写原outbox/task-209-b1.result.md。任何失败明确报告，不称全过。仅隔离分支提交，完成停止等待Codex。
