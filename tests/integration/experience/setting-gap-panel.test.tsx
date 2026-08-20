// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const api=vi.hoisted(()=>({fetchSettingGaps:vi.fn(),decideSettingGap:vi.fn()}));
vi.mock('../../../apps/web/src/lib/api/client',()=>api);
import {SettingGapPanel} from '../../../apps/web/src/features/planning/SettingGapPanel';

describe('按需补设定三选一面板',()=>{
  afterEach(()=>cleanup());
  beforeEach(()=>{
    vi.clearAllMocks();
    api.fetchSettingGaps.mockResolvedValue([{
      gapId:'gap-1',scopeType:'event',scopeId:'event-1',question:'古代引擎首次启动会失去哪段记忆？',
      whyNeeded:'当前事件的选择取决于主角是否愿意承担这次代价。',affectedObjects:['当前事件','后续章链'],
      decision:null,resolvedSettingVersionId:null,status:'pending',createdAt:'2026-08-20T00:00:00.000Z',updatedAt:'2026-08-20T00:00:00.000Z'
    }]);
    api.decideSettingGap.mockResolvedValue({});
  });

  it('用大白话展示缺口并提供补设计、本层不用、保持未知三个稳定按钮',async()=>{
    render(<SettingGapPanel bookId="book-1"/>);
    expect(await screen.findByText('古代引擎首次启动会失去哪段记忆？')).toBeInTheDocument();
    expect(screen.getByText('当前事件的选择取决于主角是否愿意承担这次代价。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'现在补充设计'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'这一层先不用'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'保持未知'}));
    await waitFor(()=>expect(api.decideSettingGap).toHaveBeenCalledWith('book-1','gap-1','keep_unknown'));
    await waitFor(()=>expect(api.fetchSettingGaps).toHaveBeenCalledTimes(2));
  });
});