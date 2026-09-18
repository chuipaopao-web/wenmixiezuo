/**
 * 冻结核定（915a3a79范围收窄，reviseAgain会话冻结输入——任何文本变化都会判为第三轮/冲突）：
 * 仅A1交接冲突必须澄清；A3/A6为建议不升级、A5仅A1因果必需时澄清、不重写v2。
 * 所有调用reviseAgain的脚本必须引用此唯一常量，禁止各文件自备文本漂移。
 */
export const FINAL_ADJUDICATION = [{
  issue: 'A1核定硬矛盾：v3:exit称"甲内连坐漏洞已修补，追责规则可执行"，v4:entry却称"连坐漏洞仍留隐患"——同一漏洞同一时间两条件不可同真；按正式来源澄清为v3暂堵/暴露而v4危机中修复（或不同漏洞/压力下新缺陷），成对核对交接，不与本卷转折相矛盾',
  sources: ['adjudication', 'self-check-anchors:revision-1#1', 'review-anchors:2#1']
}];
