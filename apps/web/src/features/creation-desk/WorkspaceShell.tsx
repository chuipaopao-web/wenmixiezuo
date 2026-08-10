import { BooksIcon, WifiHighIcon, WifiSlashIcon, XIcon } from '@phosphor-icons/react';
import type { BookData, HealthData, WorkerData, WorkspaceData } from '../../lib/api/client';
import { bookDisplayTitle, bookStatusLabel } from '../../app/display-labels';

export function ServiceState({ health, worker, error }: { health: HealthData | null; worker: WorkerData | null; error: string | null }): React.JSX.Element {
  const ready = health?.status === 'ok' && worker?.status === 'ready' && error === null;
  return <div className={ready ? 'service-state ready' : 'service-state'} role="status" aria-live="polite">{ready ? <WifiHighIcon /> : <WifiSlashIcon />}<span>{ready ? '本地服务已就绪' : error === null ? '正在连接' : '服务不可用'}</span></div>;
}

export function TopbarBookSummary({ book, workspace }: { book: BookData | null; workspace: WorkspaceData | null }): React.JSX.Element {
  if (book === null) {
    return <div className="topbar-book-summary empty" aria-label="当前书籍"><span>请选择一本书</span></div>;
  }
  const volumeCount = workspace?.volumes?.length ?? 0;
  const chapterCount = volumeCount > 0
    ? workspace?.volumes?.reduce((total, volume) => total + volume.chapterCount, 0) ?? 0
    : workspace?.chapters.length ?? 0;
  const displayTitle = bookDisplayTitle(book.title);
  return (
    <div className="topbar-book-summary" aria-label={`当前书籍：《${displayTitle}》`}>
      <div className="topbar-book-title"><BooksIcon /><strong>{displayTitle}</strong></div>
      <div className="topbar-book-meta" aria-label="书籍进度">
        <span>{bookStatusLabel(book.status)}</span>
        <span>{volumeCount} 卷</span>
        <span>{chapterCount} 章</span>
        <span>正式内容版本 {book.canonRevision}</span>
      </div>
    </div>
  );
}

export function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }): React.JSX.Element {
  return <div className="drawer-header mobile-only"><strong>{title}</strong><button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><XIcon /></button></div>;
}

export function RailViewButton({ active, onClick, icon, label, accessibleLabel }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accessibleLabel?: string;
}): React.JSX.Element {
  return <button className={active ? 'active' : ''} type="button" aria-current={active ? 'page' : undefined} aria-label={accessibleLabel} onClick={onClick}>{icon}<span>{label}</span></button>;
}

