import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { BoardDocument } from '../models/board';
import { errorText } from '../services/industry-api';

// The pill next to Shortcuts. Three states, one rule: nothing is called Saved until the server says so.
// See OVERVIEW_HANDOFF.md, "the save state".
export type SaveState = 'save' | 'saved' | 'failed';

export const SAVE_DEBOUNCE_MS = 700;
export const PERIODIC_SAVE_MS = 120_000;
const RETRY_MAX_MS = 30_000;

// Saving one open board. Made when the board opens and thrown away when it closes, so nothing (a timer, a late
// answer, a count) from one board can leak into the next. Only the board engine makes these.
export class BoardSync {
  readonly state = signal<SaveState>('saved');
  // Another tab or device saved this board first (409). Saving stops, nothing is overwritten, and changes go on
  // being counted so the page can say what Reload would lose.
  readonly conflict = signal(false);
  readonly unsavedSteps = signal(0);
  // The API refused the board itself (too many things, a drawing too long). Retrying can't help, so it waits for
  // the next change, and the pill says why.
  readonly problem = signal<string | null>(null);

  private version = 0;
  private savedVersion = 0;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private periodic: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private send: (document: BoardDocument, updatedAt: string | null) => Observable<{ updatedAt: string }>,
    private read: () => BoardDocument,
    public updatedAt: string | null,
  ) {
    // A quiet session can't drift unsaved: every 2 minutes, only when something is waiting
    this.periodic = setInterval(() => { if (this.unsaved && !this.conflict()) void this.saveNow(); }, PERIODIC_SAVE_MS);
  }

  get unsaved(): boolean {
    return this.version !== this.savedVersion;
  }

  // The board changed. step is true for a change that is its own undo step, which is what the count is of.
  changed(step: boolean): void {
    if (this.closed) return;
    this.version += 1;
    if (step) this.unsavedSteps.update(n => n + 1);
    if (this.conflict()) return;
    this.problem.set(null);
    if (this.state() !== 'failed') this.state.set('save');
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  // Send now. One save at a time: a second one sent before the first answers would carry the same stale
  // updatedAt and the tab would refuse itself, so it waits and goes once the first has moved updatedAt on.
  async saveNow(): Promise<void> {
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.closed || this.conflict() || !this.unsaved) return;
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = this.sendOnce();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    if (this.again && this.unsaved && !this.conflict() && this.state() !== 'failed') {
      this.again = false;
      await this.saveNow();
    }
    this.again = false;
  }

  private async sendOnce(): Promise<void> {
    const version = this.version;
    const steps = this.unsavedSteps();
    // A quiet retry after a failure keeps saying Failed to save until one gets through, so the pill never flickers
    if (this.state() !== 'failed') this.state.set('save');
    try {
      const answer = await firstValueFrom(this.send(this.read(), this.updatedAt));
      if (this.closed) return;
      this.updatedAt = answer.updatedAt;
      this.failures = 0;
      this.savedVersion = Math.max(this.savedVersion, version);
      this.unsavedSteps.update(n => Math.max(0, n - steps));
      if (this.conflict()) return;
      // Something changed while this was out, so nothing is confirmed yet and another save follows
      this.state.set(this.unsaved ? 'save' : 'saved');
      if (this.unsaved) this.changedAgain();
    } catch (error) {
      if (this.closed) return;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        // Never pretend this one saved, and don't retry into the same wall
        this.conflict.set(true);
        this.state.set('failed');
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 400) {
        this.problem.set(errorText(error, "This board can't be saved as it is"));
        this.state.set('failed');
        return;
      }
      this.failures += 1;
      this.state.set('failed');
      const wait = Math.min(RETRY_MAX_MS, 1500 * 2 ** Math.min(this.failures - 1, 5));
      this.retry = setTimeout(() => { void this.saveNow(); }, wait);
    }
  }

  private changedAgain(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  // Try again, pressed by the person: straight away, with the waiting reset
  retryNow(): Promise<void> {
    this.failures = 0;
    return this.saveNow();
  }

  // Before the board closes: send what is waiting and say whether it all reached the server
  async flush(): Promise<boolean> {
    for (let tries = 0; tries < 3 && this.unsaved && !this.conflict() && !this.closed; tries++) {
      if (this.inFlight) await this.inFlight;
      else await this.saveNow();
      if (this.state() === 'failed') break;
    }
    return !this.unsaved;
  }

  // The new board a stale tab's changes were kept as: it saves to there from now on
  movedTo(send: (document: BoardDocument, updatedAt: string | null) => Observable<{ updatedAt: string }>, updatedAt: string): void {
    this.send = send;
    this.updatedAt = updatedAt;
    this.savedVersion = this.version;
    this.unsavedSteps.set(0);
    this.failures = 0;
    this.conflict.set(false);
    this.state.set('saved');
  }

  close(): void {
    this.closed = true;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retry) clearTimeout(this.retry);
    clearInterval(this.periodic);
  }
}
