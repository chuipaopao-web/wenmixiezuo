# 文秘写作当前交接

2026-09-15 REBUILD-CLOSEOUT-01 S0完成（提交182f3bc9+541dd570）：①版本对应核对通过（主区e493c87a/集成182f3bc9/线上a7614958/迁移125/回退保留），修正一处假象清理（/opt/wenmi-releases不可读致glob未展开、rm静默成功，root shell已清）；②vacuum-maintenance v2四缺陷全修（核验失败不自动恢复写者/完整性严格单行ok+空外键/API超时不启Worker/while正确重计时+600s上限）另修两个过程缺陷（非root锁文件假66→test可注入路径；块级重定向吞失败诊断→fd8带出），可注入隔离测试25/25，未对生产执行VACUUM；③今日03:00 cron未到点（服务器本地刚过零点），最近cron为0914失败（VACUUM前），VACUUM后手动备份全验证+余量~1GB，cron结果待到点后核对backup.log；④全RB盘点：原位更新5行过时身份行（RB-01/02/03/04/12附2026-09-14上线证据），S1缺口链=Rb-23/24/25待建立。**下一步S1**：读TIMEMACHINE_STORY_DESIGN §23+R209合同+现有v7-opening-agent/setting实现，盘点"设定确认→资料→故事线→基线"链现状缺口建清单后实施，结果写outbox/task-rebuild-closeout-01-s1.result.md。报告outbox/task-rebuild-closeout-01-s0.result.md，交Codex验收。

2026-09-14 备份空间恢复完成（四段全过，未删任何业务数据/旧备份、未重复发布）：隔离验证——全部业务表显式主键（唯二无主键=两个0行fts5虚拟表），代码rowid仅为TEXT主键表created_at平局决胜（兼容）；VACUUM INTO一致快照1s/59MB，.backup保形态(806MB)预演VACUUM 2s→59MB、23表逻辑快照全等。生产维护——30秒零在途→停API(Worker连带)→fuser无其他写者→停服后新快照→原地VACUUM 1秒：806MB→59MB（释放747MB，page 196774→14444/freelist 0）→integrity/外键/逻辑快照全过→API健康(新PID 545090同版本)→Worker(新PID 545112 ready)。正式备份——口径复算余量861MB，backup.sh 2秒成功，完整集20260914T155159Z-545284全验证(82账号/80权益/4流水/10书/125迁移)，cron确认；最终磁盘6.2G(>5GiB)。维护脚本vacuum-maintenance.sh已入库（锁/窗口/无写者/新快照/事务性VACUUM/失败恢复路径）。长期空间仍须观察（活数据增长即db增长），不保证永久可持续。报告outbox/task-auth-takeover-01-backup-space-recovery.result.md，交Codex。

2026-09-14 AUTH-TAKEOVER-01上线后收尾完成（两项，未重复部署）：①build-candidate.sh依赖顺序修复入库——按各package.json实测@wenmi依赖拓扑（v7-backend依赖opening-runtime却在旧序先建，干净环境暴露TS2307）改为contracts→opening-runtime→time-machine-core→v7-backend→api→worker，隔离环境全新解包（预存dist=0）干净构建全链exit=0、四产物hash与预验一致、typecheck=0；assemble-rollback.sh首次入库（sha fc00f20c…），悬空链接处理回收为可审查逻辑（词法解析判界：良性自引用放行case1-PASS、逃逸相对/绝对生产路径拒绝case2/case3-REJECTED、源不变PASS）。②只读复核定时备份空间：实时可用6,018,007,040B vs backup.sh需求7,254,583,276B，**缺口1,236,576,236B≈1.15GiB——今晚03:00定时备份将失败**（未解决，待老板选方案）：A.VACUUM（活数据仅56MB，dbstat复核，术后备份需求≈5.76G<可用，需~112MB临时空间+短暂停写窗口，未执行）；B.确认清理16个含库快照目录（预览已在冻结清单d3a9da15，未执行）。执行计划文档头已更新为真实已上线状态。报告outbox/task-auth-takeover-01-postrelease-followup.result.md，交Codex。

2026-09-14 AUTH-TAKEOVER-01正式上线完成（三段全成功，未回退）：①纯代码16目录清理——冻结受验件(b91ed6f1…/d3a9da15…)实时dry-run后16项全删零拒绝，df实测1.41GiB→7.25GiB(+6.26GB)，快照/备份/KEEP未动；②当前保护备份建立——完整集20260914T151137Z-537907(marker/checksums/integrity/81账号79权益4流水124迁移10书全验证)，37小时备份断供解除；③正式发布——候选wm-v7-20260914-151504-a7614958(冻结a7614958，四产物hash与预验一致，演练32/32；发现并绕过build-candidate.sh构建顺序缺陷)，回退闭包组装+wenmi隔离验证PASS(现网独立副本+已验证API dist替换，源不变/inode隔离/438+125核对)，30秒零在途+124条迁移实时再核后原子切换，API新PID 541894健康、0125唯一新增(125条)、Worker新PID 541923 ready；上线验证：测试账号注册/登录/admin403/改密/撤销/跨owner404、82账号/125迁移/599卡C6完整、新凭据scrypt-v2生效、日志零error、静态未切(无前端变更)。回退路径就绪(组装闭包+旧2922953d保留)。遗留：build-candidate顺序缺陷待修；快照16目录/书级/旧备份永久清理待老板YES+二次确认；VACUUM另列。报告outbox/task-auth-takeover-01-space-release-execute.result.md，交Codex核查。

