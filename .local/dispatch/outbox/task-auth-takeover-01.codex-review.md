# AUTH-TAKEOVER-01 Codex验收：不通过，返工

2026-09-14；审查提交281e1749，对照5edad171及原执行合同。未合入、未部署、未修改GLM产品代码。使用开发流程的证据核查方法。

## 阻断结论

1. **[P1] 实际接管目标未完成。** 对比旧v7-server.ts与新app-server.ts，主要差异是名称、注释、import排序和modelResolver/flags局部变量；身份权威、请求策略和业务装配仍为原AccountAuthService与原模块。没有转调旧函数是必要条件但不是充分条件。rebuild身份服务未复用接管，不能以旧服务新增密码参数和入口改名称“已开发=是（本批范围）”。PG不可达不证明只能停在改名；补齐当前行为的适配是原任务范围，不要把所有缺口当作老板必须决定的产品问题。
2. **[P1] 回滚方案会使密码升级后的账号无法登录。** 新代码写v2散列，旧服务仍固定v1参数；隔离验证新代码登录升级后，用旧服务验证同一正确密码得到INVALID_CREDENTIALS。旧迁移器还拒绝已应用但回滚源码缺失的0125（apps/api/src/infrastructure/db/migrations.ts:51起）。报告“旧代码对新增列无感，退回旧dist即可”错误。必须准备能读新旧密码格式且包含既有迁移的兼容回滚构建并演练，不能降级密码、删迁移记录或恢复生产数据代替回滚。
3. **[P1] 登录透明升级会覆盖并发改密。** account-auth-service.ts的异步派生后，仅WHERE user_id更新旧凭据，无版本/旧hash CAS，也未在签会话前重读身份状态。隔离探针在登录hash等待期间变更密码，旧登录随后覆盖新凭据；新密码登录失败，旧密码重新成功。这是本批新增凭据覆盖风险，必须修复并覆盖并发改密/停用/撤销的反例。
4. **[P2] 关键验收缺失且部分陈述不成立。** 未执行任务要求的verify:full、PG/迁移与恢复演练、作者端浏览器闭环。3个新增测试没有证明全部所述场景；匿名返回401不证明目标路由一定注册（全局鉴权可能先拦截未知路径）。报告宣称改密撤销，但当前复用服务/路由未提供其实际新接管实现。既有2个业务测试失败可注明基线，不应为绿色强改创作规则；但不能因此称全批已验证。
5. **[P2] 升级登录未写last_login_at。** v1升级分支只更新updated_at，返回对象写了last_login_at而数据库仍NULL。隔离复现已确认，后台记录不一致。

## 独立证据

脚本：.local/dispatch/outbox/task-auth-takeover-01/codex-probe.mjs。只使用内存合成数据，分别导入当前旧dist和GLM工作树新dist，源代码差异已核对；无模型/生产调用。

执行node脚本，exit 0，输出：rollback=INVALID_CREDENTIALS；upgradeLastLoginAt=null；concurrentPasswordChange=INVALID_CREDENTIALS；oldPasswordRestored=true。这些是复现成功的缺陷，不是通过项。

没有重跑无关全量套件，因为已存在明确阻断；不能据此推定开书/设定无回归。GLM已提交的62项通过与浏览器证据作为其自测保留，不冒充Codex独立全量验收。

## 处置

保留分支和证据，修正完成状态；按task-auth-takeover-01-revision-1.md连续返工。不得合入或部署，不删除原测试/调低检查标准。修复及实际接管完成后重新交Codex验收。
