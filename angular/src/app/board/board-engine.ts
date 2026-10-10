import { Service, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BoardDocument, BoardItem, BoardItemType, BoardView, ItemOf, ScratchFileInfo } from '../models/board';
import { ScratchApi } from './scratch-api';
import { BoardSync, Conflict, SaveState } from './board-sync';
import { Op, Position, applyOp, copiesOf, emptyDocument, openDocument } from './ops';
import { KINDS, newId } from './item-kinds';
import { Point, bestBend, bounds, freeSpot, tidyView } from './geometry';

export type { SaveState } from './board-sync';
export type { Op } from './ops';

// A change being made over time: a drag, a typing burst, a nudge. Ops applied to it show at once; commit makes
// all of them one undo step, cancel puts the board back as it was. A newer change commits this one first.
export interface Tx {
  readonly open: boolean;
  apply(op: Op): void;
  commit(): void;
  cancel(): void;
}

// Where a new thing goes: the nearest free spot on screen, or centred on a point (where something was dropped)
export type Placement = 'auto' | { center: Point };

// What an undo or redo changed, so the page can follow it outside the board (the carry tray)
export interface Change { before: BoardDocument; after: BoardDocument; }

const HISTORY_CAP = 100;
const VIEW_SAVE_MS = 1500;
const NUDGE_QUIET_MS = 500;
// How long opening a board waits for the same board's last save from before, when it was left a moment ago
const LEFT_SAVE_WAIT_MS = 10_000;

// One open board and everything that goes with it. Thrown away whole when another board opens.
interface Session {
  id: number;
  sync: BoardSync;
  past: BoardDocument[];
  future: BoardDocument[];
  tx: OpenTx | null;
  viewTimer: ReturnType<typeof setTimeout> | null;
  viewWaiting: BoardView | null;
  nudge: { tx: OpenTx; timer: ReturnType<typeof setTimeout> } | null;
}

class OpenTx implements Tx {
  open = true;
  constructor(private engine: BoardEngine, readonly base: BoardDocument) {}
  apply(op: Op): void { if (this.open) this.engine['live'](op); }
  commit(): void { this.engine['finish'](this, true); }
  cancel(): void { this.engine['finish'](this, false); }
}

// The Scratchpad's board: the one place a board changes. Every change goes through apply or a Tx, so undo,
// redo and saving work the same for all of them. Undo is essential (the user's words), so nothing on the page
// asks "are you sure". The view is kept apart: moving around is never an undo step and never saves the board.
@Service()
export class BoardEngine {
  private api = inject(ScratchApi);

  readonly doc = signal<BoardDocument>(emptyDocument());
  readonly view = signal<BoardView>({ x: 0, y: 0, zoom: 1 });
  readonly boardId = signal<number | null>(null);
  readonly boardName = signal('');
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  // Bumped when the board changes from outside a note's editor (open, undo, redo, a whole-note format), so an
  // editor redraws then and only then, and typing never makes the caret jump
  readonly external = signal(0);

  private session = signal<Session | null>(null);
  // Boards that were left (the page closed) with saves still on their way, by board id
  private leaving = new Map<number, { sync: BoardSync; doc: BoardDocument; done: Promise<void> }>();
  readonly save = computed<SaveState>(() => this.session()?.sync.state() ?? 'saved');
  readonly conflict = computed<Conflict | null>(() => this.session()?.sync.conflict() ?? null);
  readonly unsavedSteps = computed(() => this.session()?.sync.unsavedSteps() ?? 0);
  readonly saveProblem = computed(() => this.session()?.sync.problem() ?? null);

  // ---- what is picked ----
  readonly selectedIds = signal<string[]>([]);
  readonly selectedGroupId = signal<string | null>(null);
  readonly selectedLineId = signal<string | null>(null);
  readonly selection = computed(() => {
    const ids = new Set(this.selectedIds());
    return this.doc().items.filter(item => ids.has(item.id));
  });
  readonly selectedOne = computed(() => (this.selection().length === 1 ? this.selection()[0] : null));
  readonly industryIds = computed(() => new Set(this.doc().items.flatMap(item => (item.type === 'industry' ? [item.industryId] : []))));