2026-09-14 纯代码清理checks-fix完成（零生产删除）：两处合同缺口关闭——①遍历失败不再吞：scan/fp先落盘find输出+显式退出码检查（废除吞错的进程替换与无pipefail管道），nobody实测父子目录遍历失败/find部分输出后失败/execute项间指纹遍历失败均拒绝零误删；②保护逐项实时刷新：refresh_protection每项重读保护链接(失败即停)+重建/proc引用表+keep集合入保护，链接中途切向候选(预检后/项间两时点)均拒绝保留；flock仅脚本实例互斥如实声明(发布未接入同锁，部署互斥未实现)。合成23/23，生产dry-run v4：16/106项、6206MB、身份冻结。清单沿用d3a9da15…未变。cleanup-files v4=b91ed6f1…。纯代码16目录清理工具侧就绪，待老板YES+二次确认执行。报告outbox/task-auth-takeover-01-space-plan-checks-fix.result.md，交Codex。

2026-09-14 空间清理final-fix完成（零生产执行，纯代码清理工具可独立验收）：cleanup-files v3四项修正全过26/26反例——①身份冻结dev:ino+内容指纹（实测inode复用828107确凿，预检后替换/缺失后现身同名/新进程引用均拒绝）+flock并发锁；②INT/TERM非零退出+mktemp登记制（修复v2 reflist泄漏与子shell注册丢失两处真bug）；③数据探测改find -type f全遍历+SQLite魔数签名（探针实证旧-P误用曾使扫描静默失败）+扩展名清单，读失败即拒；④--root-override/--delay仅test-mode且根不得在生产内，生产入口固定根。T2备份清理本批禁用(exit 65待窄例外另批)；assemble去head截断(5201文件源全量不变F11)。峰值预算：删16纯代码目录(6206MiB实测)→7.64GiB→备份门禁6.81G(余0.83GiB，db增长>0.8G则fallback追加快照目录+12.9G)→回退组装1.5G→staging0.4G。生产dry-run：16/104项、全量扫描无隐藏库。清单沿用d3a9da15…。执行待老板对纯代码16目录YES+二次确认。报告outbox/task-auth-takeover-01-space-plan-final-fix.result.md，交Codex验收。

2026-09-14 空间清理方案安全返工1完成（零生产执行）：五项缺陷全部修正并经合成验证83/83（含全部指定反例：触发器篡改→事务内整体回滚、盘点后新增→拒绝或主键断面保护、缺yes/sha/错sha零删除、缺失保护表失败关闭、解析失败零删除、进程cwd引用/真实数据/根白名单/途中失败停止、回退组装源不变+inode隔离）。清单v2冻结d3a9da15…：草稿按行主键（opening_drafts无书关联证据改保留）、FTS走虚拟表作用域（活跃0行，shadow靠VACUUM另列）、余额真实SQL进事务内对比（81/79/4/24组）；纠正前报告——块级19.08G非表观16.94G、32目录实分纯代码16个(6.2G默认范围)+含库快照16个(约12.9G单独--data-snapshots确认，内含806MB生产库快照×7)、备份二梯队实为72项16.66G（weekly散文件此前漏计）、0912保护点实含9本书非10本且属早期快照（代码清理后必须新建当前保护备份）。执行命令：cleanup-files.sh(cleanup-db.py)三门槛sha+execute+yes。报告outbox/task-auth-takeover-01-space-plan-revision-1.result.md，交Codex核查后给老板三组范围确认。

2026-09-14 AUTH-TAKEOVER-01空间清理方案完成（只读盘点+预览+脚本，未执行删除）：纠正前批4项错误主张（现网release非已验证0125回退—已写assemble-rollback.sh组装方案待空间解阻后运行；备份年龄实为36.9h非48h；在途窗口须发布时重测）。冻结清单dcfb4d02…：32个旧release目录16.94GB（无引用已核验）+旧书10本/任务12个/书级表280个共12346行+二梯队备份14.07GB（默认跳过）；生产库92.5%是空闲页（806MB仅约60MB活数据，VACUUM可回收740MB）；仅第一梯队即可解除备份阻断（需7.23G、删后18.4G）。cleanup-db.py保护表前后逐行指纹+延迟外键+防重，合成验证29/29 PASS，生产双dry-run预览已留存。账号81/权益79/流水4全保留已验证设计。等老板对清单YES+二次确认后按报告§六顺序执行（清文件→备份→可选DB清理→回退组装→回到发布）。报告outbox/task-auth-takeover-01-space-plan.result.md，交Codex核查。

