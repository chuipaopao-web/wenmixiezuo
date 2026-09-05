# 第105批 官网首页与公开入口

## 合同

- 任务编号：RB-00.2 / PUBLIC-HOMEPAGE-20260906-105
- 目标：作者站根路径先展示公开官网首页，匿名访客可以理解文秘写作的小说创作定位，并从顶部或首屏进入登录、注册；已有会话显示进入工作台。
- 范围：只修改作者端首页入口、登录注册路由恢复、首页组件样式和相关作者端测试。
- 明确不改：API、数据库、注册登录语义、会员语义、后台代码、真实作者数据；子代理不改部署脚本或生产服务器，主代理按下方部署要求完成独立静态发布。
- 必须保留：绿色文学视觉；工作台、旧 `view`/`bookId` 深链、账号中心、退出、会员读取和旧作者端功能入口；匿名访问旧深链时登录后回原位置。
- 首页内容边界：介绍产品、登录注册入口、从想法到正文的流程、作者逐节点控制、多智能体分工、长期创作记忆、页尾真实帮助与联系入口。短剧创作只标注规划中；正式用户协议/隐私公开页后续独立补齐，本批不编造占位协议入口。
- 验证范围：作者端相关测试、作者端类型检查、作者端构建；真实浏览器桌面与 390px 截图走查；检查匿名首页不被账号接口错误挡住，登录/注册路径可刷新和前后退，登录后恢复旧深链，已登录根路径可进工作台。
- 部署要求：GPT-5.5 子代理仅做本地实现与证据，不提交、不部署；主代理审查通过后按用户长期授权执行作者端静态安全发布，不重启 API/Worker。

## 视觉概念与落地对照

- 首屏概念：`C:\Users\MSIK\.codex\generated_images\01a07284-8710-7790-8228-c4adf05ef13e\call_kSMt7PHTOjs1g8jwQPCbBwf5.png`
- 流程概念：`C:\Users\MSIK\.codex\generated_images\01a07284-8710-7790-8228-c4adf05ef13e\call_9adQLVvaOcAmzu4ohWjD9ue8.png`
- 协作/页尾概念：`C:\Users\MSIK\.codex\generated_images\01a07284-8710-7790-8228-c4adf05ef13e\call_pPzfW1N3OGDe44qvsJjqHz7g.png`
- 设计取向：白色/浅纸色页面、深松绿色操作、宋体系标题、代码原生 UI 文案、右侧作品设计示意，不使用假指标、假用户作品或未开放能力。
- 主代理修正：品牌继续使用现有绿色“文”字标；首屏右侧标注“创作流程示意”，不把非现有工作台控件画成真实入口或伪造已有书籍/同步进度；水墨竹叶克制使用。
- 落地对照：
  - 保留既有绿色“文”字品牌标志，未采用概念图中的新书本/羽毛标。
  - 首屏使用已定文案：“从一个想法，开始你的小说。”“AI 帮你展开故事，每一步都由你决定。”标题视觉固定为两行“从一个想法，”和“开始你的小说。”，匿名主按钮为“开始创作”，已登录为“进入工作台”。
  - 右侧为静态“创作流程示意”，只展示想法、角色、世界、大纲、章节、正文和正文线稿；已删除纯装饰空侧栏，不伪造书籍、用户指标或同步进度。
  - 第二段压缩为“从想法到正文”的五步流程，强调查看、修改、重做或继续，并改为“选择采纳的结果”，不写成每步强制确认。
  - 第三段展示多智能体分工和“长期创作记忆”，文案为正向说明：保存已确认设定与剧情线索，供后续创作查阅；作者可核对与调整。
  - 页脚只保留实际可用的“了解协作方式”、联系微信和“短剧创作：规划中”，未展示无真实页面的协议/隐私链接。

## 实施记录

- 状态：GPT-5.5已交付，主代理审查通过，生产静态发布及公网验证通过。
- 修改文件：
  - `coauthoring-v7/author-app/src/main.tsx`
  - `coauthoring-v7/author-app/src/PublicAuthorEntry.tsx`
  - `coauthoring-v7/author-app/src/PublicHomepage.tsx`
  - `coauthoring-v7/author-app/src/PublicAuthorEntry.test.tsx`
  - `coauthoring-v7/author-app/src/AuthorAccountBoundary.tsx`
  - `coauthoring-v7/author-app/src/AuthorApp.test.tsx`
  - `coauthoring-v7/author-app/src/navigation.ts`
  - `coauthoring-v7/author-app/src/styles.css`
