import { foundationStatusSchema, type FoundationStatus } from "@wenmi-rebuild/contracts";
import { useEffect, useState } from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: FoundationStatus }
  | { status: "failed"; message: string };

export function AdminApp() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadStatus = () => {
    setState({ status: "loading" });
    const controller = new AbortController();
    fetch("/api/v1/foundation/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setState({ status: "failed", message: "本地 API 尚未通过基础检查" });
          return;
        }
        setState({ status: "ready", data: foundationStatusSchema.parse(await response.json()) });
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "failed",
          message: "本地 API 返回的基础状态暂时不可用"
        });
      });
    return () => controller.abort();
  };

  useEffect(() => {
    return loadStatus();
  }, []);

  return (
    <main className="admin-shell">
      <header>
        <p>Rebuild operations · batch 108</p>
        <h1>新后台基础控制台</h1>
      </header>
      <section className="grid" aria-label="基础模块状态">
        <article>
          <h2>工程隔离</h2>
          <p>独立 Vite 后台入口，绑定 127.0.0.1:43281。</p>
        </article>
        <article>
          <h2>API 边界</h2>
          <p>后台只读基础状态，不直接导入仓储或旧业务模块。</p>
        </article>
        <article>
          <h2>任务系统</h2>
          <p>本批只启动 Worker 外壳，不领取、不提交任务。</p>
        </article>
      </section>
      <section className="status" aria-live="polite">
        {state.status === "loading" ? "正在检查 API..." : null}
        {state.status === "failed" ? (
          <>
            <span>{state.message}。请检查 43282 API 和重构数据库后重试。</span>
            <button type="button" onClick={loadStatus}>
              重新检查
            </button>
          </>
        ) : null}
        {state.status === "ready" ? `数据库标记：${state.data.database.marker}` : null}
      </section>
    </main>
  );
}