2026-09-14 AUTH-TAKEOVER-01正式发布执行：合并冻结完成（集成分支codex/auth-takeover-01-release@a7614958=ed9152c9+主线146e513a纯docs，业务代码与已验收d11e0b2b逐字一致，LF归档28.7MB已生成）；发布前只读检查全部通过（现网链接/服务/systemd核对、124条已应用迁移与冻结文件逐字节hash一致仅0125待新增、在途任务窗口当前为零、回退路径=现网release目录本身已验证）。**正式切换被磁盘空间硬阻碍未执行**：仅剩1.5G，backup.sh要求可用≥快照+5GiB≈5.8G，缺口≥4.3G；每日备份cron已自09-14 03:00失败、最新完整备份停在09-12（>48h，越过26h告警线，独立生产风险需老板决断）。解阻选项（扩容/清理旧release 18G/备份异机）均需老板授权。生产全时零改动。报告outbox/task-auth-takeover-01-production-release.result.md，交Codex核查。

2026-09-14 AUTH-TAKEOVER-01 Linux预验final-fix完成（d11e0b2b）：①cleanup不再删除输入脚本——MIG_TEST移出清理责任，Phase0只认已提交固定路径$SRC/scripts/...（缺失fail-closed，去掉/tmp后备），三时点hash核查（基线/正常后/假占用后）drill f0ee3ddf…与migrate-test caa1fa69…始终存在不变、他人哨兵未动、本批mktemp资源每次全回收；②审计断言真实化——P0-2b改整行相等、P0-5f/5g改五表（账号/owner/会话/权益/审计）主键排序整行比较，复验19/19+演练32/32全过。业务产物未改，复用返工4 manifest；已更正"main.js相同仅该入口文件相同，不代表整个回退包与生产逐字节一致"。生产未变。报告outbox/task-auth-takeover-01-linux-preflight-final-fix.result.md，交Codex验收。

2026-09-14 AUTH-TAKEOVER-01 Linux预验返工4完成（b32141a0）：六项修正全部真实运行关闭——Phase0迁移验证19/19（no-such-table真实故障注入+种子审计行存活性）、三阶段演练32/32（含C8c跨owner直读404、双账号taskId交集=0）、假占用fail-closed零请求、生产路径按现网链接realpath拒绝（实测现网source被拒且零副作用）、候选确定性构建（4产物hash重构建前后一致，manifest三方核验）、候选/回退manifest+构建日志已导出本地。回退包main.js=现网main.js（1d340b64逐字节复刻）。第一次运行的注入no-op、C4笔误、Phase0退出码覆盖、A10单次瞬时失败（根因未明，已排除OOM/进程死亡/序列问题，加了响应体捕获）全部修复复验。生产全时未变，服务器无本批残留。报告outbox/task-auth-takeover-01-linux-preflight-revision-4.result.md，停等Codex验收。

2026-09-14 AUTH-TAKEOVER-01 Linux预验补交3完成（返工3）：6项脚本缺陷全部修复（根路径/cleanup精确路径/端口+PID保护/统一archive版/0125独立迁移验证/逐owner权益对比）；29/30项演练通过（唯一失败P0-3为已知测试限制非迁移缺陷）；27/27功能项全绿；生产未变。报告outbox/task-auth-takeover-01-linux-preflight-revision-3.result.md。

2026-09-14 AUTH-TAKEOVER-01 Linux预验返工1完成：干净构建（npm ci+全链tsc+typecheck全通过）、改密超时根因查明（演练脚本cookie提取bug，scrypt实际556ms完全正常）、25/25三阶段回退演练Linux全通过（含v1/v2/旧会话/审计/迁移）、64/64测试干净构建后复验通过。前批“可以发布”结论依据不足已修订。生产未变。报告outbox/task-auth-takeover-01-linux-preflight-revision-1.result.md。

2026-09-14 AUTH-TAKEOVER-01 Linux预验完成：发布清单4项错误已纠正（Worker依赖/唯一回退/迁移测试方式/基线逐项）；服务器64/64测试全绿（身份+安全+创作库C6+迁移0125）；IdentityService真实Linux进程验证通过；生产未变；候选目录299M保留于/opt/wenmi-releases/wm-auth-takeover01-preflight/。报告outbox/task-auth-takeover-01-linux-preflight.result.md。

2026-09-14 AUTH-TAKEOVER-01发布准备中（本批）：隔离分支已合并主线05af55f8，修正式发布工具（drill退出码/子进程清理/端口检查；build-rollback安全目录/归属标记/不覆盖已有包），复验21项演练+18项身份测试+合并后回归，交付发布清单。候选commit见release-prep报告。不推送/不合入/不部署。

2026-09-14老板要求可交GLM的全部委派，Codex只做范围判断与关键验收。发布准备GLM d2555484已交付但清单有错误：Worker依赖被误写无需重启、回退旧v1-only竟要求重置用户密码、生产库预验措辞不当、基线确认归属夸大。下一任务.local/dispatch/inbox/task-auth-takeover-01-linux-preflight.md让GLM纠正并连续完成Linux隔离构建/测试/迁移回退预验；允许既有授权目标的隔离暂存，不允许正式切换或改生产库。结果outbox/task-auth-takeover-01-linux-preflight.result.md。尚未认可本次可直接生产发布。