  // ---- opening and closing ----

  async open(id: number): Promise<boolean> {
    this.dispose();
    this.status.set('loading');
    this.boardId.set(id);
    try {
      // Left a moment ago with a save on its way: wait for it, so the board opens as it was left
      const away = this.leaving.get(id);
      if (away) await Promise.race([away.done, new Promise(resolve => setTimeout(resolve, LEFT_SAVE_WAIT_MS))]);
      if (this.boardId() !== id) return false;
      const answer = await firstValueFrom(this.api.board(id));
      if (this.boardId() !== id) return false;
      if (!answer.document || answer.document.version !== 1 || !Array.isArray(answer.document.items)) throw new Error('unreadable');
      this.doc.set(openDocument(answer.document));
      this.view.set(tidyView(answer.view));
      this.boardName.set(answer.name);
      const sync = new BoardSync((document, updatedAt) => this.api.saveBoard(id, document, updatedAt), () => this.doc(), answer.updatedAt);
      this.session.set({ id, sync, past: [], future: [], tx: null, viewTimer: null, viewWaiting: null, nudge: null });
      this.clearSelection();
      this.readHistory();
      this.external.update(n => n + 1);
      this.status.set('ready');
      return true;
    } catch {
      if (this.boardId() === id) this.status.set('error');
      return false;
    }
  }

  // Before another board opens or the page closes: the open change is kept, and what is waiting is sent.
  // Answers false when the board could not be saved, so the page can say so and stay.
  async close(): Promise<boolean> {
    const session = this.session();
    if (!session) return true;
    this.commitOpen();
    this.sendView(session);
    const saved = session.sync.conflict() ? false : await session.sync.flush();
    if (saved) this.dispose();
    return saved;
  }

  // The page is closing. The board is let go at once, so coming back opens it fresh, and whatever was waiting is
  // saved in the background: it keeps trying while the API is away, and an upload that finishes later still lands.
  leave(): void {
    const session = this.session();
    if (session) {
      this.commitOpen();
      if (session.nudge) clearTimeout(session.nudge.timer);
      this.sendView(session);
      const away = { sync: session.sync, doc: this.doc(), done: Promise.resolve() };
      away.done = session.sync.drain(() => away.doc).then(() => {
        if (this.leaving.get(session.id) === away) this.leaving.delete(session.id);
      });
      this.leaving.set(session.id, away);
      this.session.set(null);
    }
    this.boardId.set(null);
    this.boardName.set('');
    this.status.set('idle');
    this.doc.set(emptyDocument());
    this.clearSelection();
    this.readHistory();
  }

  // Reload after a conflict: the board as the server has it, and the changes here are dropped
  reload(): Promise<boolean> {
    const id = this.boardId();
    return id == null ? Promise.resolve(false) : this.open(id);
  }

  // After a conflict: everything on this page becomes a new board, so nothing is lost and nothing is overwritten.
  // Undo history comes along. Answers the new board's id.
  async keepMineAsNewBoard(): Promise<number | null> {
    const session = this.session();
    if (!session) return null;
    this.commitOpen();
    const name = (this.boardName() + ' (my copy)').slice(0, 60);
    try {
      const made = await firstValueFrom(this.api.createBoard(name, this.doc()));
      session.id = made.id;
      session.sync.movedTo((document, updatedAt) => this.api.saveBoard(made.id, document, updatedAt), made.updatedAt);
      this.boardId.set(made.id);
      this.boardName.set(made.name);
      this.setView(this.view());
      return made.id;
    } catch {
      return null;
    }
  }

  rename(name: string): void {
    this.boardName.set(name);
  }

