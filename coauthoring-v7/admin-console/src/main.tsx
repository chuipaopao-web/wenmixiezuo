import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminRoot } from './AdminRoot';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('缺少管理台挂载点');

createRoot(root).render(
  <StrictMode>
    <AdminRoot />
  </StrictMode>
);
