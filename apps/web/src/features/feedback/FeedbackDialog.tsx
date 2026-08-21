import { useState } from 'react';
import { submitUserFeedback } from '../../lib/api/client';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import './feedback.css';

export function FeedbackDialog({ bookId, onClose }: { bookId: string | null; onClose: () => void }): React.JSX.Element {
  const [category, setCategory] = useState<'bug' | 'experience' | 'suggestion' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    if (message.trim().length < 2) { setResult('请把遇到的问题或建议写清楚一点。'); return; }
    setBusy(true); setResult(null);
    try {
      await submitUserFeedback({ category, message: message.trim(), ...(bookId === null ? {} : { bookId }), pagePath: window.location.pathname + window.location.search });
      setResult('反馈已进入问题记录，我们会按真实页面和书籍定位处理。');
      setMessage('');
    } catch (reason) {
      setResult(authorErrorFromUnknown(reason, '反馈没有提交成功，请稍后重试。'));
    } finally { setBusy(false); }
  };
  return <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog feedback-dialog" role="dialog" aria-modal="true" aria-label="反馈问题">
      <header><div><h2>反馈问题</h2><p>失败任务会自动记录；这里可以补充你看到的现象和建议。</p></div><button type="button" aria-label="关闭反馈" onClick={onClose}>×</button></header>
      <label>反馈类型<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="bug">功能异常</option><option value="experience">交互不好用</option><option value="suggestion">功能建议</option><option value="other">其他</option></select></label>
      <label>具体情况<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：我在分卷页点击“开始设计本卷”后，一直停在准备资料。希望保留刚才填写的内容。" maxLength={2000} /></label>
      {result !== null && <p role="status">{result}</p>}
      <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy || message.trim().length < 2} onClick={() => void submit()}>{busy ? '正在提交…' : '提交反馈'}</button></footer>
    </section>
  </div>;
}
