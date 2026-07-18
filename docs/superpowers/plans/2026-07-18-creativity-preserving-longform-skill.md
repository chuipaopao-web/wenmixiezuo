# 创造性保护型长篇质量Skill修改计划

> **执行方式：** 老板已经明确要求一次性完成，由当前Codex在本任务内联执行；禁止调用其他开发Agent。

**目标：** 把“不得以一致性、检索、规划、审校或记忆治理为代价削弱小说创造性和输出质量”设为 `wenmi-longform-quality` 的最高产品约束，并形成可验证、可回滚的规则。

**架构：** Skill继续使用精简主流程加按需参考资料。新增独立创造性合同，将创作自由区、四种创作模式、九岗位差异化输入、先生成后软审校、经验进化和质量非劣效评测贯穿既有失败模型、运行闭环、RAG合同与E0—E4证据合同；项目当前规格同步同一决定。

**技术栈：** Codex Agent Skills、Markdown、YAML、Node.js确定性验证器、Vitest、Git。

## 全局约束

- 只修改 `D:\wenmixiezuo`，不读取、修改、停止或重启 `D:\AI智囊团`。
- 由当前Codex单独完成，不调用其他开发Agent。
- 不修改业务代码、数据库、迁移、生产正文或运行数据，不新增运行时依赖。
- 创造性和输出质量是部署门禁，不承诺数学意义上的“零影响”；任何治理机制必须通过相对旧流程或弱治理基线的盲评非劣效，证据不足则不得成为强制规则。弱治理基线仍保留正史、安全、版权、费用、隔离和不可逆操作硬门禁。
- 正史、版权、安全、费用、数据隔离和不可逆操作仍是硬门禁；软审美、风格、节奏和章纲建议不得伪装成硬事实。
- 使用同一 `release_id`：`wm-v1-20260716-220959-d5dd704d`。

---

### 任务1：登记老板决定与任务边界

**文件：**

- 修改：`docs/DECISIONS.md`
- 修改：`TASKS.md`
- 修改：`docs/COVERAGE_MATRIX.md`

**产物：**

- 新增DEC-010，规定创造性保护优先、四种创作模式、约束分级、九岗位完整上下文、先创作后软审校、经验防固化和非劣效门禁。
- 新增 `QUALITY-20260718-02` 任务账本条目，包含目标、非目标、负责人、文件、依赖、约束、验收、命令、停止、回滚和复核。

**验证：**

```powershell
rg -n "DEC-010|QUALITY-20260718-02|创造性|非劣效" docs/DECISIONS.md TASKS.md docs/COVERAGE_MATRIX.md
```

### 任务2：重构Skill核心与界面元数据

**文件：**

- 修改：`.agents/skills/wenmi-longform-quality/SKILL.md`
- 修改：`.agents/skills/wenmi-longform-quality/agents/openai.yaml`
- 创建：`.agents/skills/wenmi-longform-quality/references/creativity-and-output-quality.md`

**产物：**

- 最高原则改为“双底线”：减少长篇系统性失败，同时不压平创造性、人物声音和文学输出。
- 增加四种模式：开放讨论、创意推演、暂存试写、正式生产；只有正式生产强制完整结算链。
- 增加约束分级：硬事实、任务目标、软倾向、自由创作区、重大候选；软规则不能阻断第一稿。
- 创造性合同定义最小必要检索、约束胶囊与灵感调色板分离、完整首稿后再软审校、少数意见保留、经验可撤销和非劣效评测。

**验证：**

```powershell
rg -n "最高约束|开放讨论|创意推演|暂存试写|正式生产|自由创作区|非劣效" .agents/skills/wenmi-longform-quality
```

### 任务3：改造失败模型、运行回路和混合RAG合同

**文件：**

- 修改：`.agents/skills/wenmi-longform-quality/references/longform-failure-model.md`
- 修改：`.agents/skills/wenmi-longform-quality/references/runtime-quality-loops.md`
- 修改：`.agents/skills/wenmi-longform-quality/references/context-and-rag.md`

**产物：**

- 新增过度约束、检索锚定、过早审校、共识压缩、偏好固化和经验固化失败模式。
- 运行流程按四种模式分流；硬预检只处理事实和安全，软审校在完整草稿后进行。
- 补齐主编、编剧、设定师、主笔、审校、体验官、文编、研究员和版权顾问九岗位上下文合同。
- 主笔上下文拆成“必须遵守的约束胶囊”和“可选灵感调色板”，检索遵循最小充分原则，不以召回数量为质量。

