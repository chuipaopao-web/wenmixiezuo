import { createHash } from 'node:crypto';

/**
 * 整份设定质检的内容指纹：只对已确认条目的键与内容取哈希。
 * 作者在质检后改过任何已确认内容，指纹即变，旧报告自动作废。
 */
export function hashConfirmedSettings(items: Array<{ itemKey: string; content: string | null }>): string {
  const payload = items
    .filter((item) => item.content !== null)
    .map((item) => ({ itemKey: item.itemKey, content: item.content }))
    .sort((left, right) => left.itemKey.localeCompare(right.itemKey));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function hashSettingItemContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 主编质检指令：苛刻、直接、不客套；输出固定 JSON 结构，坏输出判无效重试。
 */
export const SETTING_QUALITY_AUDIT_INSTRUCTION = [
  '质检要求：你是本书主编，站在管理全书质量的角度，对上面整份已确认设定做一次苛刻检查：',
  '0.边界检查：这里只允许脱离具体人物和剧情仍成立的世界规则；主角、配角、反派、人物关系、关系进展、剧情对手或事件安排一律属于越界硬伤；',
  '1.跑题检查：每项设定必须与开书信息的方向一致，明显偏离的点名指出；',
  '2.逻辑检查：条目之间互相矛盾、内容重复、因果断裂的，逐条指出；',
  '3.可写性检查：空泛套话、无法指导后续写作的表述，逐条指出；',
  '4.完整度检查：核心项是否足以支撑后续分卷与正文。',
  '指出问题要直接、犀利、具体，不客套、不粉饰；确实没问题的项不要硬挑。',
  '每个设定项最多给一条问题；若同一项有多个问题，合并成一条，避免作者采纳一次后其余修改失效。',
  '每条具体设定项问题必须同时给出replacement：可直接替换该条目的完整修改后内容，不是局部句子，不得留空；itemKey为whole时replacement必须是空字符串。',
  '输出必须是可解析的JSON：{"fields":{"verdict":"pass或warn或fail","summary":"一段话总评","issues":[{"id":"i1","severity":"hard或soft","itemKey":"出问题的设定项键，整体问题用whole","problem":"问题是什么","suggestion":"修改思路","replacement":"该条目修改后的完整内容，整体问题则为空字符串"}]}}。',
  '有跑题、互相矛盾、无法指导写作这类硬伤时verdict必须是fail且issues里至少有一条hard；只有小瑕疵用warn；确实合格才用pass。'
].join('\n');
