import { describe, expect, it } from 'vitest';
import { diagnoseTextEncoding, DamagedTextError } from '../../apps/api/src/application/chat/text-encoding-diagnostics.js';

describe('文本编码健康诊断', () => {
  it('正常中文与单个问号不判损坏', () => {
    const report = diagnoseTextEncoding('林澈抵达北塔了吗？是的。');
    expect(report.damaged).toBe(false);
    expect(report.reason).toBeNull();
    expect(report.replacementCharCount).toBe(0);
  });

  it('UTF-8 替换符判损坏并标注原因', () => {
    const report = diagnoseTextEncoding('老板说：��� 去做');
    expect(report.damaged).toBe(true);
    expect(report.reason).toBe('CONTAINS_UTF8_REPLACEMENT_CHAR');
    expect(report.replacementCharCount).toBe(3);
  });

  it('连续6个以上问号判损坏（问号串症状）', () => {
    const report = diagnoseTextEncoding('??????????');
    expect(report.damaged).toBe(true);
    expect(report.reason).toBe('SUSPICIOUS_QUESTION_MARK_RUN');
    expect(report.suspiciousQuestionMarkRun).toBe(10);
  });

  it('5个问号不判损坏（正常疑问叠加不误杀）', () => {
    const report = diagnoseTextEncoding('到底行不行?????');
    expect(report.damaged).toBe(false);
    expect(report.reason).toBeNull();
  });

  it('DamagedTextError 携带诊断报告', () => {
    const report = diagnoseTextEncoding('�');
    const error = new DamagedTextError(report);
    expect(error.name).toBe('DamagedTextError');
    expect(error.report.damaged).toBe(true);
    expect(error.report.reason).toBe('CONTAINS_UTF8_REPLACEMENT_CHAR');
  });
});