- 入口行为：
  - 匿名根路径 `/` 展示公开官网首页；账号探针失败或网络错误不挡住首页。
  - 顶部登录/注册使用可刷新的 `/login` 与 `/register`，登录/注册表单内部 tab 切换同步 URL，浏览器后退同步表单状态。
  - 工作台入口统一写回根路径查询串，例如 `/?view=home`、`/?view=new-novel&entry=ai`，避免留在 `/login` 或 `/register`。
  - 旧 `view`/`bookId` 深链仍进入受保护工作台；登录后恢复原查询串；不安全 `return` 会回 `/?view=home`。
  - 注册进入工作台后退出，显示登录表单；按当前工作台 URL 刷新仍显示登录，不回注册表单。
- 测试与构建：
  - GPT-5.5 最终复跑 `node node_modules\vitest\vitest.mjs run --config coauthoring-v7\author-app\vite.config.mjs --configLoader native coauthoring-v7\author-app\src\PublicAuthorEntry.test.tsx`：9 项通过。
  - GPT-5.5 运行 `node node_modules\vitest\vitest.mjs run --config coauthoring-v7\author-app\vite.config.mjs --configLoader native coauthoring-v7\author-app\src\PublicAuthorEntry.test.tsx coauthoring-v7\author-app\src\AuthorAccountBoundary.test.tsx coauthoring-v7\author-app\src\AuthorApp.test.tsx`：77 项通过。
  - GPT-5.5 运行 `node node_modules\vitest\vitest.mjs run --config coauthoring-v7\author-app\vite.config.mjs --configLoader native`：15 个测试文件、210 项通过。
  - GPT-5.5 运行 `node node_modules\typescript\bin\tsc -p coauthoring-v7\author-app\tsconfig.json --noEmit`：通过。
  - 主代理独立复核 targeted 测试与 author 类型检查：通过，日志 `.tmp/r105-review-tests.log`。
  - 最终运行 `node node_modules\vite\bin\vite.js build --config coauthoring-v7\author-app\vite.config.mjs --configLoader native`：通过；仍有既有单 JS chunk 超 500kB 的 Vite 提示。
- 真实浏览器证据（本地 Vite `127.0.0.1:43215`，Edge headless，接口拦截为匿名或模拟会话，不调用真实作者数据）：
  - `D:\wenmixiezuo\artifacts\public-homepage-105\home-desktop-1440.png`
  - `D:\wenmixiezuo\artifacts\public-homepage-105\home-tablet-800.png`
  - `D:\wenmixiezuo\artifacts\public-homepage-105\home-mobile-390.png`
  - `D:\wenmixiezuo\artifacts\public-homepage-105\home-mobile-390-process.png`
  - `D:\wenmixiezuo\artifacts\public-homepage-105\home-mobile-390-footer.png`
  - 浏览器脚本：`D:\wenmixiezuo\artifacts\public-homepage-105\browser-check.mjs`
- 浏览器检查结果：
  - 1440px：公共页滚动容器 `scrollWidth=clientWidth=1440`；首屏标题两行不拆词、右侧无空白假侧栏并露出第二段标题；footer 链接高度 44px；登录路径 `/login`、注册 tab `/register`、后退回 `/login`。
  - 800px：公共页滚动容器 `scrollWidth=clientWidth=800`；footer 降为两列，三个子区块都在 0–800px 内，未靠裁剪隐藏。
  - 390px：公共页滚动容器 `scrollWidth=clientWidth=390`、`scrollHeight=3848`、`clientHeight=844`；CTA 高 58px；footer 链接高度 44px；流程卡与协作卡移动端压紧后可滚动阅读；底部“了解协作方式”可滚回协作段，品牌按钮可回到顶部。
  - 已登录模拟会话根路径显示作者名，点击进入工作台后 URL 为 `/?view=home` 并出现“创作小说”。