2026-09-14下一步已安排GLM执行AUTH-TAKEOVER-01发布准备，任务.local/dispatch/inbox/task-auth-takeover-01-release-prep.md：在原隔离分支合并最新主线、修正式发布工具的退出/清理/重入问题，复验并交付明确平台的发布清单。不重做已通过身份修复，不扩PG/时光机，本批不推送/合入主工作区/部署。结果outbox/task-auth-takeover-01-release-prep.result.md，随后Codex验收发布物与生产门禁。

2026-09-14 AUTH-TAKEOVER-01返工3 557574db：Codex相关本地返工验收通过，错误登录/改密失败审计各落1条，18项身份/并发/审计/路由测试通过；独立新包→兼容基准包→新包21项演练通过。未合入/部署，PG未接管；不代表整站重构完成。最终证据outbox/task-auth-takeover-01.codex-review-final.md。后续合并/发布准备需处理演练process.exit跳过finally和构建清理保护，核对全分支及C6状态，不能直接部署或再重复前三轮已通过返工。

2026-09-14 AUTH-TAKEOVER-01返工2 c328dca3已复查：13项并发/权限回归独立通过，最终事务校验和独立基准回退方案已有进展；但错误登录/改密失败审计在事务内写后ROLLBACK而丢失，独立内存探针计数均0。未合入/部署。审查outbox/task-auth-takeover-01.codex-review-3.md，GLM继续inbox/task-auth-takeover-01-revision-3.md小范围修复，保留已通过成果；完整回退包仍待Codex独立演练、PG仍未验证。

2026-09-14 AUTH-TAKEOVER-01返工1 c7f2fdd3复验仍未通过，未合入/部署。已确认凭据并发覆盖和last_login_at修好，8项局部测试通过；但第二次哈希窗口停用仍发新会话、退出中的改密仍成功、已知账号校验绕过有界hash队列，所谓回滚仅复制并测试本次自身版本。证据outbox/task-auth-takeover-01.codex-review-2.md及codex-revision1-probe.mjs；让GLM执行inbox/task-auth-takeover-01-revision-2.md，保留前轮成果集中返工。

2026-09-14 AUTH-TAKEOVER-01 GLM提交281e1749已由Codex审查，未通过，未合入/未部署：入口主要为旧装配改名，完整身份接管未完成；独立内存探针确认密码升级后旧代码回退登录失败、并发凭据修改被旧登录升级覆盖、last_login_at未落库。审查`.local/dispatch/outbox/task-auth-takeover-01.codex-review.md`，返工`.local/dispatch/inbox/task-auth-takeover-01-revision-1.md`。保留GLM分支及自测，不以其”已开发/验证”宣称完整通过；老板触发GLM继续返工。

2026-09-14 AUTH-TAKEOVER-01执行任务书已备，待老板手动交GLM5.3：`.local/dispatch/inbox/task-auth-takeover-01.md`。目标为新身份/权限/运行入口实际接管及本地已替代死代码清理；GLM连续完成开发与验证，不仅审计。隔离分支交付Codex验收，本批不部署。不能把当前使用中的开书/设定、@wenmi/v7-backend或rebuild/legacy-opening按名称删除；不能把C6准备代码回退到生产C5。结果入口`.local/dispatch/outbox/task-auth-takeover-01.result.md`。

2026-09-14 R209-C6创作库与后台已上线，运行层待常规安全窗口：恢复33张原卡，新增32张独立“节奏＋余韵”卡法372—法403，只用于链页面·链分章，余韵0—3章、可不写。正式库6e8fdb4e-85a4-4bcd-b529-61caad6294e2共594项（398方法＋196参考），后台静态fbbb1a6993a21c1aab07；公网14资源hash、生产防重/数据完整性、现有API兼容通过。API/Worker未重启，仍wm-v7-20260914-024500-2922953d且ok/ready；C6运行层代码b426e0c6准备完毕，未生效。自动审批拒绝忽略活动任务的重启后，采用不重启的内容/静态发布，未修改任务数据。链页面及分章结果硬校验待开发；当前交付和后续发布见R209工作清单C6。

2026-09-14 R209-C5已上线：法012改为链用“开端—推进—兑现—余韵扩散”，33张方法修订独立审核通过，共享runtime只在chain注入兑现/余韵检查，全书/卷排除。32项回归、API构建、生产防重及健康通过，API/Worker wm-v7-20260914-024500-2922953d，正式库a785f7dc-bdb9-4af3-bf8a-5506465828dc。唯一证据在R209工作清单C5；链页面仍待后续开发，旧发布与作者数据保留。下述C4通用余韵要求已由C5收紧。

2026-09-14 R209-C4/D/E：Codex已完成余韵/情绪方法补充、562项公共卡片独立审核、开书/设定/故事线/全书方向真实检索与提示词接入。103项相关回归通过；真实模型两组检索与生成、独立发现问题后的修订有记录。完整上下文上限15000字符，不整库注入，不保存思维链，不加虚假等待。API/Worker wm-v7-20260914-020000-c4de0001、静态6e3925ed6dad01ed11d3已上线，正式562项供给已发布；最新证据与限制只看[当前交付](coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md)。下述C3“尚未接入”是历史状态。VP-01、卷链章页面、旧书删除均未实施。

