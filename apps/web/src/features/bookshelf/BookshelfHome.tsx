import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  BooksIcon,
  CaretRightIcon,
  DotsThreeVerticalIcon,
  PlusIcon,
  TrashIcon
} from '@phosphor-icons/react';
import type { BookData } from '../../lib/api/client';
import { bookStatusLabel, shortId } from '../../app/display-labels';

export function BookshelfHome({
  activeBooks, archivedBooks, busy, archiveOpen, bookMenuId, onCreate, onOpen, onToggleMenu,
  onArchive, onToggleArchive, onRestore, onPurge
}: {
  activeBooks: BookData[];
  archivedBooks: BookData[];
  busy: boolean;
  archiveOpen: boolean;
  bookMenuId: string | null;
  onCreate: () => void;
  onOpen: (bookId: string) => void;
  onToggleMenu: (bookId: string | null) => void;
  onArchive: (book: BookData) => void;
  onToggleArchive: () => void;
  onRestore: (book: BookData) => Promise<void>;
  onPurge: (book: BookData) => void;
}): React.JSX.Element {
  return <section className="bookshelf-home" aria-labelledby="bookshelf-title">
    <header className="bookshelf-heading">
      <div><span className="eyebrow">本地书架</span><h2 id="bookshelf-title">我的作品</h2><p>打开一本书进入独立创作工作台。其他书的后台任务会继续运行。</p></div>
      {activeBooks.length > 0 && <button className="primary-button" type="button" onClick={onCreate}><PlusIcon />创建新书</button>}
    </header>
    <div className="bookshelf-scroll-region">
      {activeBooks.length === 0 ? <EmptyLibrary onCreate={onCreate} /> : <div className="book-cover-grid" aria-label="活动书籍">
        {activeBooks.map((book, index) => <article className="book-cover-card" key={book.bookId}>
          <button className="book-cover-open" type="button" aria-label={`打开《${book.title}》`} onClick={() => onOpen(book.bookId)}>
            <span className={`book-cover-art cover-tone-${index % 5}`} aria-hidden="true"><BooksIcon /><b>{book.title.slice(0, 8)}</b><small>文秘写作</small></span>
            <span className="book-cover-copy"><strong>{book.title}</strong><small>{bookStatusLabel(book.status)} · 正式内容版本 {book.canonRevision}</small><time dateTime={book.updatedAt}>最近更新 {formatShelfDate(book.updatedAt)}</time></span>
          </button>
          <button className="book-cover-menu" type="button" aria-label={`管理《${book.title}》`} aria-expanded={bookMenuId === book.bookId} onClick={() => onToggleMenu(bookMenuId === book.bookId ? null : book.bookId)}><DotsThreeVerticalIcon /></button>
          {bookMenuId === book.bookId && <div className="book-action-popover shelf-popover"><button type="button" onClick={() => onArchive(book)}><ArchiveBoxIcon />移到归档</button><small>书籍资料原样保留，之后可以恢复</small></div>}
        </article>)}
      </div>}
      {archivedBooks.length > 0 && <section className="home-archive">
        <button className="home-archive-toggle" type="button" aria-expanded={archiveOpen} aria-label={`查看已归档书籍，共 ${archivedBooks.length} 本`} onClick={onToggleArchive}><ArchiveBoxIcon /><span>已归档书籍</span><small>{archivedBooks.length} 本</small><CaretRightIcon /></button>
        {archiveOpen && <div className="home-archive-list">{archivedBooks.map((book) => <article key={book.bookId}><span><strong>{book.title}</strong><small>已归档 · {formatShelfDate(book.updatedAt)} · 编号 {shortId(book.bookId)}</small></span><div><button type="button" disabled={busy} aria-label={`恢复《${book.title}》`} onClick={() => void onRestore(book)}><ArrowCounterClockwiseIcon />恢复</button><button className="danger-text-button" type="button" disabled={busy} aria-label={`彻底删除《${book.title}》`} onClick={() => onPurge(book)}><TrashIcon />彻底删除</button></div></article>)}</div>}
      </section>}
    </div>
  </section>;
}

function formatShelfDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function EmptyLibrary({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return <section className="empty-library"><div className="empty-glyph"><BooksIcon /></div><h2>把第一本书放进工作台</h2><p>先填写书名、主角、故事方向、主要标签和不能改变的要求。确认后会建立创作团队和本书资料，再由主编带你讨论下一步。</p><button className="primary-button" type="button" onClick={onCreate}><PlusIcon />创建新书</button></section>;
}
