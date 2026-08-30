import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthorApp } from './AuthorApp';
import { AuthorAccountBoundary } from './AuthorAccountBoundary';
import './styles.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('V7 author app root is missing.');
}

createRoot(root).render(
  <StrictMode>
    <AuthorAccountBoundary>
      <AuthorApp />
    </AuthorAccountBoundary>
  </StrictMode>
);