  // ---- changing the board ----

  // One change, one undo step
  apply(op: Op): void {
    const tx = this.begin();
    tx.apply(op);
    tx.commit();
  }

  begin(): Tx {
    const session = this.session();
    this.commitOpen();
    const tx = new OpenTx(this, this.doc());
    if (session) session.tx = tx;
    else tx.open = false;
    return tx;
  }

  // A change that is not the person's: an upload finishing, prices refreshed from the table. It is made to every
  // board in the undo history too, so undo can never bring back a card with no file or a stale price.
  amend(change: (doc: BoardDocument) => BoardDocument): void {
    const session = this.session();
    if (!session) return;
    const now = this.doc();
    const next = change(now);
    session.past = session.past.map(change);
    session.future = session.future.map(change);
    if (session.tx) (session.tx as { base: BoardDocument }).base = change(session.tx.base);
    if (next !== now) {
      this.doc.set(next);
      session.sync.changed(false);
    }
  }

  undo(): Change | null {
    return this.step('past', 'future');
  }

  redo(): Change | null {
    return this.step('future', 'past');
  }

  // A new thing, in free space or where it was dropped, picked so it can be used straight away
  place<T extends BoardItemType>(type: T, placement: Placement, init: Partial<ItemOf<T>>, options: { back?: boolean } = {}): string {
    const kind = KINDS[type];
    const size = { w: init.w ?? kind.size(init as never).w, h: init.h ?? kind.size(init as never).h };
    const spot = placement === 'auto'
      ? freeSpot(size, this.view(), this.doc().items)
      : { x: placement.center.x - size.w / 2, y: placement.center.y - size.h / 2 };
    const item = { ...kind.defaults(), ...init, id: newId(), type, x: spot.x, y: spot.y, w: size.w, h: size.h } as unknown as BoardItem;
    this.apply({ op: 'add', items: [item], back: options.back });
    this.pick(item.id);
    return item.id;
  }

  // Copies beside the originals, with the lines between them. Inside a Tx (Alt + drag) the copies join that
  // change; otherwise they are one step of their own. Answers which copy came from which original.
  duplicate(ids: string[], offset: Point, tx?: Tx): Map<string, string> {
    const { op, idFor } = copiesOf(this.doc(), ids, offset, newId);
    if (op.items.length === 0) return idFor;
    if (tx) tx.apply(op); else this.apply(op);
    return idFor;
  }

  // Arrow keys: a burst of presses is one undo step, closed half a second after the last
  nudge(dx: number, dy: number): void {
    const session = this.session();
    const ids = this.selectedIds().length ? this.selectedIds() : this.groupMembers(this.selectedGroupId()).map(item => item.id);
    if (!session || ids.length === 0) return;
    let burst = session.nudge;
    if (!burst || !burst.tx.open) {
      burst = { tx: this.begin() as OpenTx, timer: setTimeout(() => {}, 0) };
      session.nudge = burst;
    }
    clearTimeout(burst.timer);
    const picked = new Set(ids);
    const positions: Position[] = this.doc().items.filter(item => picked.has(item.id)).map(item => ({ id: item.id, x: item.x + dx, y: item.y + dy }));
    burst.tx.apply({ op: 'move', positions });
    const tx = burst.tx;
    burst.timer = setTimeout(() => tx.commit(), NUDGE_QUIET_MS);
  }

  // Turning a line's curve on bows it to the side that crosses fewer cards
  curveLine(id: string, on: boolean): void {
    const doc = this.doc();
    const line = doc.lines.find(one => one.id === id);
    const from = doc.items.find(item => item.id === line?.from);
    const to = doc.items.find(item => item.id === line?.to);
    if (!line || !from || !to) return;
    const others = doc.items.filter(item => item.id !== from.id && item.id !== to.id);
    this.apply({ op: 'patchLine', id, patch: { bend: on ? bestBend(from, to, others) : 0 } });
  }

