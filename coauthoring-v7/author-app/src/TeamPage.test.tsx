import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPage } from './TeamPage';
import * as opening from './opening-api';

vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return { ...actual, fetchEditorialDepartment: vi.fn() };
});

const mockedOpening = vi.mocked(opening);

describe('V7统一团队编辑部', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOpening.fetchEditorialDepartment.mockResolvedValue(teamFixture());
  });
  afterEach(cleanup);

  it('按成员身份全局去重，无真实任务时如实显示空闲，也不展示永久题材倾向', async () => {
    render(<TeamPage />);
    expect(await screen.findByText('位成员')).toBeVisible();
    expect(screen.getAllByText('22')).toHaveLength(2);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('每位成员只显示一次；只有真实任务执行中，才会标为工作中。')).toBeVisible();

    for (const name of ['主编室', '副编室', '策划编剧组', '主笔组', '独立审查组', '资料记录组', '封面制作组']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'u') }));
    }

    const cards = document.querySelectorAll('.team-member-card');
    expect(cards).toHaveLength(22);
    expect(new Set([...cards].map((card) => card.querySelector('strong')?.textContent)).size).toBe(22);
    for (const writer of ['清照', '司马相如', '谢道韫', '曹雪芹', '柳永', '蒲松龄']) {
      expect(screen.getByText(writer)).toBeVisible();
    }
    expect(document.querySelectorAll('.team-member-head em')).toHaveLength(22);
    expect([...document.querySelectorAll('.team-member-head em')].every((node) => node.textContent === '空闲')).toBe(true);
    expect(screen.queryByText('永久擅长历史题材')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/chief_editor|planning_writer|lead_writer|model|prompt|temperature/u);
  });

  it('历史别名快照先出现时，仍按固定成员的规范岗位归入唯一部门', async () => {
    const fixture = teamFixture();
    const chief = fixture.departments.find((department) => department.departmentKey === 'chief_editor')!;
    const deputy = fixture.departments.find((department) => department.departmentKey === 'deputy_editor')!;
    const canonical = chief.members.shift()!;
    deputy.members.unshift({
      ...canonical,
      memberKey: 'creation-chief-deepseek-v4-pro',
      role: 'structure_deputy',
      presence: 'working',
      currentWork: '正在核对本书方向。'
    });
    chief.members.push(canonical);
    mockedOpening.fetchEditorialDepartment.mockResolvedValue(fixture);

    render(<TeamPage />);
    expect(await screen.findByText('位成员')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /主编室/u }));
    fireEvent.click(screen.getByRole('button', { name: /副编室/u }));

    expect(within(screen.getByRole('region', { name: '主编室' })).getByText('貂蝉')).toBeVisible();
    expect(within(screen.getByRole('region', { name: '副编室' })).queryByText('貂蝉')).not.toBeInTheDocument();
    expect(screen.getAllByText('貂蝉')).toHaveLength(1);
  });
});

function teamFixture(): opening.EditorialDepartmentView {
  const specs: Array<[opening.EditorialDepartmentView['departments'][number]['departmentKey'], string, Array<[string, string]>, string]> = [
    ['chief_editor', '内部主编池', [['chief-deepseek-v4-pro', '貂蝉'], ['chief-glm-5-3', '顾承砚'], ['chief-kimi-k3', '沈知微']], 'chief_editor'],
    ['deputy_editor', '内部上下文池', [['deputy-glm-5-3', '西施'], ['deputy-deepseek-v4-pro', '妙玉'], ['deputy-kimi-k3', '谢临川']], 'context_editor'],
    ['planning_writer', '内部方案池', [['planner-deepseek-v4-pro', '红玉'], ['planner-glm-5-3', '幼薇'], ['planner-kimi-k3', '苏映棠']], 'planning_writer'],
    ['lead_writer', '内部正文池', [['writer-kimi-k3', '清照'], ['writer-deepseek-v4-pro', '司马相如'], ['writer-deepseek-v4-flash', '谢道韫'], ['writer-glm-5-3', '曹雪芹'], ['writer-kimi-2-7', '柳永'], ['writer-doubao', '蒲松龄']], 'lead_writer'],
    ['independent_reviewer', '内部审查池', [['review-glm-5-3', '顾清辞'], ['review-deepseek-v4-pro', '陆观澜'], ['review-kimi-k3', '周行简']], 'independent_reviewer'],
    ['continuity_editor', '内部记录池', [['continuity-glm-5-3', '宋知遥'], ['continuity-deepseek-v4-pro', '裴文心'], ['continuity-kimi-k3', '沈墨']], 'continuity_editor'],
    ['visual_renderer', '内部视觉池', [['visual-seedream', '绘真']], 'visual_renderer']
  ];
  const departments: opening.EditorialDepartmentView['departments'] = specs.map(([departmentKey, name, identities, role]) => ({
    departmentKey, name,
    members: identities.map(([memberKey, displayName]) => ({
      memberKey, displayName, role,
      responsibility: `${role}职责`, capabilities: [`${role}能力`], presence: 'ready' as const,
      statusText: '我现在待命，有任务会马上接手。', currentWork: null, completedCount: 0
    }))
  }));
  departments[0]!.members[0]!.capabilities = ['永久擅长历史题材'];
  departments[1]!.members[0] = { ...departments[1]!.members[0]!, presence: 'working', statusText: '旧状态仍显示工作中', currentWork: null };
  departments[6]!.members.push({ ...departments[0]!.members[0]!, memberKey: 'creation-chief-deepseek-v4-pro', role: 'structure_deputy' });
  return { summary: { memberCount: 22, readyCount: 21, workingCount: 1, leaveCount: 0, completedCount: 0 }, departments };
}
