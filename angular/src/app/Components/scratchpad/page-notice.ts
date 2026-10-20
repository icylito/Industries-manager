import { DestroyRef, Injectable, inject, signal } from '@angular/core';

// The Scratchpad's toast: names exactly what happened, can be closed, and goes on its own after 10 seconds.
// One per open page, shared by the page and the file cards.
@Injectable()
export class PageNotice {
  readonly lines = signal<string[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
  }

  show(lines: string[]): void {
    this.lines.set(lines);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lines.set([]), 10_000);
  }

  dismiss(): void {
    this.lines.set([]);
    if (this.timer) clearTimeout(this.timer);
  }
}
