import { TestBed } from '@angular/core/testing';
import { IdleTop } from './idle-top';

describe('IdleTop', () => {
  it('goes to the top only after the page sat quiet for the idle time', () => {
    const idle = TestBed.inject(IdleTop);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const t0 = 1_000_000;
    idle.touch(t0);

    // Back after a minute: nothing happens
    expect(idle.back(t0 + 60_000)).toBe(false);
    expect(scroll).not.toHaveBeenCalled();

    // Quiet for the full idle time, then back: one jump to the top, no animation
    idle.touch(t0);
    expect(idle.back(t0 + IdleTop.IdleAfterMs)).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });

    // Coming back counts as activity, so a second return right after does nothing
    expect(idle.back(t0 + IdleTop.IdleAfterMs + 1000)).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('counts scrolling and typing as activity', () => {
    const idle = TestBed.inject(IdleTop);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const t0 = 2_000_000;
    idle.touch(t0);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0 + IdleTop.IdleAfterMs - 1000);
    window.dispatchEvent(new Event('scroll'));
    spy.mockReturnValue(t0 + IdleTop.IdleAfterMs + 1000);
    window.dispatchEvent(new Event('focus'));
    expect(scroll).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
