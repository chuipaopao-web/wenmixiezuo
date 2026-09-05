import { foundationStatusSchema, type FoundationStatus } from "@wenmi-rebuild/contracts";
import { useEffect, useState } from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: FoundationStatus }
  | { status: "failed"; message: string };

export function App() {
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
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">独立基础 · 开发中</p>
        <h1 id="page-title">文秘写作作者端</h1>
        <p className="lede">
          这里是全新工程的作者入口外壳，用来验证独立构建、API 连接和安全配置。注册、登录和创作流程会在后续账号批次逐项实现。
        </p>
        <div className="actions">
          <button type="button" disabled>
            注册登录后续实现
          </button>
          <a href="/api/health">查看 API 状态</a>
        </div>
      </section>

      <section className="status-panel" aria-live="polite">
        <h2>基础状态</h2>
        {state.status === "loading" ? <p>正在检查本地 API...</p> : null}
        {state.status === "failed" ? (
          <div className="failure">
            <p className="warning">{state.message}。请检查 43282 API 和重构数据库后重试。</p>
            <button type="button" onClick={loadStatus}>
              重新检查
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <dl>
            <div>
              <dt>数据库配置</dt>
              <dd>{state.data.database.configured ? "已配置" : "未配置"}</dd>
            </div>
            <div>
              <dt>迁移基础</dt>
              <dd>{state.data.capabilities.migrations === "implemented" ? "已接入" : "未接入"}</dd>
            </div>
            <div>
              <dt>任务执行</dt>
              <dd>后续恢复批次实现</dd>
            </div>
          </dl>
        ) : null}
      </section>
    </main>
  );
}
