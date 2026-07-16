import { useEffect, useState } from 'react';
import { fetchHealth, type HealthData } from '../lib/api/client';
import './app.css';

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then(setHealth).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '无法连接本地服务');
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <main className="foundation-shell">
      <section className="foundation-card" aria-labelledby="product-title">
        <p className="eyebrow">本地优先 · 多Agent小说工作台</p>
        <h1 id="product-title">文脉写作</h1>
        <p className="lead">把灵感整理成可追溯、可恢复、可持续生长的长篇小说。</p>
        <div className="health-line" role="status" aria-live="polite">
          <span className={health?.status === 'ok' ? 'health-dot ready' : 'health-dot'} />
          {health !== null ? `本地服务已就绪 · ${health.releaseId}` : error ?? '正在检查本地服务…'}
        </div>
      </section>
    </main>
  );
}

