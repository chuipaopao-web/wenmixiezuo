// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiNodeBatchMemberView } from '@wenmi/contracts';
import {
  CandidatePanel,
  TeamProgress,
  V6Dialog,
  VersionedDraftPanel
} from '../../../apps/web/src/features/core-workflow/V6Shared';

const completedMember: AiNodeBatchMemberView = {
  batchMemberId: 'batch-member-1',
  member: {
    memberId: 'member-1', displayName: '婉儿', roleKey: 'screenwriter', roleLabel: '编剧',
    supplierCompany: 'OpenAI', baseCostTier: 'medium', status: 'completed', avatarKey: 'screenwriter', enabled: true
  },
  status: 'completed', attemptCount: 1, failureMessage: null,
  result: {
    resultId: 'result-1', candidateKind: 'setting',
    content: { title: '雾钟规则', summary: '钟声揭示未来，但每次都会付出代价。' },
    authorSummary: { preserved: ['代价'], adjusted: ['表达'], omitted: [] }
  }
};

afterEach(cleanup);

describe('V6共享工作流组件', () => {
  it('候选默认折叠，支持整份采用、分段采用和重新设计', () => {
    const onUse = vi.fn();
    const onRedesign = vi.fn();
    render(<CandidatePanel member={completedMember} onUse={onUse} onRedesign={onRedesign} />);

    expect(screen.queryByText('雾钟规则')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开方案' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '概要' }));
    fireEvent.click(screen.getByRole('button', { name: '采用所选 1 项' }));
    expect(onUse).toHaveBeenLastCalledWith({ summary: '钟声揭示未来，但每次都会付出代价。' });

    fireEvent.click(screen.getByRole('button', { name: '整份采用' }));
    expect(onUse).toHaveBeenLastCalledWith(completedMember.result?.content);
    fireEvent.click(screen.getByRole('button', { name: /重新设计/ }));
    expect(onRedesign).toHaveBeenCalledOnce();
  });

  it('进度从0%可见并正确表达部分成功恢复状态', () => {
    const { rerender } = render(<TeamProgress status="working" progress={{ completed: 0, failed: 0, total: 3, percent: 0 }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
    rerender(<TeamProgress status="partial_success" progress={{ completed: 2, failed: 1, total: 3, percent: 67 }} />);
    expect(screen.getByText('已有方案，可继续恢复失败成员')).toBeInTheDocument();
  });

  it('版本稿保留自由编辑、影响预览、整理、确认和重开动作', () => {
    const onChange = vi.fn(); const onOrganize = vi.fn(); const onConfirm = vi.fn(); const onReopen = vi.fn();
    render(<VersionedDraftPanel title="本卷方向" value="可编辑内容" versionLabel="候选第2版"
      impactPreview={<p>下游事件链需重新编译</p>} onChange={onChange} onOrganize={onOrganize} onConfirm={onConfirm} onReopen={onReopen} />);
    fireEvent.change(screen.getByRole('textbox', { name: '本卷方向编辑稿' }), { target: { value: '作者修改内容' } });
    expect(onChange).toHaveBeenCalledWith('作者修改内容');
    fireEvent.click(screen.getByText('查看确认影响'));
    expect(screen.getByText('下游事件链需重新编译')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '按此整理' }));
    fireEvent.click(screen.getByRole('button', { name: '确认此版本' }));
    fireEvent.click(screen.getByRole('button', { name: '重开并产生新版本' }));
    expect(onOrganize).toHaveBeenCalledOnce(); expect(onConfirm).toHaveBeenCalledOnce(); expect(onReopen).toHaveBeenCalledOnce();
  });

  it('弹层可用Escape关闭', () => {
    const onClose = vi.fn();
    render(<V6Dialog title="选择成员" onClose={onClose}><p>弹层内容</p></V6Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
