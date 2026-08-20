import { describe, expect, it } from 'vitest';
import { authorErrorFromUnknown, authorErrorMessage } from '../../apps/web/src/lib/api/author-error';

describe('作者错误说明', () => {
  it('不把内部实现词直接展示给作者', () => {
    const message = authorErrorMessage('正史索引请求未由指定Worker持有');
    expect(message).toBe('这次操作没有完成。请稍后再试；如果仍然失败，请重新打开这本书。');
    expect(message).not.toMatch(/正史索引|Worker|持有/u);
  });

  it('告诉作者定稿内容为什么不能直接覆盖', () => {
    expect(authorErrorMessage('正史已结算正文只读')).toBe('这章已经定稿，不能直接覆盖或删除。需要修改时，请另存一份修改稿。');
  });

  it('保留本来就清楚的错误，并替换少量产品术语', () => {
    expect(authorErrorMessage('候选保存失败')).toBe('待确认内容保存失败');
    expect(authorErrorMessage('书名不能为空')).toBe('书名不能为空');
  });

  it('文件路径、内部编号和资料查询错误不会穿透界面', () => {
    const message = authorErrorMessage('SQL error at C:\\private\\secret.sqlite, taskId=550e8400-e29b-41d4-a716-446655440000', 400);
    expect(message).toBe('这次操作没有完成。请稍后再试；如果仍然失败，请重新打开这本书。');
    expect(message).not.toMatch(/SQL|secret|taskId|550e8400/u);
  });

  it('页面异常入口同时阻断 Error 和原始字符串泄漏', () => {
    const internal = 'Worker SQL 失败：C:\\private\\wenmi.sqlite';
    expect(authorErrorFromUnknown(new Error(internal), '加载失败')).not.toMatch(/Worker|SQL|private|sqlite/u);
    expect(authorErrorFromUnknown(internal, '加载失败')).not.toMatch(/Worker|SQL|private|sqlite/u);
    expect(authorErrorFromUnknown(null, '加载失败')).toBe('加载失败');
  });
});