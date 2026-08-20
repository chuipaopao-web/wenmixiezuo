type MobileWindow = Pick<Window, 'innerHeight' | 'requestAnimationFrame' | 'visualViewport'>;

/**
 * 软键盘弹出后浏览器布局视口常仍保持原高度。用 visualViewport 把真正可见高度
 * 传给 CSS，并将当前输入框滚到可见区中部，使其下方的保存、生成、确认按钮仍可达。
 */
export function installMobileViewportBridge(
  documentRef: Document = document,
  windowRef: MobileWindow = window
): () => void {
  const viewport = windowRef.visualViewport;
  const root = documentRef.documentElement;
  const updateHeight = (): void => {
    const height = Math.max(320, Math.round(viewport?.height ?? windowRef.innerHeight));
    root.style.setProperty('--app-viewport-height', `${height}px`);
  };
  const revealActiveControl = (): void => {
    const active = documentRef.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.matches('input, textarea, select, [contenteditable="true"]')) return;
    windowRef.requestAnimationFrame(() => {
      if (typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }
    });
  };
  const onViewportChange = (): void => {
    updateHeight();
    revealActiveControl();
  };
  const onFocusIn = (): void => { windowRef.requestAnimationFrame(revealActiveControl); };

  updateHeight();
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  documentRef.addEventListener('focusin', onFocusIn);
  return () => {
    viewport?.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('scroll', onViewportChange);
    documentRef.removeEventListener('focusin', onFocusIn);
    root.style.removeProperty('--app-viewport-height');
  };
}