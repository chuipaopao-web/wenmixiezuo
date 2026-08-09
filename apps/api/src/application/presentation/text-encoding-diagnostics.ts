// R10：中文编码异常输入健康诊断。明显由编码损坏形成的高问号率或 UTF-8 替换符文本
// 不得进入模型；保留原始请求ID以便定位，但不把正常疑问文字误拒绝。
//
// 已暴露症状：一条老板消息变成连续问号串。根因可能来自终端/脚本编码而非 Web 主链，
// 因此本模块只做确定性诊断，由调用方决定拒绝或标记，不猜测来源。

export interface EncodingHealthReport {
  /** U+FFFD UTF-8 替换符个数 */
  replacementCharCount: number;
  /** 连续问号最长-run 长度（仅统计 >=6 的 run） */
  suspiciousQuestionMarkRun: number;
  totalLength: number;
  damaged: boolean;
  reason: 'CONTAINS_UTF8_REPLACEMENT_CHAR' | 'SUSPICIOUS_QUESTION_MARK_RUN' | null;
}

/**
 * 诊断文本是否疑似编码损坏。判定阈值：
 * - 含任意 U+FFFD 替换符 -> 损坏（解码失败已无法还原）
 * - 连续 6 个及以上 ASCII 问号 -> 损坏（问号串症状的典型特征）
 * 单个或少量问号（如"？？？"叠加疑问）不判损坏，避免误拒正常疑问文字。
 */
export function diagnoseTextEncoding(text: string): EncodingHealthReport {
  const replacementCharCount = (text.match(/�/g) ?? []).length;
  const runs = text.match(/\?{6,}/g) ?? [];
  const suspiciousQuestionMarkRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const damaged = replacementCharCount > 0 || suspiciousQuestionMarkRun >= 6;
  return {
    replacementCharCount,
    suspiciousQuestionMarkRun,
    totalLength: text.length,
    damaged,
    reason: damaged
      ? replacementCharCount > 0 ? 'CONTAINS_UTF8_REPLACEMENT_CHAR' : 'SUSPICIOUS_QUESTION_MARK_RUN'
      : null
  };
}

export class DamagedTextError extends Error {
  public constructor(public readonly report: EncodingHealthReport) {
    super('输入文本疑似编码损坏，包含 UTF-8 替换符或长问号串；请检查终端/脚本编码后重新发送');
    this.name = 'DamagedTextError';
  }
}
