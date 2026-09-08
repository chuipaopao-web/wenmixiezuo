// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FunctionManagement, relatedFunctionAssets } from './FunctionManagement';
import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
import type { V7PromptAssetSummary } from './platform-api';
import * as api from './platform-api';
vi.mock('./platform-api', () => ({ fetchV7PromptAssets: vi.fn(), fetchV7UnifiedAgentGovernance: vi.fn(), fetchV7PromptManifests: vi.fn(), fetchV7PromptManifest: vi.fn() }));
vi.mock('./MemberWorkspace', () => ({ MemberInput: () => <p>实际输入明细</p> }));
vi.mock('./PromptContextCenter', () => ({ PromptContextCenter: (p: { onDirtyChange: (v: boolean) => void; workstationKey: string; taskKindFilter: string }) => <div><p>限定：{p.workstationKey} / {p.taskKindFilter}</p><button onClick={() => p.onDirtyChange(true)}>修改测试规则</button><button onClick={() => p.onDirtyChange(false)}>保存测试草稿</button></div> }));
const unit = (id: string, name: string, station: string): RebuildUnit => ({ id, name, details: Object.entries({ 名称: name, 功能介绍: name+'功能介绍', 工位: station, 岗位: 'planning_writer', 任务类型: station+'_design', 流程: '系统组包 → 成员设计', 资料供给: '系统提供当前资料。', 共享步骤: 'AI-008' }).map(([k,v]) => ({label:'管理·'+k,text:v})).concat([{label:'实际AI节点·'+id,text:`${name}执行｜编剧｜设计｜用户提交。｜source.ts:1`}]) } as RebuildUnit);
const units = [unit('RB-19','开书','opening'),unit('RB-21','设定','setting')];
const asset = (version = 1): V7PromptAssetSummary => ({assetKey:'workstation.opening',kind:'workstation_prompt',latestVersion:version,versionCount:version,published:{version,title:'开书工位',summary:'通用规则',content:{taskKinds:['opening_design']}},latestDraft:null} as unknown as V7PromptAssetSummary);
beforeEach(() => {
  vi.resetAllMocks(); window.history.replaceState({}, '', '/v7/?section=rebuild');
  vi.mocked(api.fetchV7PromptAssets).mockResolvedValue([asset()]);
  vi.mocked(api.fetchV7UnifiedAgentGovernance).mockResolvedValue({ roles: [] } as never);
  vi.mocked(api.fetchV7PromptManifests).mockResolvedValue([]);
});
afterEach(cleanup);
it('按功能显示完整流程并嵌入该功能的规则编辑', async () => {
  render(<FunctionManagement units={units} onDetails={vi.fn()} onDirtyChange={vi.fn()} />);
  expect(screen.getByText('系统组包')).toBeVisible();
  expect(screen.getByText('开书执行')).toBeVisible();
  expect(screen.queryByText('设定执行')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'岗位、提示词与规则'}));
  fireEvent.click(await screen.findByRole('button',{name:'查看与调整'}));
  expect(screen.getByText('限定：opening / opening_design')).toBeVisible();
});
it('未保存时阻止功能切换与全局导航，保存后允许切换', async () => {
  const dirty = vi.fn(); render(<FunctionManagement units={units} onDetails={vi.fn()} onDirtyChange={dirty} />);
  fireEvent.click(screen.getByRole('button',{name:'岗位、提示词与规则'}));
  fireEvent.click(await screen.findByRole('button',{name:'查看与调整'}));
  fireEvent.click(screen.getByRole('button',{name:'修改测试规则'}));
  fireEvent.click(screen.getByRole('button',{name:'设定'}));
  expect(screen.getByRole('alert')).toHaveTextContent('尚未保存');
  expect(window.dispatchEvent(new Event('wenmi:admin-navigate',{cancelable:true}))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'保存测试草稿'}));
  fireEvent.click(screen.getByRole('button',{name:'设定'}));
  expect(screen.getByText('设定执行')).toBeVisible();
});
it('实时刷新读取新发布版本，失败明确提示保留旧数据', async () => {
  render(<FunctionManagement units={units} onDetails={vi.fn()} onDirtyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'岗位、提示词与规则'}));
  expect(await screen.findByText(/生效版本 1/)).toBeVisible();
  vi.mocked(api.fetchV7PromptAssets).mockResolvedValue([asset(2)]);
  fireEvent.click(screen.getByRole('button',{name:'刷新配置'}));
  expect(await screen.findByText(/生效版本 2/)).toBeVisible();
  vi.mocked(api.fetchV7PromptAssets).mockRejectedValue(Error('offline'));
  fireEvent.click(screen.getByRole('button',{name:'刷新配置'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
  expect(screen.getByText(/生效版本 2/)).toBeVisible();
});
it('样例按工位查询并校验任务类型，不混用其他功能记录', async () => {
  vi.mocked(api.fetchV7PromptManifests).mockResolvedValue([{manifestId:'wrong',workstationKey:'setting',taskKind:'setting_design'}] as never);
  render(<FunctionManagement units={units} onDetails={vi.fn()} onDirtyChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'实际资料与上下文'}));
  await screen.findByText('本功能最近记录中没有可展示的样例。');
  expect(api.fetchV7PromptManifests).toHaveBeenCalledWith({workstationKey:'opening',limit:30},expect.any(AbortSignal));
  expect(api.fetchV7PromptManifest).not.toHaveBeenCalled();
});
it('只用已发布任务关联规则，不把未发布草稿当作实际注入规则', () => {
  const skill={assetKey:'skill.test',kind:'skill',latestVersion:1,versionCount:1,published:null,latestDraft:{content:{triggerTaskKinds:['opening_design']}}} as unknown as V7PromptAssetSummary;
  expect(relatedFunctionAssets(units[0]!,[asset(),skill]).map(a=>a.assetKey)).toEqual(['workstation.opening']);
});
it('无管理档案时明确尚未登记', async () => {
  render(<FunctionManagement units={[]} onDetails={vi.fn()} onDirtyChange={vi.fn()} />);
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('尚未登记'));
});
