// Real bounded synthetic probes; reviewed semantics, not a global model ranking.
export const SETTING_EVALUATION_REPORT = {
  "version": "r148-setting-review-2",
  "testedAt": "2026-09-07T16:31:16.022Z",
  "scope": "七型号同一14项合成设定、3处冲突。R148仅复测GLM：Coding Chat、low推理，5.3两次、Flash一次；其他型号保留R147结果。180秒/次、不补修。仅代表本样本审查，不代表设计、正文或稳定速度。",
  "rows": [
    {
      "profileKey": "deepseek-v4-flash",
      "node": "review",
      "milliseconds": 9540,
      "structurePassed": true,
      "quality": "failed",
      "assessment": "定位2/3处冲突，漏掉两天步行与两小时到达的明确矛盾；本样本不准入审查。",
      "outputTokens": 460
    },
    {
      "profileKey": "deepseek-v4-pro",
      "node": "review",
      "milliseconds": 20188,
      "structurePassed": true,
      "quality": "failed",
      "assessment": "定位3/3处冲突，但修订新增未经资料支持的仓储及粮草判断能力，不满足最小证据修订。",
      "outputTokens": 1054
    },
    {
      "profileKey": "kimi-k2.7-code",
      "node": "review",
      "milliseconds": 66918,
      "structurePassed": false,
      "quality": "failed",
      "assessment": "定位3/3处冲突，但patches.issues返回字符串，正式合同要求问题对象；未花额度补修，本轮不准入。",
      "outputTokens": 2116
    },
    {
      "profileKey": "kimi-k3",
      "node": "review",
      "milliseconds": 33778,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "定位3/3处冲突，修订能力边界、姓名和行程；保留无冲突条目。",
      "outputTokens": 714
    },
    {
      "profileKey": "glm-5.3",
      "node": "review",
      "milliseconds": 9448,
      "structurePassed": true,
      "quality": "failed",
      "assessment": "低推理Chat两次8.1/9.4秒交付，均定位3/3；第二次把无超能力扩写成无特殊天赋，扩大作者限制，暂不自动准入。旧Messages为180秒未交付。",
      "outputTokens": 615
    },
    {
      "profileKey": "doubao-seed-2.1-turbo",
      "node": "review",
      "milliseconds": 88143,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "定位3/3处冲突，能力冲突给出修订，姓名与行程保留为明确待处理意见；不表示已自动解决全部冲突。",
      "outputTokens": 5535
    },
    {
      "profileKey": "glm-5.3-flash",
      "node": "review",
      "milliseconds": 11947,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "低推理Chat定位3/3，修订姓名，能力及行程保留明确待处理意见；11.9秒/517输出Token，旧Messages为131.7秒/5515。单样本，不表示全部冲突已自动修好。",
      "outputTokens": 517
    }
  ]
};
