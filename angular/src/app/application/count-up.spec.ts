import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { countUp } from './count-up';

describe('countUp', () => {
  it('starts on the target and jumps for a change too small to see', () => {
    TestBed.runInInjectionContext(() => {
      const target = signal(10);
      const shown = countUp(target);
      expect(shown()).toBe(10);
      target.set(11);
      TestBed.tick();
      expect(shown()).toBe(11);
    });
  });
});
