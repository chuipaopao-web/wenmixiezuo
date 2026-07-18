# QUALITY-20260718-01 长篇创作质量审查Skill验收记录

## 追踪信息

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 决定：`DEC-009`
- 实施计划：`docs/superpowers/plans/2026-07-18-wenmi-design-audit-skill.md`
- 核心提交：`a43ce49 feat: add longform quality audit skill`
- 唯一开发与复核人：当前Codex；按老板规则未调用其他开发Agent。

## 交付范围

- 安装项目级 `.agents/skills/wenmi-longform-quality`，包含主规则、Codex界面元数据、4份按需参考资料和确定性审计验证器。
- 建立13个触发、反触发、对抗与回归案例，以及完整、缺反例、过度承诺三类自动化夹具。
- 新增长篇质量当前规格和首次差距审计，并同步产品、架构、记忆、Agent、验收、覆盖矩阵和项目规则。
- 明确本任务只建立设计与验收门禁，不实现运行时混合RAG，也不把现有FTS加固定同义词组误称为语义检索。

## Skill与审计验证

| 门禁 | 结果 |
|---|---|
| Skill Creator官方 `quick_validate.py` | `Skill is valid!`；临时校验依赖在校验后删除，未加入产品依赖或Git |
| `validate-audit.mjs docs/LONGFORM_QUALITY_GAP.md` | `PASS` |
| 完整审计夹具 | 退出码0 |
| 缺反例夹具 | 退出码1，并明确报告缺少最强反例/预先验尸发现 |
| 过度承诺夹具 | 退出码1，并明确拒绝“保证写好长篇” |
| `validate-audit.test.ts` | 1个文件、3项测试全部通过 |
| 案例目录 | C01—C13覆盖自证式同义词测试、整书塞上下文、单FTS/单向量/单Wiki、聊天全记/全丢、静态大纲、共享上下文、同模型伪复核、作者迎合、5章过度外推和普通UI反触发 |

## 全量质量门禁

| 门禁 | 结果 |
|---|---|
| `npm.cmd run verify` | 退出码0；63个测试文件、129项测试通过；API/Web/Worker类型检查和生产构建通过；Web构建转换4561个模块 |
| 迁移、Repository隔离与恢复测试集 | 8个测试文件、13项测试通过 |
| `npm.cmd run acceptance`（核心提交后的干净工作树） | 3个验收文件、3项测试通过；发布审计全部通过，`failures: []` |
| `git diff --check` | 首次发现实施计划14处Markdown硬换行尾空格；本验收增量已移除，最终提交前重新检查 |
| 独立复核 | 未发现Critical或Important问题；补充了验证器自动化测试并要求9个真实Markdown标题，防止只靠关键词误通过 |

## 迁移、运行与恢复

- 本任务未新增或修改数据库迁移，也未写入生产正文、正史、任务或模型凭证。
- 迁移/Repository/恢复回归覆盖空库、升级、重复迁移、跨书隔离和备份恢复，8个文件、13项测试全部通过。
- 43110/43111在验收时已有文秘写作服务运行。为避免干扰现有服务，没有另启或停止进程；只读核验确认Web进程来自 `D:\wenmixiezuo\node_modules\vite`，API进程运行 `apps/api/dist/main.js`。
- Web和API均返回HTTP 200；健康接口报告 `service=wenmi-api`、`status=ok`、`database=ok`、同一 `releaseId`、`schemaVersion=9`、`cashFallbackAllowed=false`。
- 未读取、修改、停止或重启 `D:\AI智囊团`，也未将它作为运行时依赖。

## 当前真实能力边界

- E2：Skill结构、验证器、确定性流程门禁、迁移/隔离/恢复和生产构建已有可重复证据。
- E0—E1：目标混合RAG、关系投影、独立200章/100万字符检索评测与真实模型纵向文学质量仍是规格或后续实现目标。
- 尚无E3独立长规模系统评测和E4真实模型连续20章盲评，因此不能声称“文秘写作已经解决长篇小说写不好”或“已经提升真实文学质量”。

## 回滚与后续门禁

- 如需移除Skill，先从 `AGENTS.md` 删除强制引用，再对相关提交执行 `git revert`；不直接改写历史提交。
- 后续修改记忆、正史、RAG、上下文、规划、Agent协作、生成、审校或长篇验收时，必须先使用该Skill形成能力链、反例、指标和证据等级。
- 运行时混合RAG需要另立实施任务，并依次取得E1实现、E2构造测试、E3独立长规模评测和E4真实创作评测，不能用本Skill安装本身代替产品能力证据。
