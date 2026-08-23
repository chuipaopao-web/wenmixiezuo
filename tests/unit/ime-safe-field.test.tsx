// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImeInput, ImeTextarea } from '../../apps/web/src/features/shared/ImeSafeField';

afterEach(() => cleanup());

function InputHarness({ maxChars }: { maxChars: number }): React.JSX.Element {
  const [value, setValue] = useState('');
  return <ImeInput aria-label="测试输入" maxChars={maxChars} value={value} onChange={setValue} />;
}

function TextareaHarness({ maxChars }: { maxChars: number }): React.JSX.Element {
  const [value, setValue] = useState('');
  return <ImeTextarea aria-label="测试文本" maxChars={maxChars} value={value} onChange={setValue} />;
}

describe('输入法安全限长（拼音落定前不占字数）', () => {
  it('向页面暴露实际字数上限，便于表单与验收读取', () => {
    render(<TextareaHarness maxChars={800} />);
    expect(screen.getByLabelText('测试文本')).toHaveAttribute('data-max-chars', '800');
  });

  it('输入拼音字母过程中不截断，选词落定后才按字数截断', () => {
    render(<InputHarness maxChars={4} />);
    const input = screen.getByLabelText('测试输入');
    // 模拟中文输入法：composition 期间字母原样上屏、不触发限长
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'nihaonshijie' } });
    expect((input as HTMLInputElement).value).toBe('nihaonshijie');
    // 落定成 6 个汉字，超出 4 字上限，落定瞬间才截断
    fireEvent.compositionEnd(input, { target: { value: '你好世界人心' } });
    expect((input as HTMLInputElement).value).toBe('你好世界');
  });

  it('非输入法的普通输入仍然立即限长', () => {
    render(<TextareaHarness maxChars={3} />);
    const textarea = screen.getByLabelText('测试文本');
    fireEvent.change(textarea, { target: { value: 'abcdef' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('abc');
  });

  it('截断按字符计数，emoji 不会被截成半个乱码', () => {
    render(<TextareaHarness maxChars={2} />);
    const textarea = screen.getByLabelText('测试文本');
    fireEvent.change(textarea, { target: { value: '好😀家' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('好😀');
  });
});
