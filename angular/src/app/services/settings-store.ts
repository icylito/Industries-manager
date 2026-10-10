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
    if (this.loadedFor == null) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), SAVE_MS);
  }

  private async fetch(id: number | null): Promise<void> {
    this.loadedFor = null;
    if (id == null) return;
    try {
      const saved = await firstValueFrom(this.http.get<MySettings & { updatedAt: string | null }>(this.url));
      if (this.auth.user()?.id !== id) return;
      this.loadedFor = id;
      if (saved.updatedAt == null) {
        // Nothing on the server yet: what this browser had goes up, once
        if (Object.keys(this.shortcuts()).length || Object.keys(this.mouse()).length || this.theme()) await this.send();
        return;
      }
      this.adopt('shortcuts', saved.shortcuts ?? {});
      this.adopt('mouse', saved.mouse ?? {});
      this.adopt('theme', saved.theme ?? null);
    } catch {
      // The server didn't answer: this browser's settings stay, and nothing is sent until it does
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