2026-09-14最新R209-C3已上线：复核349现用方法，补12条，当前361方法草稿、5退役来源、196参考草稿。新增主/关联用途、重点阶段、条件阶段用法、六类内容类型；后台筛选/详情/编辑已接通，34个用途子类有覆盖。46项测试、类型检查和构建通过；API/Worker为wm-v7-20260914-001000-c3000001，静态407cfe86e54de52eff81。生产仓储查询、数据库检查、重复导入零变更通过。浏览器工具超时，真实视觉点击未完成。仍未完成异模型独立内容审查及D/E真实AI检索、提示词接入；不能把库整理上线等同AI已使用。唯一状态见R209工作清单C3交付，操作见scripts/creative-library/README.md。下文C2数量和版本为历史状态。

2026-09-13后续分卷VP-01：老板确认最多10卷、单卷预算上限50万字，沿用默认最低6卷；500万字固定10卷。完整方案在docs/TIMEMACHINE_STORY_DESIGN.md第24节，后台RB-22登记VP-01A/B/C待开发；本轮只更新文档和后台记录，不改实际生成、数据或提示词。该方案覆盖下面“阶段→卷数待讨论”及13卷建议。

最新R209-C2-M：老板要求Codex直接整理，GLM C2派工已撤回。346方法来源逐项核查，5同义组合并保留原号，新增8条，线上349现用方法+5退役来源，196参考未改。后台统一创作库，8用途主类/子类/阶段筛选与中文阶段用法已上线，静态84220d2b728bd0aaed4d，API/Worker版本未变、未重启。28项测试、类型/构建、公网14文件hash及真实管理仓储查询通过；浏览器超时未完成视觉点击验收。草稿不冒充独立审核，D/E检索仍未接入。操作入口scripts/creative-library/README.md、唯一规格R209工作清单。下面C2待派GLM均为已失效历史状态。阶段→卷数快捷模板是最新讨论，尚未设为强制规则。

R209-C1（2026-09-13）Codex已直接完成并线上录入542条草稿：346方法来源、128旧创意、38题材入口、30跨题材参考。重复导入零新增，27项本地测试及服务器合成库/真实管理仓储查询通过；API/Worker未重启且健康。不是已审核/已接入AI。C2独立内容复核任务已备：`.local/dispatch/inbox/task-209-c2.md`，待老板手动触发GLM；只交内容提案不改产品或生产。唯一规格R209-C合同及C1验收记录，种子和审计入口`scripts/creative-library/README.md`。以新书验收，不修旧书、不执行全站删除。

R209-C1（2026-09-13）Codex已直接完成并线上录入542条草稿：346方法来源、128旧创意、38题材入口、30跨题材参考。重复导入零新增，27项本地测试及服务器合成库/真实管理仓储查询通过；API/Worker未重启且健康。不是已审核/已接入AI。C2独立内容复核任务已备：`.local/dispatch/inbox/task-209-c2.md`，待老板手动触发GLM；只交内容提案不改产品或生产。唯一规格R209-C合同及21节，种子和审计入口`scripts/creative-library/README.md`。以新书验收，不修旧书、不执行全站删除。

R209-B1/B2已于2026-09-13上线并完成故障恢复：API/Worker `wm-v7-20260913-190000-a2090001`，静态 `b9f08123d5b4e15f02e7`。原发布脚本过早检查新Worker心跳，随后旧代码缺新增迁移目录导致回滚启动失败；老板明确允许恢复服务后已恢复新版本，两服务active、健康ready、公网14文件哈希通过。未恢复数据库。兼容回滚包已通过迁移和隔离API启动验证。生产登录后点击验证因浏览器工具超时未完成。详见R209规格20.4；以下“未部署”是历史状态。C内容和D/E检索提示词尚未实施，旧供给仍不能删。

R209-B1/B2已于2026-09-13上线并完成故障恢复：API/Worker `wm-v7-20260913-190000-a2090001`，静态 `b9f08123d5b4e15f02e7`。原发布脚本过早检查新Worker心跳，随后旧代码缺新增迁移目录导致回滚启动失败；老板明确允许恢复服务后已恢复新版本，两服务active、健康ready、公网14文件哈希通过。未恢复数据库。兼容回滚包已通过迁移和隔离API启动验证。生产登录后点击验证因浏览器工具超时未完成。详见R209规格20.4；以下“未部署”是历史状态。C内容和D/E检索提示词尚未实施，旧供给仍不能删。

B2最终本地验收通过：712bde46已合入，Codex46后端+14前端测试、两端类型、API/后台构建及提交失败独立探针通过。验收`.local/dispatch/outbox/task-209-b2.acceptance.md`。尚未推送/部署，线上创作库仍未开放；下一步B1/0122+B2/0123发布预检和安全上线，C内容/AI检索及账号入口重构另批。下述返修阻断已由本条替代，旧库仍有运行依赖不能删除。

B2最新6d223a12仍待收尾：同步事务与服务授权已补，API类型通过；独立44/45（双try单跑又通过）。COMMIT在catch外导致提交失败后depth残留，同实例下次返回成功但不提交，探针已复现。见outbox/task-209-b2.codex-review-3.md，任务inbox/task-209-b2-revision-3.md；不重做前端，不合入/部署。

