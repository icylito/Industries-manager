import { Service, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IndustryApi } from './industry-api';
import { BoardDocument, BoardGroup, BoardItem, BoardLine, BoardView, TextBlock } from '../models/industry';

// The board's own types live with the other API models, see models/industry.ts
export type { BoardDocument, BoardGroup, BoardItem, BoardItemType, BoardLine, BoardList, BoardView, NoteTone, TextBlock, TextRun, TextSize } from '../models/industry';

// The pill next to Shortcuts. Three states, one rule: nothing is called Saved until the server says so.
export type SaveState = 'save' | 'saved' | 'failed';
export type BoardTool = 'select' | 'hand' | 'line';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const ITEM_SIZE = {
  industry: { w: 236, h: 92 },
  note: { w: 250, h: 150 },
  text: { w: 270, h: 110 },
} as const;

const HISTORY_CAP = 100;
const SAVE_DEBOUNCE_MS = 700;
const PERIODIC_SAVE_MS = 120_000;
const RETRY_MAX_MS = 30_000;

export function emptyBoard(): BoardDocument {
  return { version: 1, view: { x: 0, y: 0, zoom: 1 }, items: [], lines: [], groups: [] };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function normalizeView(view: BoardView | undefined): BoardView {
  const x = view && Number.isFinite(view.x) ? view.x : 0;
  const y = view && Number.isFinite(view.y) ? view.y : 0;
  const zoom = view && Number.isFinite(view.zoom) ? clampZoom(view.zoom) : 1;
  return { x, y, zoom };
}

// A board saved before rich text has plain text on its notes, so give it one block of one run.
function openBoard(raw: BoardDocument): BoardDocument {
  const items = (raw.items ?? []).map(item => {
    if ((item.type === 'note' || item.type === 'text') && !item.blocks) {
      return { ...item, blocks: [{ id: newId(), list: 'none' as const, runs: [{ text: item.text ?? '' }] }] };
    }
    return item;
  });
  return {
    version: 1,
    view: normalizeView(raw.view),
    items,
    lines: raw.lines ?? [],
    groups: (raw.groups ?? []).filter(group => group.itemIds.length >= 2),
  };
}

const copy = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
let seed = 0;
const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  seed += 1;
  return 'i' + Date.now().toString(36) + seed.toString(36);
};

@Service()
export class Scratchpad {
  private api = inject(IndustryApi);

  board = signal<BoardDocument>(emptyBoard());
  selectedIds = signal<string[]>([]);
  selectedGroupId = signal<string | null>(null);
  selectedLineId = signal<string | null>(null);
  tool = signal<BoardTool>('select');
  saveState = signal<SaveState>('saved');
  // The server refused a stale save (409). The pill says the board changed somewhere else.
  conflict = signal(false);
  loading = signal(true);
  loadError = signal(false);
  canUndo = signal(false);
  canRedo = signal(false);
  // Bumped when the board changes from outside an editor (open, undo, redo), so the editor redraws then only
  external = signal(0);

  // Everything picked right now, and the single one when only one is picked
  selection = computed(() => {
    const ids = this.selectedIds();
    return this.board().items.filter(item => ids.includes(item.id));
  });
  selectedOne = computed(() => (this.selection().length === 1 ? this.selection()[0] : null));
  itemCount = computed(() => this.board().items.length);
  groups = computed(() => this.board().groups);
  lines = computed(() => this.board().lines);

