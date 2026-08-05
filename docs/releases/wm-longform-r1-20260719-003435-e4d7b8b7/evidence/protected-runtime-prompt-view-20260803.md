# 完整岗位提示词受保护查看验收证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260803-protected-runtime-prompt-view-v1`
- 决定：DEC-090
- 日期：2026-08-03
- 结论：功能与安全门禁通过E2工程验证；没有修改岗位提示词或任何创作输入。

## 实现结果

- 普通团队模板和本书成员详情只返回简短 `roleStatement`，不返回完整提示词。
- 受保护接口从后端实际运行提示构建器按岗位、用途生成稳定系统提示词。
- 查看密码只读取 `WENMI_PROMPT_VIEW_PASSWORD`，由服务端恒定时间比较；浏览器不持久保存。
- 错误密码、未配置、连续错误限流、跨书成员/岗位错配都有明确拒绝路径。
- 查看响应带 `Cache-Control: no-store, max-age=0` 和 `Pragma: no-cache`。
- 动态任务指令、书籍补充要求、检索资料包、工具参数、密钥、登录态和思维链不在返回范围内。
- 启动器只把密码传给API进程，不传给Web或Worker。

## 验证记录

### 专项测试

命令：

```text
npm.cmd exec vitest -- run tests/integration/security/prompt-view-access.test.ts tests/integration/experience/workspace-api.test.ts tests/integration/experience/workspace-ui.test.tsx tests/foundation/runtime-config.test.ts
```

结果：4个测试文件、50项测试全部通过。

### 类型、全量测试与构建

```text
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

结果：类型检查通过；139个测试文件、569项测试全部通过；API、Worker和Web生产构建通过。Vite仅报告既有的单块体积提示，不影响构建成功。

### 迁移与恢复

在隔离数据目录 `C:\Users\momo\AppData\Local\Temp\wenmi-prompt-view-migrate-c511bdb72bdb4cb483ea32f68135693e` 执行：

```text
npm.cmd run migrate
npm.cmd run migrate
npm.cmd run verify:backup
```

结果：第一次迁移到版本34；第二次零新增、版本仍为34；备份隔离恢复校验通过，SQLite完整性为 `ok`，外键违规为0。未操作正式数据。

### 真实HTTP运行探针

在隔离数据目录、API端口54329运行服务并完成本机会话握手：

```text
SESSION_STATUS=200
PUBLIC_STATUS=200
PUBLIC_HAS_VARIANTS=False
PUBLIC_PROTECTED=True
UNLOCK_STATUS=200
UNLOCK_ROLE=chief_editor
UNLOCK_VARIANTS=2
UNLOCK_CACHE=no-store, max-age=0
UNLOCK_FIRST_LENGTH=543
```

证明公开响应没有提示词变体；配置密码后可以读取主编两个真实稳定用途变体；响应禁止缓存。

### 正式验收与差异检查

- `git diff --check`：通过；只有Windows行尾提示，无空白错误。
- `npm.cmd run acceptance`：3项用户旅程测试全部通过，release、迁移、依赖、密钥扫描、产品名、桌面入口等检查通过；审计唯一未通过项是当前工作区包含本轮及此前尚未提交的已知修改，不能伪称“工作树干净”。该项不属于功能或安全失败，提交当前连续开发成果后需再次执行最终clean-tree审计。

## 商用边界

当前密码门禁适用于老板控制的本机部署。互联网商用前仍必须增加真实登录、管理员授权、HTTPS、审计、秘密托管和持久化暴力破解防护；环境变量共享密码不能冒充最终商用鉴权。

## 桌面运行版本错位回归修复

- 复现：正在运行的43111旧API尚未返回 `fullPromptAccess`，而新Web直接读取其 `configured` 字段，React抛出 `Cannot read properties of undefined (reading 'configured')`，团队页面被卸载为空白。
- 根因：桌面服务启动于本轮接口升级前，Web静态产物可被重新构建并立即提供，但API进程不会热加载，形成短暂的新Web/旧API版本错位。
- 修复：Web把该新增能力字段视为可选协商能力；缺失时只把完整提示词入口显示为尚未配置，岗位列表、公开职责和本书补充要求继续可用。
- 回归：新增“前后端短暂版本不一致时团队页仍能打开”测试，同时覆盖首页全局岗位模板和单书团队配置。
- 实机：重建并只重启 `D:\wenmixiezuo` 文秘写作服务后，`/api/v1/team-template` 与单书 `/team-config` 均返回11名成员和访问状态；未配置密码时 `/api/v1/prompt-view` 按合同返回409。未触碰 `D:\AI智囊团`。
