import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Snapshot } from '../models/board';
import { ScratchApi } from './scratch-api';
import { Change } from './board-engine';

// The carry tray along the bottom of every admin page: snapshots from the Overview on their way to a board.
// It is the person's own, kept on the server apart from any board, so a carry is saved the moment it answers
// and never waits on, or disturbs, a board being edited.
@Service()
export class TrayStore {
  private api = inject(ScratchApi);

  readonly items = signal<Snapshot[]>([]);
  readonly loaded = signal(false);
  // The page that can take a snapshot off the tray (the Scratchpad, while it is open) and the page that can make
  // one from a card dropped on the tray (the Overview). Each sets itself while it is open.
  readonly placer = signal<((snap: Snapshot) => void) | null>(null);
  readonly carrier = signal<((kind: Snapshot['kind']) => void) | null>(null);

  async load(): Promise<void> {
    try {
      this.items.set((await firstValueFrom(this.api.tray())).items);
      this.loaded.set(true);
    } catch {
      // The tray stays as it was; the next carry or page brings it level
    }
  }

  // Answers true once the server has it
  async carry(snap: Snapshot): Promise<boolean> {
    try {
      this.items.set((await firstValueFrom(this.api.carry(snap))).items);
      return true;
    } catch {
      return false;
    }
  }

  async drop(snapId: string): Promise<boolean> {
    const before = this.items();
    this.items.update(all => all.filter(one => one.id !== snapId));
    try {
      this.items.set((await firstValueFrom(this.api.dropFromTray(snapId))).items);
      return true;
    } catch {
      this.items.set(before);
      return false;
    }
  }

  // Undo of "put it on the board" gives the snapshot back to the tray, and redo takes it again
  follow(change: Change | null): void {
    if (!change) return;
    const snaps = (doc: Change['before']) => new Map(doc.items.flatMap(item => (item.type === 'snap' ? [[item.snap.id, item.snap] as const] : [])));
    const before = snaps(change.before);
    const after = snaps(change.after);
    for (const [id, snap] of before) if (!after.has(id)) void this.carry(snap);
    for (const id of after.keys()) if (!before.has(id)) void this.drop(id);
  }
}
