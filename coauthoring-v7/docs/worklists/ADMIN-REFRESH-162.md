# R162 恢复后台正常刷新

问题：R161版本探针仅按Sec-Fetch-Dest empty匹配。实际Edge经Service Worker转发的导航使用empty目标但navigate模式，被错误返回204，引起刷新不更新与下载失败。生产日志确认截图同路径请求模式，非账号故障。

修复：探针同时要求Sec-Fetch-Mode cors，导航模式必须返回HTML。只热重载Caddy，保留根入口、旧路径和旧页面不强制刷新策略，不变更业务数据及API/Worker。

验收：生产配置校验通过；重现截图路径+empty/navigate返回200 text/html，普通document/navigate及根入口200，旧empty/cors探针204。已发布；配置及验证位于/opt/wenmi-releases/admin-refresh-162。未强制刷新管理员会话。
