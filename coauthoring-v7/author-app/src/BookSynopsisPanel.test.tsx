import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {BookSynopsisPanel} from './BookSynopsisPanel';
import {request} from './opening-api';
vi.mock('./opening-api',()=>({request:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const base={eligible:false,reason:'请先在时光机完成并采用全书基线，再生成简介。',adoptionId:null,profileVersion:1,saved:null,latest:null};
it('shows synopsis field and blocks generation until the baseline is adopted',async()=>{
 vi.mocked(request).mockResolvedValue(base);render(<BookSynopsisPanel bookId="book-a"/>);
 expect(await screen.findByRole('button',{name:'设计简介'})).toBeDisabled();expect(screen.getByLabelText('作品简介内容')).toBeVisible();
});
it('shows a generated draft and saves it explicitly without overwriting on generation',async()=>{
 const text='修理工与机甲的故事简介';
 vi.mocked(request).mockResolvedValueOnce({...base,eligible:true,adoptionId:'adopt-1'}).mockResolvedValueOnce({state:'candidate'}).mockResolvedValueOnce({...base,eligible:true,adoptionId:'adopt-1',latest:{id:'draft',state:'candidate',text,adoptionId:'adopt-1',profileVersion:1,expectedSavedId:null}}).mockResolvedValueOnce({...base,eligible:true,adoptionId:'adopt-1',saved:{id:'saved',text,stale:false}});
 render(<BookSynopsisPanel bookId="book-a"/>);fireEvent.click(await screen.findByRole('button',{name:'设计简介'}));
 await waitFor(()=>expect(screen.getByLabelText('作品简介内容')).toHaveValue(text));expect(screen.getByText('已生成草案，核对后保存。')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'保存简介'}));expect(await screen.findByText('已保存')).toBeVisible();
 expect(vi.mocked(request).mock.calls[3]?.[1]?.method).toBe('PUT');
});
it('keeps edits after a version conflict',async()=>{
 vi.mocked(request).mockResolvedValueOnce(base).mockRejectedValueOnce(new Error('简介已在其他页面更新，请刷新后再修改。'));
 render(<BookSynopsisPanel bookId="book-a"/>);fireEvent.change(await screen.findByLabelText('作品简介内容'),{target:{value:'作者自己的简介'}});fireEvent.click(screen.getByRole('button',{name:'保存简介'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('其他页面');expect(screen.getByLabelText('作品简介内容')).toHaveValue('作者自己的简介');
});
