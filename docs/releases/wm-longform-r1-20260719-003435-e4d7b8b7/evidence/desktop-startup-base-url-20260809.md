# 桌面入口模型地址兼容修复证据

- 任务：DESKTOP-20260809-01
- 现象：桌面入口在数据库迁移阶段报“只允许火山方舟套餐端点：/api/coding”并退出。
- 根因：Windows用户环境遗留的通用ANTHROPIC_BASE_URL指向Agent Plan的/api/plan；运行配置把它误作Coding Plan覆盖地址并在任何启动模式下强制校验。
- 修复：Coding Plan只接受文秘写作专用WENMI_ARK_CODING_PLAN_BASE_URL覆盖；没有专用覆盖时使用固定/api/coding。专用变量填错路径仍然失败关闭。
- 安全：没有读取、输出、保存或修改API Key；没有允许普通按量端点；当前Agent Plan成员绑定未改变。

## 验证

- API类型检查通过。
- model-runtime-config与ark-plan-model共16项基础测试通过，包含旧通用地址回归和专用错误地址拒绝。
- 在同一旧用户环境变量下执行真实数据库迁移成功：Schema 35前向应用0036、0037、0038；再次启动无待执行迁移，当前版本38。
- 桌面启动脚本完成contracts、API、Worker、Web生产构建。
- 启动脚本完成API、Worker、Web和运行会话就绪检查，报告http://127.0.0.1:43110可用。
- 独立健康探针返回API状态ok；Web根页面HTTP 200且React根节点存在。