B2最新7e1316f1复验仍未通过：42项回归通过，单次回滚等前轮修复成立，但独立并发探针复现B返回成功后被A回滚；另有BEGIN失败深度未复位、管理服务缺授权/接口边界。审查`outbox/task-209-b2.codex-review-2.md`，待手动触发`inbox/task-209-b2-revision-2.md`。本地手机入口截图已改善，未合入未部署，不重复重做已通过UI。

R209-B2首次验收不通过（9fde49ac）：39项复跑通过，但Codex故障探针复现审核500状态已改变、发布500活动版已切换且同键409、reference用途筛选漏项；另有关系编辑/冻结分页/离开表单与截图证据缺口。见`.local/dispatch/outbox/task-209-b2.codex-review.md`，返修任务`inbox/task-209-b2-revision.md`待手动触发。未合入、未部署，不续批。

老板明确将登录、权限和路由运行入口替换纳入后续新后端开发。已写入REBUILD_DEVELOPMENT_SPEC顶部专项及执行路线；B2完成后先审计已有新账号实现和生产映射，再分批接管/切换/删除旧入口。当前main仍调用createV7Server，未宣称替换完成；不扩大正在进行的GLM B2。

老板新增要求：重构完成对应模块后必须替换并删除废弃实现、清理本地/服务器冗余空间，不长期维护两套。执行规则见CREATIVE-LIBRARY-209第19.6节；B2报告需补旧依赖与退出清单，当前GLM不扩大删除范围。Codex负责后续按模块切换与清理，保护作者数据及必要回滚资源；目前只是规则已补，尚未清理。

R209-B2任务书已备，待老板在ZCode手动触发`.local/dispatch/inbox/task-209-b2.md`。基准e4c867f6，分支codex/dispatch-task-209-b2；现有后台创作库管理、真实鉴权与完整版本发布闭环，详细规格第20节。允许隔离提交，禁止推送/合入/部署/调模型/自动续批。结果`outbox/task-209-b2.result.md`交Codex验收，尚未开发。

R209-B1最终验收通过并已合入本地开发分支：隔离最终eaf0361d，Codex独立复跑36项测试及API类型检查通过。验收见`.local/dispatch/outbox/task-209-b1.acceptance.md`。未推送/部署；新增0122迁移尚未在生产运行。B2后台鉴权、分类管理、编辑审核和发布入口待单独派工，AI检索及提示词仍未接入。以下B1“未通过”记录为已解决的历史审计。

R209-B1验收不通过：隔离commit b712325a的20项测试复跑通过，但Codex内存探针复现筛选SQL报错、退役破坏旧release、新版绕过审核、同实体两号、编辑后创建幂等失败。另有关系/竞争测试缺口。审查`.local/dispatch/outbox/task-209-b1.codex-review.md`；待手动触发`.local/dispatch/inbox/task-209-b1-revision.md`。未合入、未部署，不进入B2。

R209-B1派工已备，待手动触发`.local/dispatch/inbox/task-209-b1.md`：基准327900d6，独立工作树与codex/dispatch-task-209-b1分支，编号/版本/Repository/精确读取及合成测试。允许隔离提交，不合入部署；暂不接路由/UI/生成流程，B2另派。结果`.local/dispatch/outbox/task-209-b1.result.md`，完成后Codex验收。

R209-A最新验收：第二次返修经Codex独立复跑S2/S3/S4/S5断言通过，实施前只读核查已结束；原任务书恢复、无产品代码修改。证据`.local/dispatch/outbox/task-209-a.acceptance.md`。下文需返修状态已由本条替代；真实模型/生产供给/语义召回仍未验证。B可准备分批任务，尚未派发，不能自动继续。

R209-A已交付但Codex验收需返修：128/341计数及合成引擎路径复跑确认；真实模型根因推断、修复次数统计/缺断言、语义标注、覆盖零值及任务书擅自移出需纠正。审查`.local/dispatch/outbox/task-209-a.codex-review.md`，待手动触发`.local/dispatch/inbox/task-209-a-revision.md`。B批未放行；产品未修改、未部署。

R209-A任务书已准备，待老板手动触发：`.local/dispatch/inbox/task-209-a.md`；结果`.local/dispatch/outbox/task-209-a.result.md`。仅只读审计与限定目录合成探针，免worktree，不改产品、不调模型、不部署、不自动接B批。基准a29fdb75707b98c762cbc05f08d2980bb986ce60，后续文档更新不要求回退。此条更新下文“未派任务”的历史状态，尚未执行或验收。

R209补充：同一规格第17节已加入公共规则、开书、设定、资料提取/核对、故事线、全书、审查及后续卷链章的提示词正文、实际接入位置和11组验收场景。第18节补齐法/参稳定编号、短语三档供应、后台用途树与交叉筛选、精确/语义召回边界及验收；第8节schema同步增加displayCode/shortPhrase。提示词随D/E与真实工具循环配套交付；当前仍是文档，线上prompt未改，不得报告已优化上线。

