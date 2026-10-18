import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Snapshot } from '../../domain/models/board';
import { ScratchApi } from '../../infrastructure/board/scratch-api';
import { Change, StepRef } from './board-engine';

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
  // The undo steps that took a snapshot off the tray and onto a board. Only undo or redo of one of these moves a
  // snapshot between board and tray: deleting a snapshot card and redoing that delete leaves the tray alone.
  private placings: { step: StepRef; snap: Snapshot }[] = [];

  async load(): Promise<void> {
    try {
      this.items.set((await firstValueFrom(this.api.tray())).items);
      this.loaded.set(true);
    } catch {
      // The tray stays as it was; the next carry or page brings it level
    }
  }

  // Answers null when it didn't reach the server, otherwise how many of the oldest snapshots made room for it
  // (the tray keeps the newest 20, api_v2/Endpoints/ScratchpadEndpoints.cs)
  async carry(snap: Snapshot): Promise<{ dropped: number } | null> {
    const before = this.items();
    try {
      const after = (await firstValueFrom(this.api.carry(snap))).items;
      this.items.set(after);
      const kept = new Set(after.map((one) => one.id));
      return { dropped: before.filter((one) => one.id !== snap.id && !kept.has(one.id)).length };
    } catch {
      return null;
    }
  }

  async drop(snapId: string): Promise<boolean> {
    const before = this.items();
    this.items.update((all) => all.filter((one) => one.id !== snapId));
    try {
      this.items.set((await firstValueFrom(this.api.dropFromTray(snapId))).items);
      return true;
    } catch {
      this.items.set(before);
      return false;
    }
  }

  // A snapshot went from the tray onto the board as this undo step
  placed(step: StepRef | null, snap: Snapshot): void {
    if (!step) return;
    this.placings = [
      ...this.placings.filter((one) => one.step.session === step.session),
      { step, snap },
    ];
    void this.drop(snap.id);
  }

  // Undo of "put it on the board" gives the snapshot back to the tray, and redo takes it again
  follow(change: Change | null): void {
    if (!change) return;
    const placing = this.placings.find(
      (one) => one.step.session === change.step.session && one.step.n === change.step.n,
    );
    if (!placing) return;
    const onBoard = (doc: Change['before']) =>
      doc.items.some((item) => item.type === 'snap' && item.snap.id === placing.snap.id);
    if (onBoard(change.before) && !onBoard(change.after)) void this.carry(placing.snap);
    else if (!onBoard(change.before) && onBoard(change.after)) void this.drop(placing.snap.id);
  }
}
