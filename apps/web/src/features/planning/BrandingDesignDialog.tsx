import { useCallback, useEffect, useRef, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { XIcon } from '@phosphor-icons/react';
import {
  fetchLatestBrandingDesign,
  startBrandingDesign,
  updateBookProfile,
  type BookBrandingDesignData,
  type BookBrandingDesignKind,
  type BookProfileViewData
} from '../../lib/api/client';

const POLL_INTERVAL_MS = 2_000;

export function BrandingDesignDialog({ bookId, kind, profile, onClose, onApplied }: {
  bookId: string;
  kind: BookBrandingDesignKind;
  profile: BookProfileViewData;
  onClose: () => void;
  onApplied: (updated: BookProfileViewData) => Promise<void> | void;
}): React.JSX.Element {
  const [design, setDesign] = useState<BookBrandingDesignData | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const title = kind === 'title' ? '主编设计书名' : '主编设计书籍简介';

  const begin = useCallback(async (): Promise<void> => {
    setStartError(null);
    setDesign(null);
    try {
      const started = await startBrandingDesign(bookId, kind);
      if (!cancelledRef.current) setDesign(started);
    } catch (error) {
      if (!cancelledRef.current) {
        setStartError(authorErrorFromUnknown(error, '主编设计启动失败，请稍后再试。'));
      }
    }
  }, [bookId, kind]);

  useEffect(() => {
    cancelledRef.current = false;
    void begin();
    return () => { cancelledRef.current = true; };
  }, [begin]);

  useEffect(() => {
    if (design === null || design.status !== 'working') return;
    const timer = window.setInterval(() => {
      void fetchLatestBrandingDesign(bookId, kind)
        .then((next) => { if (!cancelledRef.current && next !== null) setDesign(next); })
        .catch(() => { /* 轮询失败等下一轮 */ });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [bookId, kind, design?.status, design?.designId]);

  const apply = async (text: string): Promise<void> => {
    setApplying(text);
    setApplyError(null);
    try {
      const updated = await updateBookProfile(bookId, {
        expectedVersion: profile.version,
        title: kind === 'title' ? text : profile.title,
        openingBlueprint: kind === 'synopsis'
          ? { ...profile.openingBlueprint, fullBookOutline: text }
          : profile.openingBlueprint
      });
      await onApplied(updated);
    } catch (error) {
      setApplyError(authorErrorFromUnknown(error, '采用失败，请刷新后再试。'));
      setApplying(null);
    }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog branding-design-dialog" role="dialog" aria-modal="true" aria-labelledby="branding-design-title">
      <div className="dialog-heading">
        <div><span className="dialog-eyebrow">主编 · {design?.member?.displayName ?? '貂蝉'}</span><h2 id="branding-design-title">{title}</h2></div>
        <button className="icon-button" type="button" aria-label="关闭主编设计" onClick={onClose}><XIcon /></button>
      </div>
      {startError !== null && <div className="branding-design-notice" role="alert">
        <p>{startError}</p>
        {startError.includes('第一卷')
          ? <button className="secondary-button" type="button" onClick={onClose}>知道了，先去设计第一卷</button>
          : <button className="secondary-button" type="button" onClick={() => void begin()}>重试</button>}
      </div>}
      {startError === null && (design === null || design.status === 'working') && <div className="branding-design-notice" role="status">
        <p>主编正在依据第一卷的故事、已确认设定和开书信息设计多套方案，通常需要几十秒，请稍等……</p>
      </div>}
      {design?.status === 'failed' && <div className="branding-design-notice" role="alert">
        <p>本轮设计没有完成，已保存的书籍信息不会丢失。可以重新让主编设计一组。</p>
        <button className="secondary-button" type="button" onClick={() => void begin()}>重新设计</button>
      </div>}
      {design?.status === 'cancelled' && <div className="branding-design-notice" role="status">
        <p>本轮设计已停止。</p>
        <button className="secondary-button" type="button" onClick={() => void begin()}>重新设计</button>
      </div>}
      {design?.status === 'succeeded' && <>
        <p className="branding-design-intro">主编给出了 {design.options.length} 套方案，选一个直接采用；都不满意可以关掉后重新设计。</p>
        <div className="branding-design-options">
          {design.options.map((option, index) => <article key={`${index}-${option.text.slice(0, 12)}`}>
            {kind === 'title' ? <strong>{option.text}</strong> : <p>{option.text}</p>}
            {option.note.length > 0 && <small>{option.note}</small>}
            <button
              className="secondary-button"
              type="button"
              disabled={applying !== null}
              onClick={() => void apply(option.text)}
            >{applying === option.text ? '采用中……' : '用这个'}</button>
          </article>)}
        </div>
        {applyError !== null && <p className="inline-error" role="alert">{applyError}</p>}
      </>}
    </section>
  </div>;
}
