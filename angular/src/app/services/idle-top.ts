import { DestroyRef, Service, inject } from '@angular/core';

// After a while with nobody touching the page, the next time they come back it starts from the top.
// A page left open on a desk for an hour shouldn't greet someone halfway down a table they don't remember scrolling.
// "Coming back" is the tab becoming visible again, the window getting focus, or the first click, key or touch after the quiet spell.
@Service()
export class IdleTop {
  // How long the page has to sit untouched before the next return goes to the top
  static readonly IdleAfterMs = 5 * 60 * 1000;

  private lastActivity = Date.now();
  private stopped = false;

  constructor() {
    const win = typeof window === 'undefined' ? null : window;
    if (!win) return;
    const touch = () => this.touch();
    const back = () => this.back();
    const activity: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    for (const name of activity) win.addEventListener(name, touch, { passive: true });
    const returns: (keyof WindowEventMap)[] = ['focus', 'pointerdown', 'keydown', 'touchstart'];
    for (const name of returns) win.addEventListener(name, back, { passive: true, capture: true });
    const visible = () => { if (document.visibilityState === 'visible') this.back(); };
    document.addEventListener('visibilitychange', visible);
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      for (const name of activity) win.removeEventListener(name, touch);
      for (const name of returns) win.removeEventListener(name, back, { capture: true } as EventListenerOptions);
      document.removeEventListener('visibilitychange', visible);
    });
  }

  // Something happened, the quiet spell starts over
  touch(now = Date.now()) {
    this.lastActivity = now;
  }

  // The person is back. If the page sat quiet long enough, it goes to the top, in one jump, no animation.
  back(now = Date.now()): boolean {
    if (this.stopped) return false;
    const idle = now - this.lastActivity >= IdleTop.IdleAfterMs;
    this.lastActivity = now;
    if (!idle) return false;
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    return true;
  }
}