**验证：**

```powershell
rg -n "过度约束|检索锚定|过早审校|共识压缩|偏好固化|经验固化|体验官|文编|研究员|版权顾问" .agents/skills/wenmi-longform-quality/references
```

### 任务4：升级长篇质量评测合同与确定性验证器

**文件：**

- 修改：`.agents/skills/wenmi-longform-quality/references/evaluation-contract.md`
- 修改：`.agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs`
- 修改：`tests/skill-evals/wenmi-longform-quality/cases.md`
- 修改：`tests/skill-evals/wenmi-longform-quality/fixtures/audit-complete.md`
- 创建：`tests/skill-evals/wenmi-longform-quality/fixtures/audit-missing-creativity.md`
- 创建：`tests/skill-evals/wenmi-longform-quality/fixtures/audit-overconstrained.md`
- 创建：`tests/skill-evals/wenmi-longform-quality/fixtures/audit-quotes-overconstraint.md`
- 修改：`tests/skill-evals/wenmi-longform-quality/validate-audit.test.ts`

**产物：**

- 审计输出新增“创造性与输出质量保护”必填章节。
- 验证器要求创作自由、非劣效、盲评和基线；拒绝明确要求所有创作机械服从大纲或把创造性从属于一致性的方案。
- 对抗案例增加完整流程滥用、全量检索、边写边审、章纲绝对化、偏好固化、成员同质化、经验永久化和20章过度外推。
- 评测使用成对盲评、多次采样、分维度结果和20/50/100—200章分层验证；一致性提升不能用加权平均掩盖创造性下降。

**验证：**

```powershell
npx.cmd vitest run tests/skill-evals/wenmi-longform-quality/validate-audit.test.ts
node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/LONGFORM_QUALITY_GAP.md
```

### 任务5：同步当前产品质量规格

**文件：**

- 修改：`AGENTS.md`
- 修改：`docs/LONGFORM_QUALITY.md`
- 修改：`docs/LONGFORM_QUALITY_GAP.md`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/AGENT_SYSTEM.md`
- 修改：`docs/MEMORY.md`
- 修改：`docs/ACCEPTANCE.md`

**产物：**

- 项目门禁明确：治理机制不能以降低创造性或输出质量换取一致性指标。
- 产品支持四种创作模式，探索和试写不进入正史，也不被完整生产链阻塞。
- 九岗位使用差异化任务和资料；主笔自由创作区、软审校延后、经验验证后版本化沉淀。
- 验收新增创作质量非劣效、原创性/惊喜/人物可辨识度/情绪力度、九岗位上下文和长规模纵向验证。

**验证：**

```powershell
rg -n "创造性|自由创作区|非劣效|四种模式|九个岗位|经验" AGENTS.md docs/LONGFORM_QUALITY.md docs/LONGFORM_QUALITY_GAP.md docs/PRODUCT.md docs/AGENT_SYSTEM.md docs/MEMORY.md docs/ACCEPTANCE.md
```

### 任务6：完整验证、证据和交付

**文件：**

- 创建：`docs/releases/wm-v1-20260716-220959-d5dd704d/increments/2026-07-18-creativity-preserving-skill.md`

**步骤：**

1. 运行Skill官方结构校验。
2. 运行审计验证器正反夹具和目标Vitest。
3. 运行 `npm.cmd run verify`，证明文档与测试变更未破坏类型、全量测试和生产构建。
4. 运行迁移、Repository隔离和恢复测试；本任务无Schema变更，结果应继续通过。
5. 只读核验现有文秘写作健康状态，不停止已有服务。
6. 创建核心提交，运行干净工作树 `npm.cmd run acceptance`。
7. 写入增量验收证据和最终任务状态，创建证据提交，再次验收并推送私有远程。

**完成标准：**

- Skill主文档、5份参考、9岗位、四种模式、创造性非劣效和持续进化规则相互一致。
- 正反验证器测试全部通过，明确过度约束方案无法通过。
- 全量类型、测试、构建、迁移/隔离/恢复、运行和发布验收通过。
- 工作树干净，本地 `main` 与 `origin/main` 一致。

**回滚：**

- 使用 `git revert` 回退本增量提交；不改写历史。
- 若创造性合同导致审查输出机械化，先关闭新增强制结构检查并保留老板DEC-010原则，再修订Skill，不删除历史证据。
