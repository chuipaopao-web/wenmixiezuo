// Reviewed synthetic node evidence; raw first runs and rechecks are archived separately.
export const OPENING_EVALUATION_REPORT = {
  "version": "opening-r149",
  "testedAt": "2026-09-07T16:53:02.779Z",
  "scope": "R149仅复测GLM5.3设计，Coding Chat low，同一合成想法：阶段提示首次17.9秒、完整岗位编译修复18.3秒，按合计36.3秒排名；非完整线上任务耗时。其余保留R133七型号各自设计/审查记录，修复计入耗时；阶段不同、协议不同，不是严格同参横向评测或长期平均。原始记录保留，设定另行验证。",
  "rows": [
    {
      "profileKey": "deepseek-v4-pro",
      "node": "design",
      "milliseconds": 113545,
      "firstMilliseconds": 73848,
      "repairMilliseconds": 39697,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首次返回格式/目录校验未通过，一次结构修复后可用。人工核对保留唯一主角、无系统及知识落地代价；仅代表本题样本。",
      "outputTokens": 2880
    },
    {
      "profileKey": "deepseek-v4-flash",
      "node": "design",
      "milliseconds": 132261,
      "firstMilliseconds": 49098,
      "repairMilliseconds": 83163,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首次返回格式/目录校验未通过，一次结构修复后可用。人工核对保留唯一主角、无系统及知识落地代价；仅代表本题样本。",
      "outputTokens": 5749
    },
    {
      "profileKey": "glm-5.3",
      "node": "design",
      "milliseconds": 36278,
      "firstMilliseconds": 17937,
      "repairMilliseconds": 18341,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "R149 Coding Chat low：同一合成想法首次17.9秒有目录外标签，完整岗位上下文修复18.3秒后通过。保留唯一主角、无系统、知识试错代价；按两次合计排名，非线上整任务或长期平均。仅开书设计准入，设定设计仍未通过。",
      "outputTokens": 1870
    },
    {
      "profileKey": "glm-5.3-flash",
      "node": "design",
      "milliseconds": 180001,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "达到180秒测试期限，未取得可用开书信息，本节点不接单。",
      "outputTokens": null
    },
    {
      "profileKey": "kimi-k2.7-code",
      "node": "design",
      "milliseconds": 120560,
      "firstMilliseconds": 68151,
      "repairMilliseconds": 52409,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首次返回格式/目录校验未通过，一次结构修复后可用。人工核对保留唯一主角、无系统及知识落地代价；仅代表本题样本。",
      "outputTokens": 2775
    },
    {
      "profileKey": "kimi-k3",
      "node": "design",
      "milliseconds": 180001,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "达到180秒测试期限，未取得可用开书信息，本节点不接单。",
      "outputTokens": null
    },
    {
      "profileKey": "doubao-seed-2.1-turbo",
      "node": "design",
      "milliseconds": 173028,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首轮返回可用。人工核对保留唯一主角、无系统及知识落地代价；仅代表本题样本。",
      "outputTokens": 11327
    },
    {
      "profileKey": "deepseek-v4-pro",
      "node": "review",
      "milliseconds": 8267,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首轮旧目录压力样本耗时12.2秒，存在不可执行的目录修改建议。在目录已由系统校验的共同候选中复测，正确识别禁止系统的冲突，修改卡字段正确；按本次复测耗时排序，不代表目录纠错能力。",
      "outputTokens": 442
    },
    {
      "profileKey": "deepseek-v4-flash",
      "node": "review",
      "milliseconds": 8800,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首轮旧目录压力样本耗时10.6秒，遗漏目录错误。在目录已由系统校验的共同候选中复测，正确识别禁止系统的冲突，修改卡字段正确；按本次复测耗时排序，不代表目录纠错能力。",
      "outputTokens": 438
    },
    {
      "profileKey": "glm-5.3",
      "node": "review",
      "milliseconds": 151639,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "未取得可用审查文字，本节点不接单。",
      "outputTokens": null
    },
    {
      "profileKey": "glm-5.3-flash",
      "node": "review",
      "milliseconds": 180005,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "未取得可用审查文字，本节点不接单。",
      "outputTokens": null
    },
    {
      "profileKey": "kimi-k2.7-code",
      "node": "review",
      "milliseconds": 75982,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "返回内容未通过格式或修改卡校验，不参与审查排名。",
      "outputTokens": 2318
    },
    {
      "profileKey": "kimi-k3",
      "node": "review",
      "milliseconds": 17939,
      "structurePassed": true,
      "quality": "passed",
      "assessment": "首轮旧目录压力样本耗时14.9秒，存在不可执行的目录修改建议。在目录已由系统校验的共同候选中复测，正确识别禁止系统的冲突，修改卡字段正确；按本次复测耗时排序，不代表目录纠错能力。",
      "outputTokens": 501
    },
    {
      "profileKey": "doubao-seed-2.1-turbo",
      "node": "review",
      "milliseconds": 24283,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "返回内容未通过格式或修改卡校验，不参与审查排名。",
      "outputTokens": 1064
    }
  ]
};
