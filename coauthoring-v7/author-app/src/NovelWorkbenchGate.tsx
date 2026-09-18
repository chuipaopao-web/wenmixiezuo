import { CREATIVE_WORK_TYPE_LABELS, type CreativeWorkType } from '@wenmi/agent-catalog';
import { useEffect, useState } from 'react';
import { fetchBookProfile } from './opening-api';

/**
 * 长篇小说工作台能力门禁（R2）：时光机、卷/链/章等会新建或继续长篇任务的页面，
 * 必须先确认本书作品类型——加载中与读取失败都不挂载可发任务的界面；
 * 非长篇诚实显示尚未开放，开书资料可查看编辑；无类型快照的旧书按长篇处理。
 * 与服务端 assertNovelChainOpen 使用同一事实来源（book_creative_profiles）。
 */
export function NovelWorkbenchGate({ bookId, onOpenInformation, children }: {
  bookId: string;
  onOpenInformation: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [workType, setWorkType] = useState<CreativeWorkType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBookProfile(bookId, controller.signal).then((value) => {
      setWorkType(value.workType ?? 'novel');
      setError(null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '开书资料读取失败');
    });
    return () => controller.abort();
  }, [bookId, reloadAttempt]);

  if (workType === null && error === null) {
    return <section className="novel-create-surface" aria-label="确认可用功能"><div className="profile-loading" role="status">正在确认本书类型与可用功能…</div></section>;
  }
  if (error !== null) {
    return <section className="novel-create-surface" aria-label="可用功能确认失败"><div className="failure-card compact-failure-card" role="alert">
      <p className="eyebrow">暂时无法确认可用功能</p>
      <h2>开书资料读取失败</h2>
      <p>{error}</p>
      <button type="button" className="primary-action" onClick={() => { setError(null); setReloadAttempt((current) => current + 1); }}>重新读取</button>
    </div></section>;
  }
  if (workType !== 'novel') {
    return <section className="novel-create-surface" aria-label="后续创作工作台尚未开放"><div className="failure-card compact-failure-card" role="note">
      <p className="eyebrow">尚未开放</p>
      <h2>{CREATIVE_WORK_TYPE_LABELS[workType ?? 'novel'] ?? '该类型'}的后续创作工作台尚未开放</h2>
      <p>本书开书资料已确认并全部保留；设定、时光机与分卷创作目前仅对长篇小说开放，开放后这里会显示真实入口。</p>
      <button type="button" className="primary-action" onClick={onOpenInformation}>查看开书资料</button>
    </div></section>;
  }
  return <>{children}</>;
}
