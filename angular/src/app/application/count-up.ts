import { effect, Signal, signal, untracked } from '@angular/core';

export interface CountUpOptions {
  // How long the count takes, in milliseconds
  ms?: number;
  // Start at 0 and count up on the first render too, instead of showing the first value at once
  fromZero?: boolean;
  // Round each step to a whole number, for counts that are always whole
  round?: boolean;
}

// A number that counts up to its target instead of jumping, for the stat cards and counts on Browse.
// Must be called where an effect can be made (a field initialiser or a constructor). With reduced motion on,
// or a change too small to see, it jumps straight to the target.
export function countUp(source: () => number, options: CountUpOptions = {}): Signal<number> {
  const ms = options.ms ?? 600;
  const round = options.round ?? true;
  const fromZero = options.fromZero ?? false;
  const shown = signal(fromZero ? 0 : source());
  let frame = 0;
  effect((onCleanup) => {
    const to = source();
    const from = untracked(shown);
    const still =
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      Math.abs(to - from) < 2;
    if (still) {
      shown.set(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease out, fast at first and settling on the number
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (to - from) * eased;
      shown.set(round ? Math.round(value) : value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return shown.asReadonly();
}
