import { useRef, type ChangeEvent, type CompositionEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/**
 * 中文输入法安全限长：打拼音时字母只是"未定字"，不能占字数也不触发截断；
 * 文字落定（选词上屏）后才按字数截断。原生 maxLength 会把输入中的拼音字母算进长度，
 * 导致作者还没选词就被卡住，所以这里不用 maxLength。
 * 截断按 Unicode 码点计（Array.from），不会把 emoji 等多码点字符截成半个。
 */
function limitByCharacters(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join('');
}

interface ImeLimitHandlers {
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

function useImeLimit(maxChars: number, onValueChange: (next: string) => void): ImeLimitHandlers {
  const composing = useRef(false);
  return {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event) => {
      composing.current = false;
      onValueChange(limitByCharacters(event.currentTarget.value, maxChars));
    },
    onChange: (event) => {
      onValueChange(composing.current ? event.target.value : limitByCharacters(event.target.value, maxChars));
    }
  };
}

type ImeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'maxLength'> & {
  maxChars: number;
  value: string;
  onChange: (next: string) => void;
};

export function ImeTextarea({ maxChars, value, onChange, ...rest }: ImeTextareaProps): React.JSX.Element {
  const handlers = useImeLimit(maxChars, onChange);
  return <textarea {...rest} value={value} {...handlers} />;
}

type ImeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'> & {
  maxChars: number;
  value: string;
  onChange: (next: string) => void;
};

export function ImeInput({ maxChars, value, onChange, ...rest }: ImeInputProps): React.JSX.Element {
  const handlers = useImeLimit(maxChars, onChange);
  return <input {...rest} value={value} {...handlers} />;
}
