import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Auth } from './auth';
import { COMMANDS, Shortcuts, capsOf, comboOf, showKey } from './shortcuts';
import { Toast } from './toast';

const press = (key: string, over: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over });
  Object.defineProperty(e, 'target', { value: target });
  return e;
};

describe('comboOf', () => {
  it('names a key press the way the panel shows it', () => {
    expect(comboOf(press('z', { ctrlKey: true }))).toBe('Ctrl+Z');
    expect(comboOf(press('Escape'))).toBe('Esc');
    expect(comboOf(press('?', { shiftKey: true }))).toBe('?');
    expect(comboOf(press('g'))).toBe('G');
    expect(comboOf(press('ArrowLeft', { altKey: true }))).toBe('Alt+Left');
    expect(comboOf(press('Shift'))).toBeNull();
    expect(showKey('Alt+Left')).toBe('Alt+←');
    expect(capsOf(['G', 'O']).map(c => c.text)).toEqual(['G', 'then', 'O']);
  });
});

describe('Shortcuts', () => {
  let keys: Shortcuts;
  let ran: string[];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    keys = TestBed.inject(Shortcuts);
    ran = [];
    const run: Record<string, () => void> = {};
    for (const c of COMMANDS.filter(c => c.scope === 'overview')) run[c.id] = () => ran.push(c.id);
    keys.register('overview', run);
  });

  it('runs a command from its default key, and nothing without a page open', () => {
    const e = press('c');
    keys.onKey(e);
    expect(ran).toEqual(['ov.compare']);
    expect(e.defaultPrevented).toBe(true);
    const other = TestBed.inject(Shortcuts);
    expect(other).toBe(keys);
  });

  it('opens the panel with ? and does nothing else while it is open', () => {
    keys.onKey(press('?', { shiftKey: true }));
    expect(keys.panelOpen()).toBe(true);
    keys.onKey(press('c'));
    expect(ran).toEqual([]);
  });

  it('never fires a plain key while someone is typing, but does fire Ctrl combinations', () => {
    const input = document.createElement('input');
    keys.onKey(press('c', {}, input));
    expect(ran).toEqual([]);
    keys.assign('ov.compare', ['Alt+1']);
    keys.onKey(press('1', { altKey: true }, input));
    expect(ran).toEqual(['ov.compare']);
  });

  it('refuses a key the browser keeps and says why, changing nothing', () => {
    const r = keys.check('ov.compare', ['Ctrl+T']);
    expect(r.error).toContain('The browser keeps Ctrl+T for itself');
    expect(r.conflicts).toEqual([]);
    expect(keys.bound()['ov.compare']).toEqual(['C']);
  });

  it('names the function that already has a key, and Take it over leaves that function with no key', () => {
    const check = keys.check('ov.compare', ['M']);
    expect(check.conflicts.map(c => c.id)).toEqual(['ov.metric']);
    keys.assign('ov.compare', ['M'], true);
    expect(keys.bound()['ov.compare']).toEqual(['M']);
    expect(keys.bound()['ov.metric']).toEqual([]);
    expect(TestBed.inject(Toast).message()).toBe('Compare now uses M. Count or Average price has no key now.');
    // The old function can no longer be run from the keyboard, and the key belongs to one function only
    keys.onKey(press('m'));
    expect(ran).toEqual(['ov.compare']);
  });

  it('treats a key and a two key sequence that starts with it as a clash, and runs the sequence', () => {
    keys.assign('ov.find', ['G', 'F']);
    // G alone also starts the two key ways to another admin page, so it clashes with those too
    expect(keys.check('ov.top', ['G']).conflicts.map(c => c.id)).toEqual(['nav.overview', 'nav.scratchpad', 'ov.find']);
    keys.onKey(press('g'), 1000);
    keys.onKey(press('f'), 1500);
    expect(ran).toEqual(['ov.find']);
    // Too slow, the second key is just a key
    ran.length = 0;
    keys.onKey(press('g'), 1000);
    keys.onKey(press('f'), 1000 + 1300);
    expect(ran).toEqual([]);
  });

  it('keeps only what differs from the defaults, and Reset puts every key back', () => {
    keys.assign('ov.compare', ['X']);
    expect(JSON.parse(localStorage.getItem('stock-listing-shortcuts')!)).toEqual({ 'ov.compare': ['X'] });
    keys.assign('ov.compare', ['C']);
    expect(JSON.parse(localStorage.getItem('stock-listing-shortcuts')!)).toEqual({});
    keys.assign('ov.compare', ['X']);
    keys.assign('ov.top', ['Y']);
    keys.resetAll();
    expect(keys.bound()['ov.compare']).toEqual(['C']);
    expect(keys.bound()['ov.top']).toEqual(['T']);
  });

  it('closes the panel when the last page goes', () => {
    const run = { 'ov.clear': () => {} };
    const off = keys.register('overview', run);
    keys.togglePanel(true);
    off();
    expect(keys.hasPage()).toBe(false);
    expect(keys.panelOpen()).toBe(false);
  });

  it('goes to the Overview or the Scratchpad with G then O and G then S, and steps between the pages', () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'sam', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    const router = TestBed.inject(Router);
    const go = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    keys.onKey(press('g'), 1000);
    keys.onKey(press('o'), 1200);
    expect(go).toHaveBeenCalledWith('/overview');
    // Next page steps through the admin pages, and they wrap around
    keys.onKey(press(']'));
    expect(go).toHaveBeenLastCalledWith('/scratchpad');
    keys.onKey(press('g'), 3000);
    keys.onKey(press('s'), 3200);
    expect(go).toHaveBeenLastCalledWith('/scratchpad');
  });

  it('refuses Tab and Shift+Tab like the other keys the browser keeps', () => {
    expect(keys.check('ov.compare', ['Tab']).error).toContain('The browser keeps Tab');
    expect(keys.check('ov.compare', ['Shift+Tab']).error).toContain('The browser keeps Shift+Tab');
  });
});
