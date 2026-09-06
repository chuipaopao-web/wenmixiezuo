// Reviewed synthetic node evidence, not a global permission to execute tasks.
export const OPENING_EVALUATION_REPORT = {
  version: 'opening-r132',
  testedAt: '2026-09-06T15:06:23.772Z',
  scope: '7个文字模型、14次同题测试及2次参数修复复测。沿用实际开书提示、分类目录和字段校验；审查使用含明确设定冲突与旧目录词条的共同候选。内容结论来自人工阅读，不代表所有题材或长篇质量。',
  rows: [
    {profileKey:'deepseek-v4-pro',node:'design',milliseconds:63883,structurePassed:true,quality:'passed',assessment:'保留唯一主角、无系统和知识落地代价，方向完整；作为现有设计首选继续验证完整流程。',outputTokens:3633},
    {profileKey:'deepseek-v4-pro',node:'review',milliseconds:18400,structurePassed:true,quality:'failed',assessment:'识别了系统冲突，但要求填写已明确弃用的goal、boundary空位，可能增加无效返修；不推荐为审查首选。',outputTokens:1243},
    {profileKey:'deepseek-v4-flash',node:'design',milliseconds:82293,structurePassed:false,quality:'unverified',assessment:'返回了内容，但使用目录外标签“穿越”；需要验证格式修复后再准入，不能直接上岗。',outputTokens:3561},
    {profileKey:'deepseek-v4-flash',node:'review',milliseconds:8403,structurePassed:true,quality:'passed',assessment:'识别作者明确禁止系统的冲突，给出修改卡；速度较快，仍需候选成员完整执行与恢复验证。',outputTokens:608},
    {profileKey:'glm-5.2',node:'design',milliseconds:84077,structurePassed:false,quality:'unverified',assessment:'目录外标签导致字段校验失败，暂不开放开书设计。',outputTokens:7657},
    {profileKey:'glm-5.2',node:'review',milliseconds:43912,structurePassed:false,quality:'unverified',assessment:'首轮400；修正思考参数后复测约44秒，仍没有可用文字。继续待验证。',outputTokens:null},
    {profileKey:'glm-5.3',node:'design',milliseconds:180010,structurePassed:false,quality:'unverified',assessment:'达到180秒测试期限，未取得可用结果；停止本次探针，不自动重发，继续停岗。',outputTokens:null},
    {profileKey:'glm-5.3',node:'review',milliseconds:105231,structurePassed:false,quality:'unverified',assessment:'约105秒后没有形成可用文字，继续停岗。',outputTokens:null},
    {profileKey:'kimi-k2.7-code',node:'design',milliseconds:68032,structurePassed:true,quality:'passed',assessment:'主角与无系统边界保留，方向完整，个别中英混杂措辞需润色；待候选成员完整流程验证。',outputTokens:2933},
    {profileKey:'kimi-k2.7-code',node:'review',milliseconds:74478,structurePassed:false,quality:'unverified',assessment:'首轮400；参数修正后约74秒仍未形成可用文字。设计成绩不能代替审查准入。',outputTokens:null},
    {profileKey:'kimi-k3',node:'design',milliseconds:180002,structurePassed:false,quality:'unverified',assessment:'达到180秒测试期限，未取得可用结果；不推荐新开书默认选择，历史任务保留。',outputTokens:null},
    {profileKey:'kimi-k3',node:'review',milliseconds:22799,structurePassed:true,quality:'passed',assessment:'识别系统冲突与旧分类，没有要求补写弃用空位；书名意见偏强，需保留作者决定权。',outputTokens:631},
    {profileKey:'doubao-seed-2.1-turbo',node:'design',milliseconds:132494,structurePassed:true,quality:'passed',assessment:'字段及作者硬要求保留，但约132秒，未比现有设计首选更快；暂不扩充执行名册。',outputTokens:7184},
    {profileKey:'doubao-seed-2.1-turbo',node:'review',milliseconds:17798,structurePassed:true,quality:'failed',assessment:'识别系统冲突，但修改建议又引入目录外标签“穿越”，尚需解决建议可执行性。',outputTokens:794}
  ]
};
