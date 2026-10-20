import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from './auth';
import { Toast } from './toast';
import { MouseMod, SettingsStore } from './settings-store';

// Customisable keyboard shortcuts, in the style of VS Code. Every key is a command that can be rebound from the Shortcuts panel.
// Commands are plain data. A page says which of them it can run (register), the service listens on the document, one listener for every page.
// The keys a person changed are saved per person on the server, see services/settings-store.ts.

// global works on every admin page, the others only on their own page
export type Scope = 'global' | 'overview' | 'scratchpad';

// The admin pages in menu order, for Go to and Previous / Next page. The Scratchpad joins this list when it is built.
export const ADMIN_PAGES = [
  { id: 'nav.overview', url: '/overview', name: 'Overview' },
  { id: 'nav.scratchpad', url: '/scratchpad', name: 'Scratchpad' },
];

export interface Command {
  id: string;
  // Works on any page for an admin, not only while an admin page is open
  anywhere?: boolean;
  name: string;
  desc: string;
  scope: Scope;
  // The default key, one key press like 'C' or 'Ctrl+Z', or two in a row (['G', 'O'] is G then O)
  def: string[];
  // A Ctrl key the text box keeps while someone is typing in it: inside a note Ctrl+A selects its words, not the board
  notInText?: boolean;
  // A second key that also runs it, the way people expect from other programs (Ctrl+Shift+Z redoes as well as
  // Ctrl+Y). Not listed in the panel and never in the way: a key someone binds to another function wins.
  alias?: string[];
}

