import { Component, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Shortcuts, capsOf, comboOf } from '../../services/shortcuts';

// The Keyboard shortcuts panel. Kept deliberately plain (the user asked for it): a search box, one Reset button and a list of
// Function, What it does and Key. The key itself is the button. A new key applies the moment it is pressed, there is no Save.
// It sits in App next to the page, so the page can step aside behind it (styles.css, html.shortcuts-open) without scaling the panel too.
@Component({
  selector: 'app-shortcuts-panel',
  styleUrl: './shortcuts-panel.css',
  templateUrl: './shortcuts-panel.html',
})
export class ShortcutsPanel {
  protected keys = inject(Shortcuts);
  private injector = inject(Injector);
  private dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private search = viewChild<ElementRef<HTMLInputElement>>('search');

  query = signal('');
  // The key box that is open, with what was pressed and why it stopped (a key the browser keeps, or a key another function uses)
  rec = signal<{ id: string; pressed: string[]; error: string; clash: string[] } | null>(null);
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.keys.panelOpen();
      document.documentElement.classList.toggle('shortcuts-open', open);
      if (open) {
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.query.set('');
        this.rec.set(null);
        // The panel is drawn after this runs, so the search box is focused once it exists
        afterNextRender(() => this.search()?.nativeElement.focus(), { injector: this.injector });
      } else {
        this.opener?.focus({ preventScroll: true });
        this.opener = null;
      }
    });
  }

  rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rec = this.rec();
    const bound = this.keys.bound();
    return this.keys.listed()
      .map(c => {
        const mine = bound[c.id] ?? [];
        const editing = rec?.id === c.id;
        const caps = capsOf(editing ? rec!.pressed : mine);
        const message = editing
          ? rec!.error || (rec!.clash.length ? `"${rec!.clash[0]}" already uses this key. Take it over, or press a different key.` : '')
          : '';
        return {
          id: c.id, name: c.name, desc: c.desc, caps, editing, none: mine.length === 0,
          message, canTake: editing && rec!.clash.length > 0 && !rec!.error,
          text: (c.name + ' ' + c.desc + ' ' + caps.map(k => k.text).join(' ')).toLowerCase(),
        };
      })
      // The row being changed stays in the list even if the search no longer matches it
      .filter(r => r.editing || !q || r.text.includes(q));
  });

  close() {
    this.keys.togglePanel(false);
  }

  edit(id: string) {
    this.rec.set({ id, pressed: [], error: '', clash: [] });
    // The key box is drawn after this, focus it once it exists so the very next key press is the new key
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLInputElement>('.key-box input')?.focus(), { injector: this.injector });
  }

  // The first key pressed in the key box is the new key and it is applied at once. Only two things stop it:
  // a key the browser keeps for itself, and a key another function already uses (the person decides).
  record(e: KeyboardEvent) {
    const rec = this.rec();
    if (!rec || e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { this.rec.set(null); return; }
    const combo = comboOf(e);
    if (!combo) return;
    const check = this.keys.check(rec.id, [combo]);
    if (check.error || check.conflicts.length) {
      this.rec.set({ id: rec.id, pressed: [combo], error: check.error, clash: check.conflicts.map(c => c.name) });
      return;
    }
    this.keys.assign(rec.id, [combo]);
    this.rec.set(null);
  }

  takeOver() {
    const rec = this.rec();
    if (!rec || !rec.pressed.length) return;
    this.keys.assign(rec.id, rec.pressed, true);
    this.rec.set(null);
  }

  // While the panel is open it owns the keyboard. Esc closes it (or clears the search first, or cancels a key box).
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.keys.panelOpen()) return;
    // A key box is open but focus isn't on it yet or slipped off it (a very quick press, or a click on the blank part of the panel):
    // the key still goes to the box
    const on = e.target as HTMLElement;
    if (this.rec() && (on === document.body || on.closest?.('.key')) && e.key !== 'Tab') {
      this.record(e);
      return;
    }
    if (e.key === 'Escape' && !this.rec()) {
      e.preventDefault();
      if (this.query() && document.activeElement === this.search()?.nativeElement) this.query.set('');
      else this.close();
      return;
    }
    if (e.key === 'Tab') this.trapTab(e);
  }

  // Tab stays inside the panel
  private trapTab(e: KeyboardEvent) {
    const box = this.dialog()?.nativeElement;
    if (!box) return;
    const focusable = [...box.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const at = document.activeElement;
    if (!box.contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }
}