  // Cards show what the table says now, so a price is never stale
  refreshCards(rows: { id: number; name: string; sector: string | null; price: number | null }[]): void {
    const byId = new Map(rows.map(row => [row.id, row]));
    this.amend(doc => applyOp(doc, {
      op: 'patch',
      ids: doc.items.filter(item => item.type === 'industry' && byId.has(item.industryId)).map(item => item.id),
      patch: item => {
        if (item.type !== 'industry') return item;
        const row = byId.get(item.industryId)!;
        return item.name === row.name && item.sector === row.sector && item.price === row.price
          ? item : { ...item, name: row.name, sector: row.sector, price: row.price };
      },
    }));
  }

  // An upload finished: the card learns its file's id, on the board it was dropped on, wherever that board is now.
  // Open: changed here. Left a moment ago and still saving: changed in what is being saved. Closed: changed on the
  // server. So a picture is never left as "Couldn't upload" because someone moved on while it was on its way.
  fileStored(itemId: string, stored: ScratchFileInfo, boardId: number | null = this.boardId()): void {
    const change = (doc: BoardDocument) => applyOp(doc, {
      op: 'patch', ids: [itemId],
      patch: { fileId: stored.id, contentType: stored.contentType, sizeBytes: stored.sizeBytes },
    });
    if (boardId == null) return;
    if (this.session()?.id === boardId) { this.amend(change); return; }
    const away = this.leaving.get(boardId);
    if (away?.sync.draining) {
      away.doc = change(away.doc);
      away.sync.changedWhileLeaving();
      return;
    }
    void this.changeSaved(boardId, change);
  }

  // A change to a board that isn't open: read it, change it, save it, once more if another save got in between
  private async changeSaved(id: number, change: (doc: BoardDocument) => BoardDocument): Promise<void> {
    for (let tries = 0; tries < 3; tries++) {
      try {
        if (this.session()?.id === id) { this.amend(change); return; }
        const answer = await firstValueFrom(this.api.board(id));
        const next = change(openDocument(answer.document));
        await firstValueFrom(this.api.saveBoard(id, next, answer.updatedAt));
        return;
      } catch (error) {
        if (!(error instanceof HttpErrorResponse && error.status === 409)) return;
      }
    }
  }

  // ---- the view: never in history, never a save of the board ----

  setView(view: BoardView): void {
    const next = tidyView(view);
    this.view.set(next);
    const session = this.session();
    if (!session) return;
    session.viewWaiting = next;
    if (session.viewTimer) clearTimeout(session.viewTimer);
    session.viewTimer = setTimeout(() => this.sendView(session), VIEW_SAVE_MS);
  }

  // ---- saving ----

  // Something the server doesn't have yet, on the open board or on one left a moment ago
  hasUnsaved(): boolean {
    return !!this.session()?.sync.unsaved || [...this.leaving.values()].some(away => away.sync.draining && away.sync.unsaved);
  }

  saveNow(): void { void this.session()?.sync.saveNow(); }
  retrySave(): void { void this.session()?.sync.retryNow(); }

  // ---- picking ----

  pick(id: string): void { this.setPicked([id]); }