export const COMMANDS: Command[] = [
  { id: 'nav.overview', name: 'Go to Overview', desc: 'Jump to the Overview page.', scope: 'global', def: ['G', 'O'], anywhere: true },
  { id: 'nav.scratchpad', name: 'Go to Scratchpad', desc: 'Jump to the Scratchpad page.', scope: 'global', def: ['G', 'S'], anywhere: true },
  { id: 'nav.prev', name: 'Previous page', desc: 'Move to the page before this one in the menu.', scope: 'global', def: ['['] },
  { id: 'nav.next', name: 'Next page', desc: 'Move to the page after this one in the menu.', scope: 'global', def: [']'] },
  { id: 'keys.open', name: 'Show shortcuts', desc: 'Open this list. Esc closes it.', scope: 'global', def: ['?'] },
  ...[1, 2, 3, 4, 5].map(n => ({ id: 'ov.slice' + n, name: 'Split the circle', desc: 'Change what the circle is split by.', scope: 'overview' as Scope, def: [String(n)] })),
  { id: 'ov.find', name: 'Find an industry', desc: 'Jump to the search box to look up one industry.', scope: 'overview', def: ['/'] },
  { id: 'ov.compare', name: 'Compare', desc: 'Turn Compare on or off to set two slices side by side.', scope: 'overview', def: ['C'] },
  { id: 'ov.metric', name: 'Count or Average price', desc: 'Switch the bars between how many industries and their average price.', scope: 'overview', def: ['M'] },
  { id: 'ov.top', name: 'Switch the top list', desc: 'Cycle through Top 3, Top 10 and Cheapest 3.', scope: 'overview', def: ['T'] },
  { id: 'ov.clear', name: 'Clear filters', desc: 'Remove every filter at once.', scope: 'overview', def: ['Esc'] },
  // The Scratchpad. Space (pan), Delete (remove) and the arrow keys (nudge) are handled on the page itself, see
  // Components/scratchpad. The ids are also listed in api_v2/Endpoints/MeEndpoints.cs, which checks saved keys.
  { id: 'sp.select', name: 'Select tool', desc: 'On the Scratchpad, pick up and move things.', scope: 'scratchpad', def: ['V'] },
  { id: 'sp.hand', name: 'Hand tool', desc: 'On the Scratchpad, drag the view around.', scope: 'scratchpad', def: ['H'] },
  { id: 'sp.line', name: 'Line tool', desc: 'On the Scratchpad, join two things with a line.', scope: 'scratchpad', def: ['L'] },
  { id: 'sp.pen', name: 'Pen', desc: 'On the Scratchpad, draw a thin line by hand.', scope: 'scratchpad', def: ['P'] },
  { id: 'sp.marker', name: 'Marker', desc: 'On the Scratchpad, draw a wide see-through stroke to mark something out.', scope: 'scratchpad', def: ['M'] },
  { id: 'sp.rect', name: 'Box', desc: 'On the Scratchpad, drag to draw a box around an area.', scope: 'scratchpad', def: ['R'] },
  { id: 'sp.sticky', name: 'New sticky note', desc: 'On the Scratchpad, add a sticky note.', scope: 'scratchpad', def: ['N'] },
  { id: 'sp.text', name: 'New text box', desc: 'On the Scratchpad, add a text box.', scope: 'scratchpad', def: ['T'] },
  { id: 'sp.undo', name: 'Undo', desc: 'On the Scratchpad, take back the last change.', scope: 'scratchpad', def: ['Ctrl+Z'], alias: ['Cmd+Z'] },
  { id: 'sp.redo', name: 'Redo', desc: 'On the Scratchpad, bring back what was taken back.', scope: 'scratchpad', def: ['Ctrl+Y'], alias: ['Ctrl+Shift+Z', 'Shift+Cmd+Z', 'Cmd+Y'] },
  { id: 'sp.group', name: 'Group', desc: 'On the Scratchpad, group the things picked under a name.', scope: 'scratchpad', def: ['Ctrl+G'], notInText: true },
  { id: 'sp.ungroup', name: 'Ungroup', desc: 'On the Scratchpad, let the picked group go. Its things stay where they are.', scope: 'scratchpad', def: ['Ctrl+Shift+G'], notInText: true },
  { id: 'sp.duplicate', name: 'Duplicate', desc: 'On the Scratchpad, put copies of the picked things beside them.', scope: 'scratchpad', def: ['Ctrl+D'], notInText: true },
  { id: 'sp.selectAll', name: 'Select everything', desc: 'On the Scratchpad, pick everything on the board. Other pages leave Ctrl+A to the browser; inside a note it still selects the words.', scope: 'scratchpad', def: ['Ctrl+A'], notInText: true },
  { id: 'sp.back', name: 'Send to back', desc: 'On the Scratchpad, put the picked things behind everything else.', scope: 'scratchpad', def: ['Ctrl+['], notInText: true },
  { id: 'sp.front', name: 'Bring to front', desc: 'On the Scratchpad, put the picked things in front of everything else.', scope: 'scratchpad', def: ['Ctrl+]'], notInText: true },
  { id: 'sp.zoom100', name: 'Zoom to 100%', desc: 'On the Scratchpad, reset the zoom.', scope: 'scratchpad', def: ['Ctrl+0'] },
  { id: 'sp.fit', name: 'Fit everything on screen', desc: 'On the Scratchpad, show the whole board.', scope: 'scratchpad', def: ['Ctrl+1'] },
  { id: 'sp.zoomSel', name: 'Zoom to the selection', desc: 'On the Scratchpad, fill the screen with what is selected.', scope: 'scratchpad', def: ['Ctrl+2'] },
  { id: 'sp.clear', name: 'Clear the selection', desc: 'On the Scratchpad, let go of what is selected.', scope: 'scratchpad', def: ['Esc'] },
];

// Keys the browser or the system keeps for itself, a page can never use these reliably
export const RESERVED = [
  'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Tab', 'Ctrl+PageUp', 'Ctrl+PageDown', 'Ctrl+R', 'F5', 'F11', 'F12', 'Ctrl+L', 'Ctrl+Q',
  'Alt+Left', 'Alt+Right', 'Alt+F4', 'Ctrl+F', 'Ctrl+P', 'Ctrl+S', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Left', 'Ctrl+Right',
  'Cmd+T', 'Cmd+W', 'Cmd+N', 'Cmd+Q', 'Cmd+R', 'Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Delete', 'Space',
];

// Keys the browser keeps on other pages that the Scratchpad takes for itself, while the board has the keyboard.
// Ctrl+A there picks everything on the board; inside a note it still selects the note's words.
export const SCOPE_ALLOWED: Partial<Record<Scope, string[]>> = { scratchpad: ['Ctrl+A'] };

// How long the second key of a two key shortcut can take
export const SEQUENCE_MS = 1200;

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED_KEYS = new Set(['Esc', 'Left', 'Right', 'Up', 'Down', 'Space', 'Plus', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => 'F' + (i + 1))]);

