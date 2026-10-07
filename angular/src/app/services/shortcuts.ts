import { Service, computed, inject, signal } from '@angular/core';
import { Toast } from './toast';

// Customisable keyboard shortcuts, in the style of VS Code. Every key is a command that can be rebound from the Shortcuts panel.
// Commands are plain data. A page says which of them it can run (register), the service listens on the document, one listener for every page.
// The keys a person changed are kept in this browser for now. The handoff wants them per person on the server once the table is agreed.

// global works on every admin page, the others only on their own page
export type Scope = 'global' | 'overview';

export interface Command {
  id: string;
  name: string;
  desc: string;
  scope: Scope;
  // The default key, one key press like 'C' or 'Ctrl+Z', or two in a row (['G', 'O'] is G then O)
  def: string[];
}

export const COMMANDS: Command[] = [
  { id: 'keys.open', name: 'Show shortcuts', desc: 'Open this list. Esc closes it.', scope: 'global', def: ['?'] },
  ...[1, 2, 3, 4, 5].map(n => ({ id: 'ov.slice' + n, name: 'Split the circle', desc: 'Change what the circle is split by.', scope: 'overview' as Scope, def: [String(n)] })),
  { id: 'ov.find', name: 'Find an industry', desc: 'Jump to the search box to look up one industry.', scope: 'overview', def: ['/'] },
  { id: 'ov.compare', name: 'Compare', desc: 'Turn Compare on or off to set two slices side by side.', scope: 'overview', def: ['C'] },
  { id: 'ov.metric', name: 'Count or Average price', desc: 'Switch the bars between how many industries and their average price.', scope: 'overview', def: ['M'] },
  { id: 'ov.top', name: 'Switch the top list', desc: 'Cycle through Top 3, Top 10 and Cheapest 3.', scope: 'overview', def: ['T'] },
  { id: 'ov.clear', name: 'Clear filters', desc: 'Remove every filter at once.', scope: 'overview', def: ['Esc'] },
];

// Keys the browser or the system keeps for itself, a page can never use these reliably
export const RESERVED = [
  'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Tab', 'Ctrl+PageUp', 'Ctrl+PageDown', 'Ctrl+R', 'F5', 'F11', 'F12', 'Ctrl+L', 'Ctrl+Q',
  'Alt+Left', 'Alt+Right', 'Alt+F4', 'Ctrl+F', 'Ctrl+P', 'Ctrl+S', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Left', 'Ctrl+Right',
  'Cmd+T', 'Cmd+W', 'Cmd+N', 'Cmd+Q', 'Cmd+R', 'Tab', 'Enter', 'Backspace', 'Delete', 'Space',
];

