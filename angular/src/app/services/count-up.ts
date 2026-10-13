import { Signal, effect, signal, untracked } from '@angular/core';

// A number that counts up to its target instead of jumping, for the stat cards and counts on Browse.
// Must be called where an effect can be made (a field initialiser or a constructor). With reduced motion on,
// or a change too small to see, it jumps straight to the target.
export function countUp(target: Signal<number>, ms = 600): Signal<number> {
  const shown = signal(target());
  let frame = 0;
  effect(onCleanup => {
    const to = target();
    const from = untracked(shown);
    const still = typeof window === 'undefined'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || Math.abs(to - from) < 2;
    if (still) {
      shown.set(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease out, fast at first and settling on the number
      const eased = 1 - Math.pow(1 - t, 3);
      shown.set(Math.round(from + (to - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return shown.asReadonly();
}
