import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../apps/web/src/app/app.css', import.meta.url), 'utf8');

describe.each([360, 390, 430])('分层规划移动端 %dpx', (viewportWidth) => {
  it('保持单列信息流、完整宽度操作和至少44px触控目标', () => {
    expect(viewportWidth).toBeLessThanOrEqual(650);
    expect(css).toMatch(/@media \(max-width: 650px\)\s*\{[\s\S]*?\.direction-choice-row \{ grid-template-columns: 1fr; \}[\s\S]*?\.direction-choice-row button, \.volume-direction-choice > footer button \{ width: 100%; \}/u);
    expect(css).toMatch(/@media \(max-width: 650px\)\s*\{[\s\S]*?\.golden-three-editor \{ grid-template-columns: 1fr; \}[\s\S]*?\.volume-impact-card \.button-row button \{ min-height: 44px; \}/u);
    expect(css).toMatch(/@media \(max-width: 650px\)\s*\{[\s\S]*?\.event-chain-candidate dl > div \{ grid-template-columns: 1fr;[\s\S]*?\.event-chain-candidate > footer \{ display: grid; \}/u);
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?\.event-planning-panel button:not\(\.story-event-node-card\), \.event-planning-panel summary \{ min-height: 44px; \}/u);
    expect(css).toMatch(/@media \(max-width: 780px\)\s*\{[\s\S]*?\.event-chapter-panel button, \.event-chapter-panel select, \.event-chapter-panel summary \{ min-height: 44px; \}/u);
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.setting-gap-actions \{ display: grid; grid-template-columns: 1fr; \}[\s\S]*?\.setting-gap-actions button \{ min-height: 44px; width: 100%; \}/u);
  });
});
const eventPanel = readFileSync(new URL('../../../apps/web/src/features/planning/EventPlanningPanel.tsx', import.meta.url), 'utf8');

describe('事件链作者输入交互', () => {
  it('把当前卷事件链想法作为可选折叠项，并在生成时提交有效引用', () => {
    expect(eventPanel).toContain('subjectType="event_sequence"');
    expect(eventPanel).toContain("surface:'event',subjectType:'event_sequence',subjectId:snapshot.plan!.volumePlanId");
    expect(eventPanel).toContain('expectedWorkflowVersion:snapshot.workflow.planningVersion,authorInputRefs');
    expect(eventPanel).toContain('补充你想要的事件顺序（可选）');
  });
});
