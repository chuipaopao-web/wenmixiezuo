// Reviewed synthetic node evidence; raw first runs and rechecks are archived separately.
export const OPENING_EVALUATION_REPORT = {
  "version": "opening-r133",
  "testedAt": "2026-09-06T16:10:57.734Z",
  "scope": "当前7种文字模型先逐一设计，再逐一审查；共14个初测记录全部保留。3个设计格式错误做一次修复，按首次返回加修复总耗时排名。审查先用旧目录压力样本，随后对3个结构合格模型，用系统已校验目录且含禁止系统冲突的共同候选复核；这3个按复核耗时排名，其余保留初测失败。全部顺序执行、每调用180秒、同岗位同输入/参数；只是本题单次完整返回时间，不是首字速度或长期平均。",
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
      "milliseconds": 180005,
      "structurePassed": false,
      "quality": "unverified",
      "assessment": "达到180秒测试期限，未取得可用开书信息，本节点不接单。",
      "outputTokens": null
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
