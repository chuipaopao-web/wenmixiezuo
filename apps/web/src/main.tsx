import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('缺少应用挂载点');
}

const hostname = window.location.hostname.toLowerCase();
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
const isAdminHost = hostname === 'admin.wenmixiezuo.com' || hostname.startsWith('admin.');
const isLocalAdminPath = isLocalHost
  && (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/'));
const AdminApplication = lazy(async () => import('./features/admin-console/AdminApp')
  .then((module) => ({ default: module.AdminApp })));
const AuthorApplication = lazy(async () => import('./app/App')
  .then((module) => ({ default: module.App })));
const Application = isAdminHost || isLocalAdminPath ? AdminApplication : AuthorApplication;

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<div role="status" aria-live="polite">正在进入工作台…</div>}><Application /></Suspense>
  </StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
