import { describe, expect, it } from 'vitest';
import { authorErrorMessage } from '../../apps/web/src/lib/api/author-error';

describe('作者错误说明', () => {
  it('不把内部实现词直接展示给作者', () => {
    const message = authorErrorMessage('正史索引请求未由指定Worker持有');
    expect(message).toBe('这次操作没有完成。请稍后再试；如果仍然失败，请重新打开这本书。');
    expect(message).not.toMatch(/正史索引|Worker|持有/u);
  });

  it('告诉作者定稿内容为什么不能直接覆盖', () => {
    expect(authorErrorMessage('正史已结算正文只读')).toBe('这章已经定稿，不能直接覆盖或删除。需要修改时，请新建一个修改版本。');
  });

  it('保留本来就清楚的错误，并替换少量产品术语', () => {
    expect(authorErrorMessage('候选保存失败')).toBe('待确认内容保存失败');
    expect(authorErrorMessage('书名不能为空')).toBe('书名不能为空');
  });
});
