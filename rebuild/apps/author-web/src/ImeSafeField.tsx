import { useRef, type ChangeEvent, type CompositionEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

function limitByCharacters(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join('');
}

function useImeLimit(maxChars: number, onValueChange: (next: string) => void): {
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
} {
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
  return <textarea {...rest} data-max-chars={maxChars} value={value} {...handlers} />;
}

type ImeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'> & {
  maxChars: number;
  value: string;
  onChange: (next: string) => void;
};

export function ImeInput({ maxChars, value, onChange, ...rest }: ImeInputProps): React.JSX.Element {
  const handlers = useImeLimit(maxChars, onChange);
  return <input {...rest} data-max-chars={maxChars} value={value} {...handlers} />;
}