- 风险与限制：
  - 本批没有新增协议/隐私正式公开页；页脚不展示假协议入口。
  - 本批没有修改 API、数据库、注册登录语义、会员语义或后台代码；主代理新增独立静态发布脚本。
  - 浏览器登录路径使用接口拦截验证前端行为，没有使用真实作者账号或真实作者作品。

## Astra最终审查

- 已收到GPT-5.5最终交付，代码冻结。本批全部产品代码由GPT-5.5实现；主代理负责方案修正、独立验收、文档、打包与发布。
- 独立77项相关测试及作者端类型检查通过；最终构建通过，产物`index-BMNfdqUN.js`、`index-BzlgYqH1.css`。没有新增依赖或迁移，不触发全产品全量测试。
- 内置浏览器已打开首页并读取完整可访问性树，但工具未提供可用截图/点击接口；因此使用真实Edge headless补充交互和视觉验收。390/800/1440三视口均执行匿名首页、登录/注册tab、刷新、前进后退、注册后新建入口、已登录工作台、旧书查询串恢复，无页面异常或文本横向溢出。接口均为合成数据，不调用真实作者账号。
- 最终截图与结果：`artifacts/diagnostics/r105-browser/*-final-hero.png`、`*-final-process.png`、`*-final-memory.png`、`*-final-footer.png`及`final-visual.json`。内部滚动容器已实测滚到底，页尾完整可达、链接高44px；不把fullPage只截到容器可见区误判为无法滚动。
- 对照检查：主代理用view_image同时看过原首屏概念和最终截图；保留绿色视觉、宋体标题、首屏文案、主要操作、流程示意和段落顺序。审核后有意保留原“文”字标志，取消水墨装饰/假侧栏，缩小标题至两段不拆词；手机重排为单栏，800px页尾降列。首屏文案与允许清单一致，仅已登录主操作改为“进入工作台”。后续段落按确认的流程、作者控制、协作/长期记忆及真实联系方式实现，未宣称逐像素复制初始概念图。
- 审查修复：根路径返回、初始URL与工作台挂载顺序、表单tab与URL同步、退出回登录、非法return拦截、平板页尾宽度、链接触控高度、标题断行；去除假协议链接及研发口吻。文案与原作者端相容，未开放短剧仍标规划中。
- 发布范围：仅作者端静态文件及对应源码，复用线上后台原文件与旧哈希资源；主代理发布脚本`artifacts/deploy/deploy-r105-static.sh`不重启API/Worker或写数据库。

## 正式发布与线上验收

- 产品提交：`c574b272`。发布包`artifacts/deploy/r105-homepage-c574b272.tar.gz`，SHA256为`8e073c9de9adcefba0fc84c09edbc65cf415933fdc16cecc963c8c3848fc6bb5`。
- 北京时间2026-09-06 01:41:26静态发布成功；`/opt/wenmi/releases/current`指向`9bb21ac6eee9a9e80d13`，上一静态`232b47f9388f3bbcb262`保留。服务器记录位于`/opt/wenmi-releases/r105-homepage-c574b272/deployment-passed.txt`及同目录`public-checks.json`。
- 16项公网文件哈希及API健康检查通过。API仍为`wm-v7-20260906-003247-ce17325`，API PID 532179、Worker PID 532198保持不变，API/Worker/Caddy均正常；后台静态文件与原生产一致，未包含本地96—98批。没有数据库写入、服务重启或作者任务取消。
- 首次激活因主代理发布脚本读取健康响应层级错误触发自动静态回退；确认服务正常后修正为读取`data`内健康字段，同一发布包再次激活通过。不是作者任务或产品代码异常。
- 生产真实Edge浏览器390/1440检查通过：官网、登录、注册tab、刷新、后退、旧深链匿名保护、页尾可达，无页面异常；没有拦截生产接口、提交注册或使用作者账号。账号及后台接口匿名401、后台页面200符合预期。证据：`artifacts/diagnostics/r105-browser/production-result.json`、`production-390.png`、`production-1440.png`。
- 本批完成；下一批为RB-01注册及邮箱核验合同。邮箱核验、自助找回/改密、正式协议公开页和短剧完整流程均未在本批实现。
