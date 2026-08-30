import { describe, expect, it } from 'vitest';
import { canonicalMemberIdentityKey, publicRoleKey, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';

describe('作者端成员与岗位投影', () => {
  it('把历史临时席位统一翻译成七类固定岗位', () => {
    expect(publicRoleKey('structure_deputy')).toBe('deputy_editor');
    expect(publicRoleLabel('commercial_deputy')).toBe('副编');
    expect(publicRoleLabel('资料编审')).toBe('副编');
    expect(publicRoleLabel('outline_writer')).toBe('策划编剧');
    expect(publicRoleLabel('planning_maintainer')).toBe('记录编辑');
    expect(publicRoleLabel('independent_reviewer')).toBe('独立审查');
    expect(publicRoleLabel('visual_renderer')).toBe('视觉编剧');
  });

  it('按全局成员身份去重，并让有真实工作的快照优先', () => {
    const members = uniqueByMemberKey([
      { memberKey: 'chief-deepseek-v4-pro', role: 'chief_editor', status: 'waiting', message: '' },
      { memberKey: 'planning-chief-deepseek-v4-pro', role: 'structure_deputy', status: 'working', message: '正在核对本轮路线。' }
    ]);

    expect(members).toHaveLength(1);
    expect(members[0]).toEqual(expect.objectContaining({
      memberKey: 'chief-deepseek-v4-pro',
      status: 'working',
      message: '正在核对本轮路线。'
    }));
    expect(canonicalMemberIdentityKey('planning-chief-deepseek-v4-pro')).toBe('chief-deepseek-v4-pro');
  });

  it('没有真实工作内容时，不让旧的伪工作状态盖过固定成员状态', () => {
    const members = uniqueByMemberKey([
      { memberKey: 'chief-deepseek-v4-pro', role: 'chief_editor', presence: 'ready', currentWork: null },
      { memberKey: 'creation-chief-deepseek-v4-pro', role: 'structure_deputy', presence: 'working', currentWork: null }
    ]);

    expect(members).toEqual([
      expect.objectContaining({ memberKey: 'chief-deepseek-v4-pro', presence: 'ready' })
    ]);
  });

  it('不把模型品牌或供应商名称泄露到作者端状态文案', () => {
    for (const copy of [
      'DeepSeek V4 正在处理任务',
      'GLM-5.3 已经接单',
      'Kimi K3 正在生成方案',
      '豆包正在写正文',
      'MiniMax-M3 正在分析画面'
    ]) {
      expect(publicStatusCopy(copy, '编辑部正在处理这项工作。')).toBe('编辑部正在处理这项工作。');
    }
  });

  it('不把计划类型和内部提示治理对象泄露到作者端状态文案', () => {
    for (const copy of [
      'Coding Plan 正在执行',
      'Agent Plan 已完成请求',
      '正在整理 ContextPack',
      'PromptManifest 已冻结',
      'TaskContract 校验通过',
      '已装载 genre-fusion Skill'
    ]) {
      expect(publicStatusCopy(copy, '编辑部正在处理这项工作。')).toBe('编辑部正在处理这项工作。');
    }
  });
});