  private updatedAt: string | null = null;
  private past: BoardDocument[] = [];
  private future: BoardDocument[] = [];
  private before: BoardDocument | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  // Changes the server has not confirmed, and a version so a save only counts when it covers them all
  private unsaved = false;
  private changeVersion = 0;
  private inFlight = false;
  private saveAgain = false;

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const answer = await firstValueFrom(this.api.board());
      const document = answer.document;
      if (!document || document.version !== 1 || !Array.isArray(document.items)) throw new Error('unreadable');
      this.board.set(openBoard(document));
      this.updatedAt = answer.updatedAt;
      // A board that just loaded matches the server, so nothing is outstanding
      this.unsaved = false;
      this.conflict.set(false);
      this.failures = 0;
      this.saveState.set('saved');
      this.past = [];
      this.future = [];
      this.clearSelection();
      this.readHistory();
      this.external.update(count => count + 1);
      this.loading.set(false);
    } catch {
      this.loading.set(false);
      this.loadError.set(true);
    }
  }

  // A change goes into history once, not on every event: a drag on pointer up, typing when the note
  // loses focus or Ctrl+Z is pressed. Undo is essential, see OVERVIEW_HANDOFF.md.
  begin(): void {
    if (!this.before) this.before = copy(this.board());
  }

  live(fn: (document: BoardDocument) => void): void {
    const next = copy(this.board());
    fn(next);
    this.board.set(next);
  }

  end(): void {
    const before = this.before;
    this.before = null;
    if (!before || same(before, this.board())) return;
    this.past.push(before);
    if (this.past.length > HISTORY_CAP) this.past.shift();
    this.future = [];
    this.readHistory();
    this.saveSoon();
  }

  commit(fn: (document: BoardDocument) => void): void {
    this.begin();
    this.live(fn);
    this.end();
  }

  undo(): void {
    this.end();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(copy(this.board()));
    this.board.set(previous);
    this.clearSelection();
    this.readHistory();
    this.external.update(count => count + 1);
    this.saveSoon();
  }

  redo(): void {
    this.end();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(copy(this.board()));
    this.board.set(next);
    this.clearSelection();
    this.readHistory();
    this.external.update(count => count + 1);
    this.saveSoon();
  }

  private readHistory(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }

  // ---- what is picked ----

  pick(id: string): void {
    this.selectedLineId.set(null);
    this.selectedGroupId.set(null);
    this.selectedIds.set([id]);
  }

  togglePick(id: string): void {
    this.selectedLineId.set(null);
    this.selectedGroupId.set(null);
    this.selectedIds.update(ids => ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]);
  }

  setSelection(ids: string[]): void {
    this.selectedLineId.set(null);
    this.selectedGroupId.set(null);
    this.selectedIds.set([...new Set(ids)]);
  }

  clearSelection(): void {
    this.selectedIds.set([]);
    this.selectedGroupId.set(null);
    this.selectedLineId.set(null);
  }

  isPicked(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  pickGroup(id: string): void {
    this.selectedIds.set([]);
    this.selectedLineId.set(null);
    this.selectedGroupId.set(id);
  }

  pickLine(id: string): void {
    this.selectedIds.set([]);
    this.selectedGroupId.set(null);
    this.selectedLineId.set(id);
  }

  groupFor(itemId: string): BoardGroup | null {
    return this.board().groups.find(group => group.itemIds.includes(itemId)) ?? null;
  }

  membersOf(groupId: string): BoardItem[] {
    const group = this.board().groups.find(one => one.id === groupId);
    if (!group) return [];
    const items = this.board().items;
    return group.itemIds.map(id => items.find(item => item.id === id)).filter((item): item is BoardItem => !!item);
  }

  // ---- things on the board ----

  addIndustry(row: { id: number; name: string; sector: string | null; price: number | null; rank?: number | null }, at?: { x: number; y: number }): void {
    const size = ITEM_SIZE.industry;
    const spot = at ?? this.freeSpot(size.w, size.h);
    const item: BoardItem = {
      id: newId(), type: 'industry', x: spot.x, y: spot.y, w: size.w, h: size.h,
      industryId: row.id, name: row.name, sector: row.sector, price: row.price, rank: row.rank ?? null,
    };
    this.commit(document => { document.items.push(item); });
    this.pick(item.id);
  }

  addPaper(type: 'note' | 'text', at?: { x: number; y: number }): void {
    const size = ITEM_SIZE[type];
    const spot = at ?? this.freeSpot(size.w, size.h);
    const item: BoardItem = {
      id: newId(), type, x: spot.x, y: spot.y, w: size.w, h: size.h,
      text: '', tone: 'white', tilt: type === 'note' ? Math.round((Math.random() * 6 - 3) * 10) / 10 : 0,
      blocks: [{ id: newId(), list: 'none', runs: [{ text: '' }] }],
    };
    this.commit(document => { document.items.push(item); });
    this.pick(item.id);
  }

  // Dragging happens many times a second, so only the moving things change, not the whole board
  moveManyLive(positions: { id: string; x: number; y: number }[]): void {
    const byId = new Map(positions.map(one => [one.id, one]));
    this.board.update(document => ({
      ...document,
      items: document.items.map(item => {
        const spot = byId.get(item.id);
        return spot ? { ...item, x: spot.x, y: spot.y } : item;
      }),
    }));
  }

  textLive(id: string, text: string): void {
    this.board.update(document => ({
      ...document,
      items: document.items.map(item => (item.id === id ? { ...item, text } : item)),
    }));
  }

  // Typing lands here on every keystroke, so a burst saves on its own instead of waiting for a blur
  blocksLive(id: string, blocks: TextBlock[]): void {
    this.board.update(document => ({
      ...document,
      items: document.items.map(item => (item.id === id ? { ...item, blocks } : item)),
    }));
    this.saveSoon();
  }

  setTone(ids: string[], tone: 'white' | 'amber'): void {
    this.commit(document => {
      for (const item of document.items) if (ids.includes(item.id)) item.tone = tone;
    });
  }

  // ---- groups ----

  addGroup(name = ''): string | null {
    const ids = this.selectedIds();
    if (ids.length < 2) return null;
    const id = newId();
    this.commit(document => {
      // A thing is in at most one group, so taking it into a new one takes it out of the old one
      document.groups = document.groups
        .map(group => ({ ...group, itemIds: group.itemIds.filter(one => !ids.includes(one)) }))
        .filter(group => group.itemIds.length >= 2);
      document.groups.push({ id, name, itemIds: [...ids] });
    });
    this.pickGroup(id);
    return id;
  }

  renameGroup(id: string, name: string): void {
    this.commit(document => {
      const group = document.groups.find(one => one.id === id);
      if (group) group.name = name;
    });
  }

  renameGroupLive(id: string, name: string): void {
    this.live(document => {
      const group = document.groups.find(one => one.id === id);
      if (group) group.name = name;
    });
  }

  // Ungroup gives the cards back exactly where they are
  ungroup(id: string): void {
    const members = this.membersOf(id).map(item => item.id);
    this.commit(document => { document.groups = document.groups.filter(group => group.id !== id); });
    this.setSelection(members);
  }

  // Delete group removes the group and everything in it
  deleteGroup(id: string): void {
    const members = this.membersOf(id).map(item => item.id);
    this.commit(document => { this.dropItems(document, members); });
    this.clearSelection();
  }

  // ---- lines ----

  addLine(from: string, to: string): void {
    if (from === to) return;
    if (this.board().lines.some(line => line.from === from && line.to === to)) return;
    const line: BoardLine = { id: newId(), from, to, head: 'none', bend: 0, label: '' };
    this.commit(document => { document.lines.push(line); });
    this.pickLine(line.id);
  }

  removeLine(id: string): void {
    this.commit(document => { document.lines = document.lines.filter(line => line.id !== id); });
    if (this.selectedLineId() === id) this.selectedLineId.set(null);
  }

  setLineLabel(id: string, label: string): void {
    this.commit(document => {
      const line = document.lines.find(one => one.id === id);
      if (line) line.label = label;
    });
  }

  // Typing a label, so a burst is one undo step
  lineLabelLive(id: string, label: string): void {
    this.live(document => {
      const line = document.lines.find(one => one.id === id);
      if (line) line.label = label;
    });
  }

  setLineHead(id: string, head: 'none' | 'end' | 'both'): void {
    this.commit(document => {
      const line = document.lines.find(one => one.id === id);
      if (line) line.head = head;
    });
  }

  // Turning the curve on picks the side that crosses fewer cards
  setLineCurve(id: string, on: boolean): void {
    const line = this.board().lines.find(one => one.id === id);
    if (!line) return;
    const from = this.board().items.find(item => item.id === line.from);
    const to = this.board().items.find(item => item.id === line.to);
    const bend = on && from && to ? this.bendSign(from, to) : 0;
    this.commit(document => {
      const target = document.lines.find(one => one.id === id);
      if (target) target.bend = bend;
    });
  }

  flipLine(id: string): void {
    this.commit(document => {
      const target = document.lines.find(one => one.id === id);
      if (target && target.bend !== 0) target.bend = -target.bend;
    });
  }

  private bendSign(from: BoardItem, to: BoardItem): number {
    return this.crossings(from, to, 1) <= this.crossings(from, to, -1) ? 1 : -1;
  }

  // How many other cards a bow on this side would cut through, sampled along the curve
  private crossings(from: BoardItem, to: BoardItem, bend: number): number {
    const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const control = curveControl(a, b, bend);
    let count = 0;
    for (const item of this.board().items) {
      if (item.id === from.id || item.id === to.id) continue;
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const point = quadPoint(a, control, b, t);
        if (point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  // ---- removing ----

  removeItems(ids: string[]): void {
    if (ids.length === 0) return;
    this.commit(document => { this.dropItems(document, ids); });
    this.selectedIds.update(current => current.filter(id => !ids.includes(id)));
  }

  removeSelection(): void {
    const groupId = this.selectedGroupId();
    if (groupId) { this.deleteGroup(groupId); return; }
    const lineId = this.selectedLineId();
    if (lineId) { this.removeLine(lineId); return; }
    this.removeItems(this.selectedIds());
  }

  // Drops the things, every line glued to them, and any group left with fewer than two
  private dropItems(document: BoardDocument, ids: string[]): void {
    document.items = document.items.filter(item => !ids.includes(item.id));
    document.lines = document.lines.filter(line => !ids.includes(line.from) && !ids.includes(line.to));
    document.groups = document.groups
      .map(group => ({ ...group, itemIds: group.itemIds.filter(id => !ids.includes(id)) }))
      .filter(group => group.itemIds.length >= 2);
  }

  // ---- the view ----

  setView(view: BoardView): void {
    this.board.update(document => ({ ...document, view: normalizeView(view) }));
    this.saveSoon();
  }

  freeSpot(w: number, h: number): { x: number; y: number } {
    const view = this.board().view;
    const items = this.board().items;
    const pad = 24;
    const left = -view.x / view.zoom + 48;
    const top = -view.y / view.zoom + 48;
    const taken = (x: number, y: number) => items.some(item =>
      x < item.x + item.w + pad && x + w + pad > item.x &&
      y < item.y + item.h + pad && y + h + pad > item.y);
    for (let row = 0; row < 60; row++) {
      for (let col = 0; col < 24; col++) {
        const x = left + col * (w + pad);
        const y = top + row * (h + pad);
        if (!taken(x, y)) return { x, y };
      }
    }
    return { x: left, y: top };
  }

  // Cards show what the table says now, so a price is never stale
  refreshCards(rows: { id: number; name: string; sector: string | null; price: number | null }[]): void {
    const byId = new Map(rows.map(row => [row.id, row]));
    let changed = false;
    const items = this.board().items.map(item => {
      if (item.type !== 'industry' || item.industryId == null) return item;
      const row = byId.get(item.industryId);
      if (!row || (item.name === row.name && item.sector === row.sector && item.price === row.price)) return item;
      changed = true;
      return { ...item, name: row.name, sector: row.sector, price: row.price };
    });
    if (changed) {
      this.board.update(document => ({ ...document, items }));
      this.saveSoon();
    }
  }

  // ---- saving, there is no Save button. See OVERVIEW_HANDOFF.md, "the save state" ----

  saveSoon(): void {
    if (this.loading() || this.loadError() || this.conflict()) return;
    this.unsaved = true;
    this.changeVersion += 1;
    this.saveState.set('save');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.loading() || this.loadError() || this.conflict()) return;
    // One save at a time. A second one sent before the first answers would carry the same stale updatedAt
    // and this tab would 409 itself, so it waits and goes out once the first has moved updatedAt on
    if (this.inFlight) { this.saveAgain = true; return; }
    this.inFlight = true;
    this.saveAgain = false;
    const version = this.changeVersion;
    this.saveState.set('save');
    try {
      const answer = await firstValueFrom(this.api.saveBoard(this.board(), this.updatedAt));
      this.updatedAt = answer.updatedAt;
      this.failures = 0;
      if (this.conflict()) {
        // Never let a late success hide a conflict: the pill keeps saying the board changed somewhere else
        return;
      }
      if (this.changeVersion === version) {
        this.unsaved = false;
        this.saveState.set('saved');
      } else {
        // Something changed while this was in flight, so nothing is confirmed yet
        this.unsaved = true;
        this.saveState.set('save');
        this.saveSoon();
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        // Another tab saved first. Never pretend this one saved, and do not retry into the same wall
        this.unsaved = true;
        this.conflict.set(true);
        this.saveState.set('failed');
        return;
      }
      this.failures += 1;
      this.unsaved = true;
      this.saveState.set('failed');
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
      // Someone pressed Save, or a timer fired, while this one was out. Send it now with the new updatedAt
      if (this.saveAgain && this.unsaved && !this.conflict() && this.saveState() !== 'failed') void this.saveNow();
      this.saveAgain = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = Math.min(RETRY_MAX_MS, 1500 * 2 ** Math.min(this.failures - 1, 5));
    this.retryTimer = setTimeout(() => { void this.saveNow(); }, wait);
  }

  retrySave(): void {
    this.failures = 0;
    this.unsaved = true;
    void this.saveNow();
  }

  // A quiet session cannot drift unsaved: this sends only when something is waiting
  startAutoSave(): void {
    this.stopAutoSave();
    this.autoTimer = setInterval(() => {
      if (this.unsaved && !this.conflict()) void this.saveNow();
    }, PERIODIC_SAVE_MS);
  }

  stopAutoSave(): void {
    if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; }
  }
}

export interface Point { x: number; y: number; }

// A gentle bow: a fixed sideways push, capped so a short line does not loop back on itself
export function curveOffset(a: Point, b: Point): number {
  return Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
}

// The control point of the quadratic, pushed sideways off the midpoint
export function curveControl(a: Point, b: Point, bend: number): Point {
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (bend === 0) return middle;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = bend * curveOffset(a, b);
  return { x: middle.x - (dy / length) * offset, y: middle.y + (dx / length) * offset };
}

export function quadPoint(a: Point, control: Point, b: Point, t: number): Point {
  const s = 1 - t;
  return {
    x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
  };
}
