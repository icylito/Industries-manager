import { Injectable, signal } from '@angular/core';

// The colour a picker is showing right now on the things it is changing. It is only what is drawn: nothing is
// saved and nothing is an undo step until the picker hands the colour over, so dragging the dial can repaint the
// board on every move.
@Injectable({ providedIn: 'root' })
export class ColourPreview {
  readonly state = signal<{ ids: ReadonlySet<string>; color: string } | null>(null);

  show(ids: readonly string[], color: string): void {
    this.state.set({ ids: new Set(ids), color });
  }

  clear(): void {
    this.state.set(null);
  }
}
