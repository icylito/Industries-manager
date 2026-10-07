import { Signal, effect, signal } from '@angular/core';

// A number that counts up or down to its new value in about 0.65 seconds. Must be called where effect() works (a constructor or field).
// People who ask their system for less motion get the new number at once.
export function countUp(source: () => number): Signal<number> {
  const out = signal(0);
  let current = 0;
  let raf = 0;
  effect(onCleanup => {
    const target = source();
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame !== 'function') {
      current = target;
      out.set(target);
      return;
    }
    const from = current;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 650);
      current = from + (target - from) * (1 - Math.pow(1 - p, 3));
      out.set(current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(raf));
  });
  return out;
}
