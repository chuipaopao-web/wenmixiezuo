import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runnerPath = resolve('scripts/evaluation/run-real-longform-validation.mjs');
const source = readFileSync(runnerPath, 'utf8');

describe('真实长篇验证脚本', () => {
  it('必须显式指定当前书和20/50/100/200章闸门', () => {
    expect(source).toContain("const BOOK_ID = process.env.WENMI_VALIDATION_BOOK_ID?.trim() ?? ''");
    expect(source).toContain("const OWNER_ID = process.env.WENMI_VALIDATION_OWNER_ID?.trim() || 'owner-local-boss'");
    expect(source).not.toContain("owner_id = 'owner-local-boss'");
    expect(source).toContain('当前owner下不存在这本未归档书籍');
    expect(source).toContain('if (BOOK_OWNERSHIP_VERIFIED) record');
    expect(source).toContain('[20, 50, 100, 200].includes(TARGET_CHAPTERS)');
    expect(source).toContain('必须显式设置 WENMI_VALIDATION_BOOK_ID');
  });

  it('不得携带旧书标识、旧剧情提示或通过聊天偷偷补规划', () => {
    expect(source).not.toContain('da2a9158-28ab-4c4a-ab2a-e3c4aae0fd77');
    expect(source).not.toContain('arcPrompts');
    expect(source).not.toContain('blockedRecoveryNotes');
    expect(source).not.toContain("/messages");
  });

  it('发布级运行默认逐章停在人工通读，两本登记测试书可使用项目经理统一授权', () => {
    expect(source).toContain("const AUTO_CONFIRM_E2 = ARGV.has('--auto-confirm-e2')" );
    expect(source).toContain('chapter_waiting_manual_reading');
    expect(source).toContain('RELEASE_MANAGER_CONFIRM');
    expect(source).toContain('RELEASE_MANAGER_BOOK_IDS');
    expect(source).toContain('RELEASE_MANAGER_OWNER_ID');
    expect(source).toContain('项目经理代确认只允许本轮两本已登记测试书');
    expect(source).toContain('assertReleaseReviewIsAcceptable');
    expect(source).toContain('pending-manuscript-review.json');
    expect(source).toContain('if (!CAN_CONFIRM_MANUSCRIPT) return pauseForManualReading');
    expect(source).toContain('RELEASE_MANAGER_BATCH_CAP = 3');
  });

  it('缺少正式章纲时必须停止，不得只凭章节标题生成正文', () => {
    expect(source).toContain('缺少已确认章纲');
    expect(source).toContain('真实长篇验证不会用聊天或脚本替作者补规划');
    expect(source).toContain("artifact_type === 'chapter_outline'");
    expect(source).toContain("active_version_status === 'selected'");
  });
});