// How long the second key of a two key shortcut can take
export const SEQUENCE_MS = 1200;

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// One key press as text, like "Ctrl+Z", "G" or "Esc". Letters are upper case, symbols are as typed.
// Shift only counts on a letter or a named key, so "?" is "?" and not "Shift+?".
export function comboOf(e: KeyLike): string | null {
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  const names: Record<string, string> = { Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', '+': 'Plus' };
  const name = names[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  const letter = k.length === 1 && /[a-z]/i.test(k);
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && (letter || k.length > 1)) mods.push('Shift');
  if (e.metaKey) mods.push('Cmd');
  return [...mods, name].join('+');
}

const SYMBOLS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓', Plus: '+' };

export function showKey(combo: string): string {
  return combo.split('+').map(p => SYMBOLS[p] ?? p).join('+');
}

// The keycaps of a binding, "then" between the two keys of a sequence
export function capsOf(keys: string[]): { text: string; then: boolean }[] {
  const out: { text: string; then: boolean }[] = [];
  keys.forEach((k, i) => {
    if (i) out.push({ text: 'then', then: true });
    k.split('+').forEach(p => out.push({ text: SYMBOLS[p] ?? p, then: false }));
  });
  return out;
}

// Same scope, or either one works everywhere
const overlap = (a: Command, b: Command) => a.scope === 'global' || b.scope === 'global' || a.scope === b.scope;

// The commands that would fight over these keys: the same keys, or one is the first half of the other's two key sequence
export function conflictsOf(commands: Command[], bound: Record<string, string[]>, target: Command, keys: string[]): Command[] {
  if (!keys.length) return [];
  return commands.filter(c => {
    if (c.id === target.id || !overlap(c, target)) return false;
    const other = bound[c.id];
    if (!other?.length) return false;
    const same = other.join(' ') === keys.join(' ');
    const prefix = (other.length === 1 && keys.length === 2 && keys[0] === other[0]) || (keys.length === 1 && other.length === 2 && other[0] === keys[0]);
    return same || prefix;
  });
}

const STORE = 'stock-listing-shortcuts';

@Service()
export class Shortcuts {
  private toast = inject(Toast);

  // Only what differs from the defaults. An empty list means "no key", the function can't be run from the keyboard.
  private changed = signal<Record<string, string[]>>(load());
  panelOpen = signal(false);
  private labels = signal<Record<string, string>>({});
  // Functions the open page has nothing for right now (a fourth split when there are three). They keep their key but aren't listed.
  private unused = signal<ReadonlySet<string>>(new Set());

  // Pages that said what they can run. With none open, no key does anything.
  private pages = new Map<Scope, Record<string, (e: KeyboardEvent) => void>>();
  private pending: { combo: string; at: number } | null = null;

  commands = computed(() => COMMANDS.map(c => ({ ...c, name: this.labels()[c.id] ?? c.name })));
  // What the Shortcuts panel lists
  listed = computed(() => this.commands().filter(c => !this.unused().has(c.id)));
  // What every command is bound to now
  bound = computed(() => {
    const out: Record<string, string[]> = {};
    for (const c of COMMANDS) out[c.id] = Object.hasOwn(this.changed(), c.id) ? this.changed()[c.id] : c.def;
    return out;
  });

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('keydown', e => this.onKey(e));
  }

  // A page calls this when it opens and the function it returns when it closes
  register(scope: Scope, run: Record<string, (e: KeyboardEvent) => void>, labels: Record<string, string> = {}): () => void {
    this.pages.set(scope, run);
    this.labels.update(l => ({ ...l, ...labels }));
    return () => {
      if (this.pages.get(scope) === run) this.pages.delete(scope);
      if (this.pages.size === 0) this.panelOpen.set(false);
    };
  }

  setLabels(labels: Record<string, string>) {
    this.labels.update(l => ({ ...l, ...labels }));
  }

  setUnused(ids: string[]) {
    this.unused.set(new Set(ids));
  }

  hasPage = () => this.pages.size > 0;

  togglePanel(open = !this.panelOpen()) {
    this.panelOpen.set(open);
  }

  // The key refused by the browser, or the commands already using these keys. Nothing is changed.
  check(id: string, keys: string[]): { error: string; conflicts: Command[] } {
    const target = COMMANDS.find(c => c.id === id);
    const bad = keys.find(k => RESERVED.includes(k));
    if (bad) return { error: `The browser keeps ${showKey(bad)} for itself, so a web page cannot use it. Press a different key.`, conflicts: [] };
    return { error: '', conflicts: target ? conflictsOf(this.commands(), this.bound(), target, keys) : [] };
  }

  // Applies at once, no Enter and no Save. Taking a key over leaves the other function with no key at all, so a key never has two owners.
  assign(id: string, keys: string[], takeOver = false) {
    const target = this.commands().find(c => c.id === id);
    if (!target) return;
    const lost = takeOver ? this.check(id, keys).conflicts : [];
    const next = { ...this.changed() };
    for (const c of lost) next[c.id] = [];
    if (target.def.join(' ') === keys.join(' ')) delete next[id];
    else next[id] = keys;
    this.save(next);
    const now = keys.map(showKey).join(' then ');
    this.toast.say(`${target.name} now uses ${now}.` + lost.map(c => ` ${c.name} has no key now.`).join(''));
  }

  resetAll() {
    this.save({});
    this.toast.say('Every shortcut is back to its default.');
  }

  private save(next: Record<string, string[]>) {
    this.changed.set(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // Blocked storage, the changes last until the page is closed
    }
  }

  // The one listener. Single plain keys never fire while someone is typing, combinations with Ctrl, Alt or Cmd do.
  onKey(e: KeyboardEvent, now = Date.now()) {
    if (this.pages.size === 0 || this.panelOpen()) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing && !(e.ctrlKey || e.altKey || e.metaKey)) return;
    const combo = comboOf(e);
    if (!combo) return;
    const live = this.commands().filter(c => c.scope === 'global' || this.pages.has(c.scope));
    const keys = this.bound();
    const pending = this.pending;
    this.pending = null;
    if (pending && now - pending.at < SEQUENCE_MS) {
      const hit = live.find(c => keys[c.id].length === 2 && keys[c.id][0] === pending.combo && keys[c.id][1] === combo);
      if (hit) { e.preventDefault(); this.run(hit, e); return; }
    }
    const single = live.find(c => keys[c.id].length === 1 && keys[c.id][0] === combo);
    if (single) { e.preventDefault(); this.run(single, e); return; }
    if (live.some(c => keys[c.id].length === 2 && keys[c.id][0] === combo)) {
      e.preventDefault();
      this.pending = { combo, at: now };
      this.toast.say(showKey(combo) + ' then...');
    }
  }

  private run(c: Command, e: KeyboardEvent) {
    if (c.id === 'keys.open') this.togglePanel();
    else this.pages.get(c.scope)?.[c.id]?.(e);
  }
}

function load(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const known = new Set(COMMANDS.map(c => c.id));
    const out: Record<string, string[]> = {};
    for (const [id, keys] of Object.entries(raw)) {
      if (known.has(id) && Array.isArray(keys) && keys.length <= 2 && keys.every(k => typeof k === 'string')) out[id] = keys as string[];
    }
    return out;
  } catch {
    return {};
  }
}
