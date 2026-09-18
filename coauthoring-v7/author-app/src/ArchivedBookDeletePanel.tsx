import { useEffect, useState } from 'react';
import {
  fetchBookDeletePreview,
  permanentlyDeleteBook,
  type BookDeletePreview,
  type BookRecord
} from './opening-api';

const FIRST_CONFIRMATION = 'YES';
const SECOND_CONFIRMATION = '确认删除书籍';

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: BookDeletePreview };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 归档书永久确认面板：先向服务端取真实影响预览，再凭 YES + 二次确认词提交。
 * 计数只展示服务端统计，提交以 previewId 指纹绑定，过期会被拒绝并提示重新统计。
 */
export function ArchivedBookDeletePanel(props: {
  book: BookRecord;
  onDeleted: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { book, onDeleted, onCancel } = props;
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [firstText, setFirstText] = useState('');
  const [secondText, setSecondText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchBookDeletePreview(book.bookId)
      .then((preview) => {
        if (!controller.signal.aborted) setState({ status: 'ready', preview });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: reason instanceof Error ? reason.message : '暂时无法统计要删除的内容，请稍后重试。'
        });
      });
    return () => controller.abort();
  }, [book.bookId, reloadKey]);

  const submit = (): void => {
    if (state.status !== 'ready' || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    permanentlyDeleteBook(book.bookId, {
      expectedVersion: state.preview.book.version,
      confirmationText: firstText,
      secondConfirmationText: secondText,
      previewId: state.preview.previewId
    }).then(() => {
      onDeleted();
    }).catch((reason: unknown) => {
      setSubmitting(false);
      setSubmitError(reason instanceof Error ? reason.message : '删除没有完成，已保留全部数据，请重试。');
    });
  };

  if (state.status === 'loading') {
    return <div className="book-delete-confirm" role="status"><span>正在统计将删除的内容…</span></div>;
  }
  if (state.status === 'error') {
    return (
      <div className="book-delete-confirm" role="alert">
        <span>{state.message}</span>
        <div>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>重新统计</button>
          <button type="button" onClick={onCancel}>取消</button>
        </div>
      </div>
    );
  }

  const { preview } = state;
  const confirmed = firstText.trim().toUpperCase() === FIRST_CONFIRMATION && secondText.trim() === SECOND_CONFIRMATION;
  const canSubmit = preview.canDelete && confirmed && !submitting;
  return (
    <div className="book-delete-confirm">
      <strong>永久删除《{book.title}》后将无法恢复</strong>
      <ul>
        <li>关联任务 {preview.impact.taskCount} 项、时光机数据 {preview.impact.timeMachineRows} 行、其他关联数据 {Math.max(0, preview.impact.relatedRows - preview.impact.taskCount - preview.impact.timeMachineRows)} 行，全部一并删除。</li>
        <li>封面与导出文件 {preview.impact.fileCount} 个（{formatBytes(preview.impact.fileBytes)}）将从服务器移除。</li>
        <li>用量结算记录 {preview.impact.usageRecordsPreserved} 条会保留在账务归档中，不计入删除。</li>
      </ul>
      {!preview.canDelete && (
        <p role="alert">
          这本书还有正在进行的工作，暂时不能删除：
          {preview.activeWork.map((entry) => `${entry.table} × ${entry.count}`).join('；')}。
          请等工作结束后再试。
        </p>
      )}
      <label>
        <span>请输入 {FIRST_CONFIRMATION}</span>
        <input
          type="text"
          value={firstText}
          disabled={!preview.canDelete || submitting}
          onChange={(event) => setFirstText(event.target.value)}
          placeholder={FIRST_CONFIRMATION}
          autoComplete="off"
        />
      </label>
      <label>
        <span>请输入「{SECOND_CONFIRMATION}」</span>
        <input
          type="text"
          value={secondText}
          disabled={!preview.canDelete || submitting}
          onChange={(event) => setSecondText(event.target.value)}
          placeholder={SECOND_CONFIRMATION}
          autoComplete="off"
        />
      </label>
      {submitError !== null && (
        <p role="alert">
          {submitError}
          <button type="button" onClick={() => { setSubmitError(null); setReloadKey((key) => key + 1); }}>重新统计后再试</button>
        </p>
      )}
      <div>
        <button type="button" className="danger" disabled={!canSubmit} onClick={submit}>
          {submitting ? '正在删除…' : '永久删除'}
        </button>
        <button type="button" disabled={submitting} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
