import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settings-store';
import { Auth } from './auth';
import { TrayStore } from './board/tray-store';
import { Shortcuts } from './shortcuts';
import { provideRouter } from '@angular/router';
import { environment } from '../../environments/environment';
import { provideInfrastructure } from '../infrastructure/providers';

const me = environment.apiUrl + '/me/settings';
const user = {
  id: 3,
  username: 'ada',
  role: 'admin' as const,
  disabled: false,
  mustChangePassword: false,
  createdAt: 'c',
  lastLoginAt: null,
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Settings per person', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ...provideInfrastructure(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('carries what this browser had up once, the first time someone signs in', async () => {
    localStorage.setItem('stock-listing-shortcuts', JSON.stringify({ 'sp.select': ['X'] }));
    localStorage.setItem('stock-listing-theme', 'dark');
    const store = TestBed.inject(SettingsStore);
    TestBed.inject(Auth).user.set(user);
    TestBed.tick();
    http.expectOne(me).flush({ shortcuts: {}, mouse: {}, theme: null, updatedAt: null });
    await tick();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === me);
    expect(put.request.body).toEqual({
      shortcuts: { 'sp.select': ['X'] },
      mouse: {},
      theme: 'dark',
    });
    expect(store.theme()).toBe('dark');
  });

  it('takes what the server has once it has something, and keeps a copy in this browser', async () => {
    localStorage.setItem('stock-listing-theme', 'light');
    const store = TestBed.inject(SettingsStore);
    TestBed.inject(Auth).user.set(user);
    TestBed.tick();
    http.expectOne(me).flush({
      shortcuts: { 'sp.hand': ['Q'] },
      mouse: { 'mouse.add': 'Alt' },
      theme: 'dark',
      updatedAt: 'u',
    });
    await tick();
    http.expectNone((r) => r.method === 'PUT');
    expect(store.theme()).toBe('dark');
    expect(localStorage.getItem('stock-listing-theme')).toBe('dark');
    expect(TestBed.inject(Shortcuts).bound()['sp.hand']).toEqual(['Q']);
    expect(TestBed.inject(Shortcuts).mouseMod('mouse.add')).toBe('Alt');
  });

  it('sends a change once, a moment after it, while signed in', async () => {
    const store = TestBed.inject(SettingsStore);
    TestBed.inject(Auth).user.set(user);
    TestBed.tick();
    http.expectOne(me).flush({ shortcuts: {}, mouse: {}, theme: null, updatedAt: 'u' });
    await tick();
    vi.useFakeTimers();
    store.set('theme', 'dark');
    store.set('theme', 'light');
    vi.advanceTimersByTime(700);
    const puts = http.match((r) => r.method === 'PUT');
    expect(puts.length).toBe(1);
    expect(puts[0].request.body.theme).toBe('light');
  });

  it("never carries another person's settings up from a shared browser, and starts them on the defaults", async () => {
    localStorage.setItem('stock-listing-settings-owner', '9');
    localStorage.setItem('stock-listing-shortcuts', JSON.stringify({ 'sp.select': ['X'] }));
    localStorage.setItem('stock-listing-theme', 'dark');
    const store = TestBed.inject(SettingsStore);
    TestBed.inject(Auth).user.set(user);
    TestBed.tick();
    http.expectOne(me).flush({ shortcuts: {}, mouse: {}, theme: null, updatedAt: null });
    await tick();
    http.expectNone((r) => r.method === 'PUT');
    expect(store.theme()).toBeNull();
    expect(store.shortcuts()).toEqual({});
    expect(localStorage.getItem('stock-listing-settings-owner')).toBe('3');
  });

  it('keeps a setting changed while they load, and sends it on top of the rest from the server', async () => {
    const store = TestBed.inject(SettingsStore);
    TestBed.inject(Auth).user.set(user);
    TestBed.tick();
    const load = http.expectOne(me);
    store.set('theme', 'light');
    load.flush({ shortcuts: { 'sp.hand': ['Q'] }, mouse: {}, theme: 'dark', updatedAt: 'u' });
    await tick();
    expect(store.theme()).toBe('light');
    expect(store.shortcuts()).toEqual({ 'sp.hand': ['Q'] });
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({
      shortcuts: { 'sp.hand': ['Q'] },
      mouse: {},
      theme: 'light',
    });
  });

  it('leaves Ctrl+A to a note while typing, and gives it to the board otherwise', () => {
    const keys = TestBed.inject(Shortcuts);
    const run = vi.fn();
    keys.register('scratchpad', { 'sp.selectAll': run });
    const note = document.createElement('div');
    note.setAttribute('contenteditable', 'true');
    document.body.append(note);
    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(run).not.toHaveBeenCalled();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    note.remove();
    expect(keys.check('sp.selectAll', ['Ctrl+A']).error).toBe('');
    expect(keys.check('ov.compare', ['Ctrl+A']).error).toContain('The browser keeps');
  });
});

describe('Carry tray', () => {
  it('gives a snapshot back when putting it on the board is undone, and takes it again on redo', () => {
    TestBed.configureTestingModule({
      providers: [...provideInfrastructure(), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const tray = TestBed.inject(TrayStore);
    const snap = { id: 's1', kind: 'list' as const, title: 'Top 3', takenAt: 't', numbers: [] };
    const withSnap = {
      version: 1 as const,
      items: [{ id: 'i', type: 'snap' as const, x: 0, y: 0, w: 1, h: 1, snap }],
      lines: [],
      groups: [],
    };
    const without = { version: 1 as const, items: [], lines: [], groups: [] };
    const session = {};
    tray.placed({ session, n: 3 }, snap);
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/tray/s1'));
    tray.follow({ before: withSnap, after: without, step: { session, n: 3 } });
    expect(http.expectOne((r) => r.method === 'POST').request.body).toEqual(snap);
    tray.follow({ before: without, after: withSnap, step: { session, n: 3 } });
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/tray/s1'));
  });

  it('leaves the tray alone when a snapshot card is deleted and the delete is redone', () => {
    TestBed.configureTestingModule({
      providers: [...provideInfrastructure(), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const tray = TestBed.inject(TrayStore);
    const snap = { id: 's1', kind: 'list' as const, title: 'Top 3', takenAt: 't', numbers: [] };
    const withSnap = {
      version: 1 as const,
      items: [{ id: 'i', type: 'snap' as const, x: 0, y: 0, w: 1, h: 1, snap }],
      lines: [],
      groups: [],
    };
    const without = { version: 1 as const, items: [], lines: [], groups: [] };
    const session = {};
    tray.placed({ session, n: 3 }, snap);
    http.expectOne((r) => r.method === 'DELETE');
    // Step 5 deleted the card: undo and redo of it are not the placing
    tray.follow({ before: without, after: withSnap, step: { session, n: 5 } });
    tray.follow({ before: withSnap, after: without, step: { session, n: 5 } });
    // A placing on a board left behind doesn't count on the next one either
    tray.follow({ before: withSnap, after: without, step: { session: {}, n: 3 } });
    http.verify();
  });
});
