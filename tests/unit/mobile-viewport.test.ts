// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMobileViewportBridge } from '../../apps/web/src/app/mobile-viewport';

class FakeVisualViewport {
  public height = 720;
  private readonly listeners = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener): void {
    const group = this.listeners.get(type) ?? new Set<EventListener>();
    group.add(listener);
    this.listeners.set(type, group);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--app-viewport-height');
});

describe('手机输入法可见区', () => {
  it('软键盘收缩可见区后更新布局高度并把输入框滚回可见区', () => {
    const viewport = new FakeVisualViewport();
    const scrollIntoView = vi.fn();
    const input = document.createElement('textarea');
    input.scrollIntoView = scrollIntoView;
    document.body.append(input);
    input.focus();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const cleanup = installMobileViewportBridge(document, {
      innerHeight: 800,
      requestAnimationFrame,
      visualViewport: viewport as unknown as VisualViewport
    });
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('720px');

    viewport.height = 360;
    viewport.emit('resize');
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('360px');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });

    cleanup();
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('');
  });
});