import { Service, WritableSignal, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Auth } from './auth';
import { environment } from '../../environments/environment';

export type ThemeChoice = 'light' | 'dark' | null;
export type MouseMod = 'Shift' | 'Ctrl' | 'Alt';

// What a person chose for themselves: their changed shortcut keys, the held keys of the Scratchpad's mouse rows,
// and light or dark. Saved per person on the server (GET and PUT /me/settings) so they follow the person to any
// browser, and kept in this browser too, so the page starts with them before the server has answered and works
// signed out. The first time someone signs in with nothing saved on the server, what this browser had is
// carried up once. After that the server wins.
export interface MySettings {
  shortcuts: Record<string, string[]>;
  mouse: Record<string, MouseMod>;
  theme: ThemeChoice;
}

const KEYS = { shortcuts: 'stock-listing-shortcuts', mouse: 'stock-listing-mouse', theme: 'stock-listing-theme' } as const;
// Whose settings this browser holds: an account id, or nothing when they were made signed out. A browser two
// people share never carries one person's keys into the other's account.
const OWNER = 'stock-listing-settings-owner';
const SAVE_MS = 600;

@Service()
export class SettingsStore {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private url = environment.apiUrl + '/me/settings';

  readonly shortcuts = signal<Record<string, string[]>>(readLocal('shortcuts', {}));
  readonly mouse = signal<Record<string, MouseMod>>(readLocal('mouse', {}));
  readonly theme = signal<ThemeChoice>(readLocal('theme', null));

  private loadedFor: number | null = null;
  private loading: number | null = null;
  // A change made while the person's settings were on their way: it is newer, so it wins over what arrives
  private changedWhileLoading = new Set<keyof MySettings>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Whenever someone signs in, their own settings are fetched. Signed out, this browser's are used.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => { if (id !== this.loadedFor) void this.fetch(id); });
    });
  }

  set<K extends keyof MySettings>(key: K, value: MySettings[K]): void {
    (this[key] as WritableSignal<MySettings[K]>).set(value);
    writeLocal(key, value);
    const id = this.auth.user()?.id ?? null;
    // Signed out, the change stays in this browser and keeps whoever it belonged to
    if (id == null) return;
    if (this.loadedFor !== id) {
      // Not loaded yet, or the first try failed: try again, and this change goes up once it has
      this.changedWhileLoading.add(key);
      if (this.loading !== id) void this.fetch(id);
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), SAVE_MS);
  }

  private async fetch(id: number | null): Promise<void> {
    this.loadedFor = null;
    this.loading = id;
    if (id == null) return;
    try {
      const saved = await firstValueFrom(this.http.get<MySettings & { updatedAt: string | null }>(this.url));
      if (this.auth.user()?.id !== id) return;
      this.loadedFor = id;
      const owner = readOwner();
      // What this browser holds belongs to this person, or to nobody signed in, or to someone else
      const mine = owner === null || owner === id;
      const changed = new Set(this.changedWhileLoading);
      this.changedWhileLoading.clear();
      setOwner(id);
      if (saved.updatedAt == null && mine) {
        // A first sign in with nothing on the server: what this browser had, made by this person or signed out, goes up
        if (Object.keys(this.shortcuts()).length || Object.keys(this.mouse()).length || this.theme()) await this.send();
        return;
      }
      // The server's, or the defaults when the server has nothing and the browser held someone else's. A setting
      // changed here while they were on their way is newer, so it stays and goes up.
      const fresh = saved.updatedAt == null;
      if (!changed.has('shortcuts')) this.adopt('shortcuts', fresh ? {} : saved.shortcuts ?? {});
      if (!changed.has('mouse')) this.adopt('mouse', fresh ? {} : saved.mouse ?? {});
      if (!changed.has('theme')) this.adopt('theme', fresh ? null : saved.theme ?? null);
      if (changed.size) await this.send();
    } catch {
      // The server didn't answer: this browser's settings stay, and the next change tries again
    } finally {
      if (this.loading === id) this.loading = null;
    }
  }

  private adopt<K extends keyof MySettings>(key: K, value: MySettings[K]): void {
    (this[key] as WritableSignal<MySettings[K]>).set(value);
    writeLocal(key, value);
  }

  private async send(): Promise<void> {
    this.timer = null;
    try {
      await firstValueFrom(this.http.put(this.url, { shortcuts: this.shortcuts(), mouse: this.mouse(), theme: this.theme() }));
    } catch {
      // Kept in this browser; the next change sends the whole set again
    }
  }
}

function readLocal<K extends keyof MySettings>(key: K, fallback: MySettings[K]): MySettings[K] {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw == null) return fallback;
    if (key === 'theme') return (raw === 'light' || raw === 'dark' ? raw : null) as MySettings[K];
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<K extends keyof MySettings>(key: K, value: MySettings[K]): void {
  try {
    if (key === 'theme') {
      if (value) localStorage.setItem(KEYS.theme, value as string); else localStorage.removeItem(KEYS.theme);
    } else {
      localStorage.setItem(KEYS[key], JSON.stringify(value));
    }
  } catch {
    // Blocked storage, the choice lasts until the page is closed
  }
}

function readOwner(): number | null {
  try {
    const raw = localStorage.getItem(OWNER);
    return raw == null ? null : Number(raw);
  } catch {
    return null;
  }
}

function setOwner(id: number | null): void {
  try {
    if (id == null) localStorage.removeItem(OWNER); else localStorage.setItem(OWNER, String(id));
  } catch {
    // Blocked storage: nothing is kept to carry anywhere
  }
}
