// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RhythmAssetsPage } from './RhythmAssetsPage';
import { DEFAULT_RHYTHM_POLICY } from '../../backend/planning-methods/rhythm-policy.js';
import * as api from './platform-api';
vi.mock('./platform-api',()=>({fetchRhythmPolicy:vi.fn(),publishRhythmPolicy:vi.fn(),previewRhythmPolicy:vi.fn()}));
beforeEach(()=>{ vi.resetAllMocks(); vi.mocked(api.fetchRhythmPolicy).mockResolvedValue({version:1,policy:structuredClone(DEFAULT_RHYTHM_POLICY),enabled:true,history:[],usage:[]}); vi.mocked(api.previewRhythmPolicy).mockResolvedValue({layers:[]}); });
afterEach(cleanup);
it('显示分层候选预览，修改发布后显示真实版本',async()=>{
  vi.mocked(api.publishRhythmPolicy).mockImplementation(async(_,policy)=>({version:2,policy,enabled:true,history:[],usage:[]}));
  render(<RhythmAssetsPage/>); await screen.findByText(`本层可用 · ${DEFAULT_RHYTHM_POLICY.layers.book_backbone.length}项`);
  fireEvent.click(screen.getByRole('button',{name:'章'})); expect(screen.getByText(`本层可用 · ${DEFAULT_RHYTHM_POLICY.layers.chapter_execution.length}项`)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('简短介绍'),{target:{value:'一项长期目标推进，每次成果改变局势。'}});
  fireEvent.click(screen.getByRole('button',{name:'发布共用配置'}));
  await waitFor(()=>expect(api.publishRhythmPolicy).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/版本 2 已发布/)).toBeVisible();
});
it('读取失败可重试，允许结构跨层使用，发布失败保留修改',async()=>{
  vi.mocked(api.fetchRhythmPolicy).mockRejectedValueOnce(new Error('暂时无法读取'));
  render(<RhythmAssetsPage/>); await screen.findByText('暂时无法读取'); fireEvent.click(screen.getByText('重新读取'));
  await screen.findByText(`本层可用 · ${DEFAULT_RHYTHM_POLICY.layers.book_backbone.length}项`); fireEvent.click(screen.getByRole('button',{name:'章'}));
  fireEvent.change(screen.getByLabelText('查找方法'),{target:{value:'六阶段'}});
  expect(screen.getByRole('button',{name:/六阶段/})).toBeVisible();
  fireEvent.change(screen.getByLabelText('名称'),{target:{value:'新的名称'}});
  vi.mocked(api.publishRhythmPolicy).mockRejectedValue(new Error('版本冲突'));
  fireEvent.click(screen.getByRole('button',{name:'发布共用配置'})); await screen.findByText('版本冲突'); expect(screen.getByLabelText('名称')).toHaveValue('新的名称');
});
