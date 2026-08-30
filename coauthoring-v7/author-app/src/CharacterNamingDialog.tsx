import { XIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NamingAssistantPanel } from './NamingAssistantPanel';
import type { NamingContext } from './naming-assistant';

export function CharacterNamingDialog({
  context,
  identity,
  exclude,
  onSelect,
  onClose
}: {
  context: NamingContext;
  identity: string;
  exclude: string[];
  onSelect: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="character-naming-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="character-naming-dialog" role="dialog" aria-modal="true" aria-label="角色取名助手">
        <div className="character-naming-dialog-toolbar">
          <strong>为当前角色挑选姓名</strong>
          <button ref={closeButtonRef} type="button" aria-label="关闭取名助手" onClick={onClose}><XIcon /></button>
        </div>
        <NamingAssistantPanel
          context={context}
          initialTargetId={characterTarget(identity)}
          exclude={exclude}
          action="fill"
          compact
          onSelect={(name) => {
            onSelect(name);
            onClose();
          }}
        />
      </section>
    </div>,
    document.body
  );
}

export function characterNamingContext(input: {
  channel: 'male' | 'female' | 'general';
  category: string;
  genres: string[];
  tags: string[];
  storyDirection: string;
}): NamingContext {
  return {
    channel: input.channel === 'female' ? 'female' : 'male',
    category: input.category,
    subjects: input.genres,
    tags: input.tags,
    storyDirection: input.storyDirection
  };
}

function characterTarget(identity: string): string {
  if (/女主|女性|女子|女孩|少女|女人/u.test(identity)) return 'character-female';
  if (/男主|男性|男子|男孩|少年|男人/u.test(identity)) return 'character-male';
  return 'character-neutral';
}
