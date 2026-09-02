# 工单：V7 代码分区审计与服务器磁盘卫生（2026-09-02 第83批）

## 背景

用户担心 V7 与旧版（V6）代码混杂、"一直删除不干净"，要求：审计 V7 代码位置、决定是否新建独立分区、保证前后端功能干净（含服务器部署），并处理服务器磁盘经常不够的问题（怀疑旧文件堆积）。

## 审计结论：不新建分区，当前分区已经是干净的独立闭包

### 证据

1. **目录结构已独立**：V7 全部功能代码在 `coauthoring-v7/{backend,author-app,admin-console}`；`apps/{api,contracts,worker}` 是共享平台基座（登录注册、会员、反馈、用量、备份），按设计就是 V7 的组成部分，不是 V6 遗留。
2. **无真实 V7→V6 引用**：grep 全仓，所有 legacy/V6 命中都是注释或溯源数据（如 `legacyTemplateKeys`），没有任何运行时 import。
3. **第72–78批已物理删除旧 V6 运行时代码**，不是注释掉，是删了文件。
4. **运行闭包门禁通过**（`scripts/quality/verify-v7-runtime-source-closure.ts`）：
   - 运行源码 201、运维源码 13、运维资源 14、迁移 106、静态资源 8、构建输入 24；
   - 门禁会对任何不在闭包内的生产源码文件报错退出（exit 1），即**零死源码文件**；
   - 结论：`scripts/` 17 个文件（根 5 + evaluation 2 + quality 3 + release 7）全部被闭包账本覆盖，无孤儿。
5. **非源码目录核查**：`artifacts/` 2230 个文件 188.5MB 是本机部署证据（不进发布包，git archive 打包时排除）；`data/` 6.7MB 本地数据库；deploy 7 个文件、docs 7 个文件、tests 92 个文件 1.1MB——全部有归属。

### 为什么不新建分区

- 现有门禁已把"V7 独立性"变成自动化事实：任何新增孤儿源码文件会让质量门禁直接失败，比人工搬文件夹更可靠。
- 新建分区意味着全量搬家 + 重写导入路径 + 重新验证部署，风险大且收益为零（因为没有发现需要搬走的旧代码）。
- 前端 author-app/admin-console 与 apps/api 的边界由闭包门禁的 7 个运行入口锁定，后端纯域层类型走 dist 构建，边界清晰。

## 服务器磁盘问题：原因与处置

### 原因分析

每次部署会先在 `/opt/wenmi-releases/` 暂存一份完整发布（约 1.1–1.6GB），第81批已加部署前 prune（保留最近4个发布）。仍会累积的：

- `/tmp` 部署残留（source.tar.gz、deploy 脚本和日志）；
- journald 日志增长、apt/npm 缓存；
- `/opt/wenmi/releases/versions/` 静态旧版本累积；
- 每日备份无保留期清理。

### 处置：新增 `artifacts/deploy/server-disk-hygiene.sh`

- **默认 dry-run**，`APPLY=1` 才真删；先打印会删什么，再执行。
- 只删可再生或过保留期内容：journal 真空到 200MB、apt/npm 缓存、/tmp 已知命名模式的部署残留（超1天）、非 current/previous 的静态旧版本（首次见到保留观察，超过2次清理周期才删）、30 天未变动且非当前指针的旧暂存发布。
- **数据库、最新3份备份、回滚链（近30天有变动的暂存发布）、retained-release-evidence 一律不碰**。
- 备份保留期 `BACKUP_KEEP_DAYS=7` 可调。

### codex 执行方式（部署第82批后顺手做）

```bash
# 上传后先看会删什么（不删任何东西）：
sudo bash /opt/wenmi/deploy/server-disk-hygiene.sh
# 确认输出合理后：
sudo APPLY=1 bash /opt/wenmi/deploy/server-disk-hygiene.sh
```

## 验收标准

1. 运行闭包门禁通过（零孤儿源码）——已满足。
2. 卫生脚本 dry-run 输出可读、不含数据库/最新备份/回滚链删除项——待服务器上验证。
3. HANDOFF 已登记第83批物料——已满足（见下）。

## 遗留

- 第83批之前的第82批（libraryRefs 归一修复）尚未部署，发布号 `wm-v7-20260902-174800-e5b21c74`，复用第81批部署流程。
- 证据卡层（资料上下文三层体系）按第82批工单遗留项另行开批。