// One key press as text, like "Ctrl+Z", "G" or "Esc". Letters are upper case, symbols are as typed.
// Shift only counts on a letter or a named key, so "?" is "?" and not "Shift+?".
export function comboOf(e: KeyLike): string | null {
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  const names: Record<string, string> = { Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', '+': 'Plus' };
  const name = names[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  // Only keys every keyboard has, the same list the API keeps (Combo in api_v2/Endpoints/MeEndpoints.cs)
  if (name.length > 1 && !NAMED_KEYS.has(name)) return null;
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

// The Mouse group of the panel, on the Scratchpad. A mouse gesture can't be recorded, so only the held key can change,
// and only on the rows that have one to change. See OVERVIEW_HANDOFF.md item g.
export type { MouseMod } from './settings-store';
export const MOUSE_MODS: MouseMod[] = ['Shift', 'Ctrl', 'Alt'];
export interface MouseRow { id: string; name: string; desc: string; gesture: string; def?: MouseMod; fixed?: string; }
export const MOUSE_ROWS: MouseRow[] = [
  { id: 'mouse.box', name: 'Select several', desc: 'On the Scratchpad, drag a box on empty space. Everything it touches is picked.', gesture: 'Drag on empty space', fixed: 'Drag on empty space' },
  { id: 'mouse.add', name: 'Add to selection', desc: 'On the Scratchpad, add one thing to what is picked, or take it out.', gesture: 'click', def: 'Shift' },
  { id: 'mouse.zoom', name: 'Zoom', desc: 'On the Scratchpad, zoom in and out toward the pointer. Only the board zooms, never the page.', gesture: 'scroll', def: 'Ctrl' },
  { id: 'mouse.dup', name: 'Duplicate while dragging', desc: 'On the Scratchpad, drag a copy away and leave the original where it was.', gesture: 'drag', def: 'Alt' },
  { id: 'mouse.pan', name: 'Move around', desc: 'On the Scratchpad, move the board. Scrolling moves it too.', gesture: 'drag', fixed: 'Space + drag' },
];

// Is the key this row uses held during this mouse event. Ctrl also takes Cmd on a Mac.
export function modHeld(mod: MouseMod, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return mod === 'Shift' ? e.shiftKey : mod === 'Ctrl' ? e.ctrlKey || e.metaKey : e.altKey;
}

@Service()
export class Shortcuts {
  private toast = inject(Toast);
  private router = inject(Router);
  private auth = inject(Auth);
  private settings = inject(SettingsStore);

  // Only what differs from the defaults. An empty list means "no key", the function can't be run from the keyboard.
  // Whatever was saved is read through known(), so a key saved for a function that is gone is ignored.
  private changed = computed(() => known(this.settings.shortcuts()));
  panelOpen = signal(false);
  private labels = signal<Record<string, string>>({});
  // Functions the open page has nothing for right now (a fourth split when there are three). They keep their key but aren't listed.
  private unused = signal<ReadonlySet<string>>(new Set());

  // The held key of each Mouse row the person changed, and the rows the panel shows while the Scratchpad is open
  private mouseChanged = computed(() => knownMouse(this.settings.mouse()));
  mouseRows = computed(() => MOUSE_ROWS.map(row => ({ ...row, mod: row.def ? this.mouseChanged()[row.id] ?? row.def : undefined })));
  mouseMod(id: string): MouseMod {
    return this.mouseChanged()[id] ?? MOUSE_ROWS.find(row => row.id === id)?.def ?? 'Shift';
  }
  scratchpadOpen = signal(false);

  // Two rows can't share a held key, or one gesture would do two things: the other row gets the key this one gave up
  setMouseMod(id: string, mod: MouseMod) {
    const row = MOUSE_ROWS.find(one => one.id === id);
    if (!row?.def) return;
    const was = this.mouseMod(id);
    if (was === mod) return;
    const next = { ...this.mouseChanged(), [id]: mod };
    const other = MOUSE_ROWS.find(one => one.id !== id && one.def && this.mouseMod(one.id) === mod);
    if (other) next[other.id] = was;
    for (const one of MOUSE_ROWS) if (one.def && next[one.id] === one.def) delete next[one.id];
    this.saveMouse(next);
    this.toast.say(`${row.name} now uses ${mod} + ${row.gesture}.` + (other ? ` ${other.name} now uses ${was} + ${other.gesture}.` : ''));
  }

  private saveMouse(next: Record<string, MouseMod>) {
    this.settings.set('mouse', next);
  }

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
    if (scope === 'scratchpad') this.scratchpadOpen.set(true);
    return () => {
      if (this.pages.get(scope) === run) this.pages.delete(scope);
      if (!this.pages.has('scratchpad')) this.scratchpadOpen.set(false);
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
    const allowed = (target && SCOPE_ALLOWED[target.scope]) ?? [];
    const bad = keys.find(k => RESERVED.includes(k) && !allowed.includes(k));
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
    this.saveMouse({});
    this.toast.say('Every shortcut is back to its default.');
  }

  private save(next: Record<string, string[]>) {
    this.settings.set('shortcuts', next);
  }

  // The one listener. Single plain keys never fire while someone is typing, combinations with Ctrl, Alt or Cmd do.
  onKey(e: KeyboardEvent, now = Date.now()) {
    // Keys only work on an admin page, apart from the ones that take an admin to one
    const admin = this.auth.isAdmin();
    if ((this.pages.size === 0 && !admin) || this.panelOpen()) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      || !!t.closest?.('[contenteditable="true"]'));
    if (typing && !(e.ctrlKey || e.altKey || e.metaKey)) return;
    const combo = comboOf(e);
    if (!combo) return;
    const open = this.pages.size > 0;
    // While typing, the board's edit keys leave the text box its own Ctrl keys, so Ctrl+A still selects the words
    const live = this.commands().filter(c => ((c.anywhere && admin) || (open && (c.scope === 'global' || this.pages.has(c.scope)))) && !(typing && c.notInText));
    const keys = this.bound();
    const pending = this.pending;
    this.pending = null;
    if (pending && now - pending.at < SEQUENCE_MS) {
      const hit = live.find(c => keys[c.id].length === 2 && keys[c.id][0] === pending.combo && keys[c.id][1] === combo);
      if (hit) { e.preventDefault(); this.run(hit, e); return; }
    }
    const single = live.find(c => keys[c.id].length === 1 && keys[c.id][0] === combo)
      ?? live.find(c => c.alias?.includes(combo) && !Object.values(keys).some(k => k.length === 1 && k[0] === combo));
    if (single) { e.preventDefault(); this.run(single, e); return; }
    if (live.some(c => keys[c.id].length === 2 && keys[c.id][0] === combo)) {
      e.preventDefault();
      this.pending = { combo, at: now };
      this.toast.say(showKey(combo) + ' then...');
    }
  }

  private run(c: Command, e: KeyboardEvent) {
    if (c.id === 'keys.open') this.togglePanel();
    else if (c.id.startsWith('nav.')) this.go(c.id);
    else this.pages.get(c.scope)?.[c.id]?.(e);
  }

  // Go to a named admin page, and Previous / Next page through ADMIN_PAGES (they wrap around)
  private go(id: string) {
    const here = ADMIN_PAGES.findIndex(p => this.router.url.split(/[?#]/)[0] === p.url);
    const named = ADMIN_PAGES.find(p => p.id === id);
    if (named) {
      if (here >= 0 && ADMIN_PAGES[here].url === named.url) this.toast.say('You are already on the ' + named.name + '.');
      else this.router.navigateByUrl(named.url);
      return;
    }
    if (ADMIN_PAGES.length < 2) { this.toast.say('The Overview is the only admin page so far.'); return; }
    const step = id === 'nav.next' ? 1 : -1;
    const next = ADMIN_PAGES[(Math.max(here, 0) + step + ADMIN_PAGES.length) % ADMIN_PAGES.length];
    this.router.navigateByUrl(next.url);
  }
}

function knownMouse(raw: Record<string, unknown>): Record<string, MouseMod> {
  const out: Record<string, MouseMod> = {};
  for (const row of MOUSE_ROWS) {
    const mod = raw?.[row.id] as MouseMod;
    if (row.def && MOUSE_MODS.includes(mod)) out[row.id] = mod;
  }
  return out;
}

function known(raw: Record<string, unknown>): Record<string, string[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const ids = new Set(COMMANDS.map(c => c.id));
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(raw)) {
    if (ids.has(id) && Array.isArray(keys) && keys.length <= 2 && keys.every(k => typeof k === 'string')) out[id] = keys as string[];
  }
  return out;
}
