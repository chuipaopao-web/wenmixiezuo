import { useState } from 'react';
import { ArchiveBoxIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import type { BookData } from '../../lib/api/client';

export function ArchiveBookDialog({ book, busy, onCancel, onConfirm }: { book: BookData; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> }): React.JSX.Element {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-book-title"><div className="dialog-heading"><div><span className="dialog-eyebrow">整理书架</span><h2 id="archive-book-title">归档《{book.title}》</h2><p>归档后会从主书架收起，不会删除正文或资料，可以随时恢复。</p></div><button className="icon-button" type="button" aria-label="关闭归档确认" onClick={onCancel}><XIcon /></button></div><div className="archive-impact"><ArchiveBoxIcon /><span><strong>可以恢复</strong><small>这本书暂时不再作为当前作品，所有内容都会保留。</small></span></div><footer><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={busy} onClick={() => void onConfirm()}>{busy ? '正在归档' : '确认归档'}</button></footer></section></div>;
}

export function PurgeBookDialog({ book, busy, onCancel, onConfirm }: {
  book: BookData;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (confirmationText: string) => Promise<void>;
}): React.JSX.Element {
  const required = 'YES';
  const [confirmation, setConfirmation] = useState('');
  const valid = confirmation.trim().toUpperCase() === required;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog purge-dialog" role="dialog" aria-modal="true" aria-labelledby="purge-book-title">
      <div className="dialog-heading"><div><span className="dialog-eyebrow danger">无法恢复</span><h2 id="purge-book-title">彻底删除《{book.title}》</h2><p>这会永久删除本书的正文、资料、任务、方案记录和附件，并留下删除记录。删除后无法恢复。</p></div><button className="icon-button" type="button" aria-label="关闭永久删除确认" onClick={onCancel}><XIcon /></button></div>
      <div className="purge-impact"><TrashIcon /><span><strong>只删除这一本已归档书</strong><small>其他书籍不会受到影响；本操作不提供撤销。</small></span></div>
      <label className="purge-confirmation"><span>请输入 YES 确认</span><code>{required}</code><input autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label="永久删除确认词" />{confirmation.length > 0 && !valid && <small className="purge-confirmation-error" role="alert">确认词不匹配，请输入 YES。</small>}</label>
      <footer><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="danger-button" type="button" disabled={busy || !valid} onClick={() => void onConfirm(required)}>{busy ? '正在彻底删除' : '彻底删除'}</button></footer>
    </section>
  </div>;
}

