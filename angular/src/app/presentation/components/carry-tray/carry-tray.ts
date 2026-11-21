import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Snapshot } from '../../../domain/models/board';
import { TrayStore } from '../../../application/board/tray-store';
import { Auth } from '../../../application/auth';
import { CARD_DRAG, SNAP_DRAG, snapWhen } from './snapshot-look';

// The carry tray along the bottom of every admin page. On the Overview, a card dragged onto it (or a Carry
// button) puts a frozen snapshot in; on the Scratchpad a snapshot goes onto the board with + or a drag.
@Component({
  selector: 'app-carry-tray',
  imports: [RouterLink],
  templateUrl: './carry-tray.html',
  styleUrl: './carry-tray.css',
})
export class CarryTray {
  protected tray = inject(TrayStore);
  private auth = inject(Auth);
  protected readonly snapWhen = snapWhen;
  // A card from the Overview is over the tray
  over = signal(false);
  open = signal(true);
  canPlace = computed(() => !!this.tray.placer());

  constructor() {
    // The tray is the signed in admin's own, so it is read once they are known
    effect(() => {
      if (this.auth.isAdmin()) untracked(() => void this.tray.load());
    });
  }

  place(snap: Snapshot): void {
    this.tray.placer()?.(snap);
  }

  onDragStart(event: DragEvent, snap: Snapshot): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(SNAP_DRAG, snap.id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  onDragOver(event: DragEvent): void {
    if (!this.tray.carrier() || !event.dataTransfer?.types.includes(CARD_DRAG)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.over.set(true);
  }

  onDrop(event: DragEvent): void {
    this.over.set(false);
    const kind = event.dataTransfer?.getData(CARD_DRAG);
    if (kind !== 'circle' && kind !== 'list') return;
    event.preventDefault();
    this.open.set(true);
    this.tray.carrier()?.(kind);
  }
}
