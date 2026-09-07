// Real bounded synthetic probes; reviewed semantics, not a global model ranking.
export const SETTING_EVALUATION_REPORT = {
  "version": "r147-setting-review-1",
  "testedAt": "2026-09-07T15:00:54.999Z",
  "scope": "七个当前文字型号，同一14项合成设定，3处预置冲突；仅测试设定审查，180秒/次、最多2并发、不补修。人工复核语义与正式字段；不代表设计、正文或全部题材通过。",
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
      "milliseconds": 180004,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "180秒内未正常交付，不参与速度排名及本节点自动接单。",
      "outputTokens": null
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
      "milliseconds": 131682,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "定位3/3处冲突并提供对应简洁修订；本轮较慢，作为备用。",
      "outputTokens": 5515
    }
  ]
};
