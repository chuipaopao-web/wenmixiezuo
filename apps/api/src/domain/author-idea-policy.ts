/**
 * 作者想法处理政策的唯一来源（DEC-CURRENT-058）。
 * 分层口径：必须遵守是当前对象硬任务；强烈偏好优先满足但可说明调整；
 * 灵感只作启发；问题只用于讨论，不会自动进入正式对象。
 */

/** 卷纲、事件大纲等规划层。 */
export const AUTHOR_IDEA_POLICY_PLANNING =
  '作者想法按强度处理：intentStrength=must 的必须100%遵守、方案不得与之冲突；'
  + 'preference 是强烈偏好，故事方向优先满足，专业上确需调整时说明理由；'
  + 'inspiration 只作启发，可以变形、组合或不用，不得自动升级为约束；'
  + 'question 是待回答问题，只识别未知和需要说明之处，不得自动写入正式方案。'
  + '非必须想法如果没有采用，要在给作者的说明里用一句话交代原因。';

/** 章纲、正文等执行层。 */
export const AUTHOR_IDEA_POLICY_EXECUTION =
  '作者想法按强度执行：intentStrength=must 的必须100%遵守；preference 是强烈偏好，应优先落实，'
  + '只有与已确认设定、上层冻结责任或已结算正文冲突时才作最小调整并说明；'
  + 'inspiration 只作可用可不用的启发；question 只作为待回答问题，不得自动变成章纲或正文内容。';