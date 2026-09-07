# 第152批：模型参数审计与稳定温度

## 最终状态：统一降温撤回，保留原配置

下文降温起点仅记录已撤回方案。用户最新强调准确与创作能力兼顾，覆盖初始统一低温选择。19项曾生效（版本29→48），现通过正常治理服务全部恢复原值（48→67），逐项断言通过，成员绑定、停岗、默认均未改动，无重启。原开书0.72、设定0.62、正文0.72、开书审查0.24、设定审查0.25继续有效；这些是既有基线，并非已证明最优。未修改历史任务快照。

真实小样：同一合成短设定、DeepSeek V4 Pro、现有方舟适配器、thinking disabled、各最多1000输出token，0.48一次5.104秒/152输入/127输出token；0.62一次6.133秒/152输入/146输出token。两者JSON可解析；0.48编造“以土代盐防饼霉变”，0.62较合理但有未经核实的耐存性和细节。没有证明最优温度或统计显著性，不据此改生产。合计304输入/273输出token，与Codex自身额度不同。审计before/after/restored及short-comparison.json位于/opt/wenmi-releases/temperature-152。未调用作者任务；仅现有模型额度两次合成请求。

## 初始审计与已撤回方案

用户要求全面检查所有模型成员、联网查推荐温度，调整为稳定优先、少量创意。范围为现有56席位、实际绑定、20种任务温度与适配器思考设置。使用现有治理配置热更新，不重写功能、不恢复未准入成员、不改模型首选或历史快照，不调用真实模型。

线上审计：43绑定（42文字、1图片）、13预留；23个原成员偏移全部0，其余候选使用任务温度。设计0.62—0.76、审查0.20—0.28，不能据此认定温度过高为根因。GLM两种已修复审查路径以及5.3开书为Chat enabled/low，其他GLM用途仍有旧协议限制。DeepSeek短结构化/审查关闭思考，大规划及正文开启预算；Kimi2.7强制思考，K3审查关闭；M3适配器关闭思考但没有席位绑定。S5图片不使用文字采样温度。

官方来源（2026-09-08核查）：
- [DeepSeek温度表](https://api-docs.deepseek.com/quick_start/parameter_settings/)：通用表默认1、创作1.5，不是V4长篇最佳值；[V4思考说明](https://api-docs.deepseek.com/guides/thinking_mode/)明确思考模式temperature不生效。我们的方舟代理通道不能仅凭原厂文档认定生效。
- [GLM5.3](https://docs.z.ai/guides/llm/glm-5.3)：示例temperature1，强制思考，effort默认max，可low；未找到5.3 Flash独立温度最佳实践，不冒充已有推荐。
- [Kimi2.7 Code](https://huggingface.co/moonshotai/Kimi-K2.7-Code)：强制思考，第三方推理推荐temperature1/top_p0.95；[K3](https://huggingface.co/moonshotai/Kimi-K3)：基准temperature1、effort max，不等于小说推荐。不能把低温作为唯一稳定手段。
- [MiniMax API](https://platform.minimax.io/docs/api-reference/text-openai-api)：默认temperature1，M3 top_p默认0.95；没有本产品节点最佳值。
- 豆包2.1 Turbo/S5未取得可核实的具体场景推荐温度。搜索出现的营销文章相互矛盾，未作为依据，也不把Pro资料当Turbo结论。

本产品保守起点（非厂商推荐/非质量提升实测）：开书0.55、设定0.48、全书卷链0.50、章纲0.42、正文/取名0.60；审查0.10—0.15、事实整理0.08—0.10、推荐0.18、配方0.45、封面工单0.25。全部位于现有合法区间。图片0.35配置保持。只调新任务请求值，采样是否实际生效取决于模型和模式，不改变top_p或思考协议以免混淆变量。证据与修改前后配置位于/opt/wenmi-releases/temperature-152。