  togglePick(id: string): void {
    const ids = this.selectedIds();
    this.setPicked(ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]);
  }

  setSelection(ids: string[]): void { this.setPicked([...new Set(ids)]); }

  selectAll(): void { this.setPicked(this.doc().items.map(item => item.id)); }

  clearSelection(): void { this.setPicked([]); }

  isPicked(id: string): boolean { return this.selectedIds().includes(id); }

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

  groupMembers(groupId: string | null): BoardItem[] {
    const group = this.doc().groups.find(one => one.id === groupId);
    if (!group) return [];
    const ids = new Set(group.itemIds);
    return this.doc().items.filter(item => ids.has(item.id));
  }

  // The ids an edit key acts on: what is picked, or the members of the picked group
  pickedIds(): string[] {
    const ids = this.selectedIds();
    return ids.length ? ids : this.groupMembers(this.selectedGroupId()).map(item => item.id);
  }

  // Delete: the picked line, the picked group and its cards, or the picked things
  removeSelection(): void {
    const lineId = this.selectedLineId();
    if (lineId) {
      this.apply({ op: 'removeLine', id: lineId });
      this.selectedLineId.set(null);
      return;
    }
    const ids = this.pickedIds();
    if (ids.length === 0) return;
    this.apply({ op: 'remove', ids });
    this.clearSelection();
  }

  // Group what is picked under a name. Answers the group's id, or null with fewer than two picked.
  groupSelection(name = ''): string | null {
    const ids = this.selectedIds();
    if (ids.length < 2) return null;
    const id = newId();
    this.apply({ op: 'group', id, ids, name });
    this.pickGroup(id);
    return id;
  }

  // Ungroup gives the cards back exactly where they are, picked
  ungroupSelected(): void {
    const groupId = this.selectedGroupId();
    if (!groupId) return;
    const members = this.groupMembers(groupId).map(item => item.id);
    this.apply({ op: 'ungroup', groupId });
    this.setSelection(members);
  }

  // ---- inside ----

  private live(op: Op): void {
    const next = applyOp(this.doc(), op);
    if (next === this.doc()) return;
    this.doc.set(next);
    this.session()?.sync.changed(false);
  }

  private finish(tx: OpenTx, keep: boolean): void {
    const session = this.session();
    if (!tx.open) return;
    tx.open = false;
    if (!session || session.tx !== tx) return;
    session.tx = null;
    if (session.nudge?.tx === tx) { clearTimeout(session.nudge.timer); session.nudge = null; }
    if (!keep) {
      if (this.doc() !== tx.base) {
        this.doc.set(tx.base);
        this.external.update(n => n + 1);
        session.sync.changed(false);
      }
      return;
    }
    if (this.doc() === tx.base) return;
    session.past.push(tx.base);
    if (session.past.length > HISTORY_CAP) session.past.shift();
    session.future = [];
    this.readHistory();
    session.sync.changed(true);
  }

  private commitOpen(): void {
    this.session()?.tx?.commit();
  }

  private step(from: 'past' | 'future', to: 'past' | 'future'): Change | null {
    const session = this.session();
    if (!session) return null;
    this.commitOpen();
    const target = session[from].pop();
    if (!target) return null;
    const before = this.doc();
    session[to].push(before);
    this.doc.set(target);
    // What is picked stays picked if it is still there
    const present = new Set(target.items.map(item => item.id));
    this.setPicked(this.selectedIds().filter(id => present.has(id)));
    this.readHistory();
    this.external.update(n => n + 1);
    session.sync.changed(true);
    return { before, after: target };
  }

  private setPicked(ids: string[]): void {
    this.selectedLineId.set(null);
    this.selectedGroupId.set(null);
    this.selectedIds.set(ids);
  }

  private readHistory(): void {
    const session = this.session();
    this.canUndo.set(!!session && session.past.length > 0);
    this.canRedo.set(!!session && session.future.length > 0);
  }

  private sendView(session: Session): void {
    if (session.viewTimer) { clearTimeout(session.viewTimer); session.viewTimer = null; }
    const view = session.viewWaiting;
    session.viewWaiting = null;
    // Where the person left it is a nicety: a failure is not worth a message
    if (view) this.api.changeBoard(session.id, { view }).subscribe({ error: () => {} });
  }

  private dispose(): void {
    const session = this.session();
    if (session) {
      this.commitOpen();
      if (session.nudge) clearTimeout(session.nudge.timer);
      this.sendView(session);
      session.sync.close();
    }
    this.session.set(null);
    this.readHistory();
  }

  // The box around the picked things, for Zoom to selection
  selectionBounds() {
    return bounds(this.selection());
  }
}