R209当前仅完成全题材创作参考库与Agent判断流程的文档方案，未实施、未上线、未派GLM任务。唯一规格[CREATIVE-LIBRARY-209](coauthoring-v7/docs/worklists/CREATIVE-LIBRARY-209.md)：38题材范围、跨题材机制、16体验方向、人物/对抗/融合判断、卡片schema、受控检索、15,000字符预算、版本与审核、后台展示及A—F批次。覆盖蓝本不等于正式卡片全部入库；后续先按R209-A核对标签纠错和旧资产真实供给，再逐批实施。卷链章只规定后续接入合同，本批不提前开发。

R208已由GLM5.3实施、Codex审计返修并上线：API/Worker wm-v7-20260913-053000-a2080001，静态976dd329934d83ef1f77。105项相关测试、手机端编辑保存刷新、服务器构建/14静态文件校验、13后台档案核对、API/Worker健康通过。三组合成开书使用DeepSeek Flash：三国/悬疑完整解析通过，日常两次目录外标签“温暖”未通过完整解析；新增两字段均有输出，不声称全题材质量合格。未重跑作者任务，无迁移。后续优先定位目录外标签纠错，题材创作库仍未开发。唯一合同[OPENING-APPEAL-208](coauthoring-v7/docs/worklists/OPENING-APPEAL-208.md)。

最新R207已上线且本书恢复成功：API/Worker `wm-v7-20260913-025000-a2070001`。用户明确补充授权后执行真实探针与当前书籍恢复，结构化合并请求通过；《三国送外卖：曹操催单了》任务e5ec6694-6722-4ef7-9911-1d1090eedcf2已succeeded，6条推荐已保存，前端状态waiting_for_you。复用19页分卡，恢复约4分32秒/39调用，最大完整输入11223字符；22项相关回归、构建及生产健康通过。R206未发布。不要再次恢复已成功任务；作者下一步选择故事线。下述审批待授权与本书未成功是历史状态，由本条替代。详见[R205—R207](coauthoring-v7/docs/worklists/CARD-MERGE-205.md)。

最新R207已上线且本书恢复成功：API/Worker `wm-v7-20260913-025000-a2070001`。用户明确补充授权后执行真实探针与当前书籍恢复，结构化合并请求通过；《三国送外卖：曹操催单了》任务e5ec6694-6722-4ef7-9911-1d1090eedcf2已succeeded，6条推荐已保存，前端状态waiting_for_you。复用19页分卡，恢复约4分32秒/39调用，最大完整输入11223字符；22项相关回归、构建及生产健康通过。R206未发布。不要再次恢复已成功任务；作者下一步选择故事线。下述审批待授权与本书未成功是历史状态，由本条替代。详见[R205—R207](coauthoring-v7/docs/worklists/CARD-MERGE-205.md)。

最新R205资料合并修复已上线：API/Worker `wm-v7-20260913-023000-a2050001`，静态不变。本书《三国送外卖：曹操催单了》19页成功，旧merge:2:0两次5000输出后失败。新merge:v2按全书相关性归纳，调用短来源编号、保存还原，6000字符结果上限拒绝超长而不截断；tm2-card-4。37项不同回归及API类型/构建、线上健康通过。**真实本书合并探针被自动审批拒绝（私人资料发送既有外部模型需具体授权），未执行、未恢复任务，不能声称故事线已成功。** 用户具体允许后才能运行探针，不绕过。详见[R205](coauthoring-v7/docs/worklists/CARD-MERGE-205.md)。

最新R203/R204流程修复已上线，提交4a548cdf，API/Worker `wm-v7-20260913-013500-a2040001`，静态 `82f5df5bb15ba35e4a38`。设定设计完不再自动新建主编总审，作者点击“确认设定并请主编整理”启动；保存整理结果与派工记录同事务，后台自动继续资料短卡/核对/故事线，刷新关页不丢。先确认再整理的无改动分支同样派工。0121仅新增派工表；54项后台分批回归、40项前端、补充分支7项及构建通过，模型质量/速度未做真实整书验收。线上《三国送外卖：曹操催单了》24项仍为candidate，未代作者确认或重新生成。最新版本健康通过。迁移备份执行偏差及真实证据见[R203/R204](coauthoring-v7/docs/worklists/SETTING-FLOW-203.md)，不可将事后备份称为事前备份。旧R203/R204发布脚本不可重复执行。

最新R202配置已生效（代码发布仍R201）：用户纠正为“换成员，不给K3成员换模型”。已恢复五名非主笔K3成员本人绑定并停岗，启用原豆包陆青禾，恢复R200误解绑的五个Kimi2.7候选；GLM六岗位及K3主笔清照保留。治理revision84→95，线上名单身份/头像映射断言及治理9项通过，不重启、不改历史快照。原R200改绑豆包方案已撤销，不得重跑。详见[R202](coauthoring-v7/docs/worklists/ROSTER-202.md)。

最新R201已上线：API/Worker `wm-v7-20260913-010000-a2010001`，静态 `56d50c8492b81085513e`。R198资料直出、R199设定完成/确认/主编总审前置校验已随R200发布；R201补无设定资料状态读取500。R200生产治理revision67→84：GLM六个文字岗位启用，非主笔Kimi固定席位改绑豆包、候选Kimi解绑，Kimi主笔保留；历史快照不改。治理8项、设计18项、路由安全2项、前端9项、设定定向1项及构建通过；未做本批整书真实模型文学质量验收。两次切换均连续30秒零在途并复核，未取消作者任务。详见[R200/R201](coauthoring-v7/docs/worklists/ROSTER-200.md)及[R199](coauthoring-v7/docs/worklists/SETTING-HANDOFF-199.md)。不再执行R198/R199旧发布脚本，不恢复旧书；设定页内部确认/主编整理顺序未重构。完整内部路线文档未上传，仅同步已存在服务端文档校验值。

