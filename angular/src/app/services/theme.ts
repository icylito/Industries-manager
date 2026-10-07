import { Service, computed, signal } from '@angular/core';

const KEY = 'stock-listing-theme';

// Light or dark. Until the person presses the button the system setting decides (styles.css does that on its own).
// The choice is kept in this browser for now, the handoff wants it per person on the server once that is agreed.
@Service()
export class Theme {
  private choice = signal<'light' | 'dark' | null>(read());
  private systemDark = signal(systemPrefersDark());

  isDark = computed(() => (this.choice() ?? (this.systemDark() ? 'dark' : 'light')) === 'dark');

  constructor() {
    this.apply();
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => this.systemDark.set(e.matches));
    }
  }

  toggle() {
    this.choice.set(this.isDark() ? 'light' : 'dark');
    try {
      localStorage.setItem(KEY, this.choice()!);
    } catch {
      // Blocked storage, the choice lasts until the page is closed
    }
    const root = document.documentElement;
    // The colors fade for a moment, see theme-fade in styles.css
    root.classList.add('theme-fade');
    setTimeout(() => root.classList.remove('theme-fade'), 350);
    this.apply();
  }

  private apply() {
    const root = document.documentElement;
    const choice = this.choice();
    if (choice) root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
  }
}

function read(): 'light' | 'dark' | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}
