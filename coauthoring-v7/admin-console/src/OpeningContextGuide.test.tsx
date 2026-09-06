// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OpeningContextGuide,OpeningContextSnapshot,PromptRuleFields} from './OpeningContextGuide';
import type {V7PromptManifestDetail,V7PromptAssetSummary} from './platform-api';
afterEach(cleanup);
it('开书入口连接同一版本化资产，缺失配置不能冒充可修改',()=>{
  const onEdit=vi.fn(),onTraces=vi.fn();
  const assets=[{assetKey:'workstation.opening',published:{title:'开书资料工位',version:2}}] as V7PromptAssetSummary[];
  render(<OpeningContextGuide assets={assets} onEdit={onEdit} onTraces={onTraces}/>);
  fireEvent.click(screen.getByRole('button',{name:/开书资料工位/}));
  expect(onEdit).toHaveBeenCalledWith('workstation.opening');
  expect(screen.getByRole('button',{name:/role.chief_editor/})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'高级排障：查询历史调用'}));
  expect(onTraces).toHaveBeenCalledOnce();
});
it('分项编辑只替换对应规则，保留工位标识与其他配置',()=>{
  const onChange=vi.fn();
  render(<PromptRuleFields value={JSON.stringify({workstationKey:'opening',requiredInputs:['作者想法'],stageBoundary:'只改开书'})} onChange={onChange}/>);
  fireEvent.change(screen.getByLabelText('需要的输入资料（每行一项）'),{target:{value:'作者想法\n作者调整意见'}});
  expect(JSON.parse(onChange.mock.calls[0]![0])).toEqual({workstationKey:'opening',requiredInputs:['作者想法','作者调整意见'],stageBoundary:'只改开书'});
});
it('只展示已保存的开书请求并兼容旧快照中的作者意见',()=>{
  const detail={manifest:{workstationKey:'opening',compiledPrompt:JSON.stringify({contextPack:{content:{stageTaskPayload:{authorSource:{originalIdea:'最初人物'},currentCandidates:{openingPackage:{authorInstructions:['改为张三']}}}}}})}} as V7PromptManifestDetail;
  render(<OpeningContextSnapshot detail={detail}/>);
  fireEvent.click(screen.getByText(/^作者调整意见 ·/));
  expect(screen.getByText(/^作者调整意见 ·/).closest('details')).toHaveTextContent('改为张三');
  expect(screen.getByText(/^作者调整意见 ·/).closest('details')).toHaveAttribute('open');
});