下述R198“尚未上线”是历史状态，由以上记录替代。

R198资料整理修复eec982dc已验证并隔离构建，尚未上线：其他书设定任务在途，安全切换延期。失败页使用新参数17.985秒返回2533字符六栏JSON；59项测试与API构建通过。整书恢复被自动审批拒绝（生产重新排队、向既有模型发送书籍资料、使用额度需具体授权），未执行，不得绕过。详见[R198](coauthoring-v7/docs/worklists/STORYLINE-RECOVERY-198.md)，生产仍下述R197。待用户明确恢复授权及安全发布窗口，不能声称本书故事线已生成。

最新R197已上线：API/Worker `wm-v7-20260912-224500-6d7d507a`，静态 `88cb4b0c78479876f3d3`。新时光机任务接入作者状态，书内按bookId过滤，真实阶段、无伪百分比/停止按钮，归档书排除。28项相关测试及1项定向回归通过，线上资源/鉴权/健康核验通过。首次发布版本格式错误造成启动失败，回滚后重启限流导致服务未恢复；续接已恢复旧服务并修正预检和回滚后成功发布，详见[R197](coauthoring-v7/docs/worklists/TASK-STATUS-197.md)。**《仙门售后我无敌》自身资料生成仍失败：card:0，两次DeepSeek输出计数10000，未形成可提交结果；这不是任务漏显，下一批需单独解决，不能声称时光机全部收尾。** 完整路线文档仍未上传，仅现有服务端代码校验值随发布更新。

最新R196已上线：API/Worker `wm-v7-20260912-222000-fcb2c191`，静态仍33fabe9aa59615bd7dda。合并交付R195完整输入15000计量及R196资料装载/语义视图优化。27项本批测试、API类型构建通过；合成3500字资料3调用、重荐1调用、后续基线复用。线上14资源、5鉴权、后台入口与健康通过。连续30秒零在途后切换，未取消任务。**此前R195待发布步骤已被本次替代，不要再执行旧cutover脚本。** 本地开发文档已更新，但自动审批仍未允许将完整路线文档同步后台；本次只上传API代码和脚本，没有绕过文档限制。未做真实模型速度/语义验收。详见[R196](coauthoring-v7/docs/worklists/STORYLINE-MATERIAL-196.md)。

R195实现16802176已随R196交付，其旧待发布目录和cutover脚本不再使用。64项回归通过；未做真实模型注意力/语义验收。详见[R195清单](coauthoring-v7/docs/worklists/CONTEXT-195.md)。

最新R194已上线：API/Worker `wm-v7-20260912-205500-6de600d5`，静态 `33fabe9aa59615bd7dda`，实现提交 `6de600d5`。单人开书异模型主编审查（含跨套餐排除）、两处番茄风格取名、信息页作品简介已交付；简介仅当前已采用全书方向可AI生成，手动编辑可用，草案须保存，版本冲突保留输入。0120追加表迁移已核对。19项设计/取名、9项界面、1项开书仓储及共享引擎场景通过，390/1440交互通过；线上14资源哈希、5处鉴权、后台入口及API/Worker健康通过。连续无在途任务30秒并复核后切换，旧版本保留。未做新真实模型质量评估；本批不代表独立新后端迁移或时光机全部完成。详见[本批记录](coauthoring-v7/docs/worklists/BRANDING-REVIEW-194.md)。下文为前批范围，当前版本以上述R194为准。

最新静态小修R193：1de83c19d2dcc80d8569已上线（7a275378），开书想法框缩小、移除确定按钮、显示本机自动保存/失败状态；57项回归及390/1440浏览器验证通过，API/Worker未重启。下文R192为后端版本与原交付范围，资料整理过慢仍待处理。

当前由Codex直接开发，不派GLM任务。新后端重构从第107批开始；旧V7开发日志已按老板要求清理，近期实现证据在项目工单中维护。

生产版本为wm-v7-20260912-194500-5701f080，静态5572edbd106aba5d73a6。短卡局部修正、故事线入口交互、后台开发档案分页与真实任务状态已上线，旧静态资源及回滚版本保留。

当前第192批：51项相关测试、三处类型检查、前后端构建通过；390/1440合成资料浏览器交互验证通过，线上14资源哈希、3处鉴权边界、后台入口及API/Worker健康通过。发布前在途连续30秒为零并立即复核，未取消作者任务。未完成新真实模型质量、全部原型及卷链章/结算/时光树验收，不得称全部完成。

接管入口：[执行路线](docs/REBUILD_EXECUTION_PLAN.md)、[详细规格](docs/REBUILD_DEVELOPMENT_SPEC.md)、[本批清单](coauthoring-v7/docs/worklists/TIMEMACHINE-192.md)。先读当前状态，再按本批合同继续。
