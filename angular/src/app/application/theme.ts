import { Service, computed, effect, inject, signal } from '@angular/core';
import { SettingsStore } from './settings-store';

// Light or dark. Until the person presses the button the system setting decides (styles.css does that on its own).
// The choice is saved per person on the server with their other settings (services/settings-store.ts). This
// browser's copy is applied at once, so the page never flashes the other way while the server answers.
@Service()
export class Theme {
  private settings = inject(SettingsStore);
  private systemDark = signal(systemPrefersDark());

  isDark = computed(
    () => (this.settings.theme() ?? (this.systemDark() ? 'dark' : 'light')) === 'dark',
  );

  constructor() {
    // Whatever sets the choice, the button here or the server after sign in, the page follows
    effect(() => {
      const root = document.documentElement;
      const choice = this.settings.theme();
      if (choice) root.setAttribute('data-theme', choice);
      else root.removeAttribute('data-theme');
    });
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) =>
        this.systemDark.set(e.matches),
      );
    }
  }

  toggle() {
    const root = document.documentElement;
    // The colors fade for a moment, see theme-fade in styles.css
    root.classList.add('theme-fade');
    setTimeout(() => root.classList.remove('theme-fade'), 350);
    this.settings.set('theme', this.isDark() ? 'light' : 'dark');
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}
