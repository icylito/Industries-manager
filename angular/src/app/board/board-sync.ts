import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { BoardDocument } from '../models/board';
import { errorText } from '../services/industry-api';

// The pill next to Shortcuts. Three states, one rule: nothing is called Saved until the server says so.
// See OVERVIEW_HANDOFF.md, "the save state".
export type SaveState = 'save' | 'saved' | 'failed';
// Why saving stopped for good: another tab or device saved first (409), or the board was deleted (404)
export type Conflict = 'changed' | 'deleted';

export const SAVE_DEBOUNCE_MS = 700;
export const PERIODIC_SAVE_MS = 120_000;
const RETRY_MAX_MS = 30_000;

// Saving one open board. Made when the board opens and thrown away once everything it was given is saved, so
// nothing (a timer, a late answer, a count) from one board can leak into the next. Only the board engine makes these.
export class BoardSync {
  readonly state = signal<SaveState>('saved');
  // Saving stops, nothing is overwritten, and changes go on being counted so the page can say what Reload would lose
  readonly conflict = signal<Conflict | null>(null);
  readonly unsavedSteps = signal(0);
  // The API refused the board itself (too many things). Retrying can't help, so it waits for the next change,
  // and the pill says why.
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
  // Set while the board is being left: called once nothing is waiting any more, or saving can't go on
  private drained: (() => void) | null = null;

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
    this.later(SAVE_DEBOUNCE_MS);
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
    if (!this.unsaved || this.conflict() || this.problem()) this.settle();
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
      if (this.unsaved) this.later(SAVE_DEBOUNCE_MS);
    } catch (error) {
      if (this.closed) return;
      const status = error instanceof HttpErrorResponse ? error.status : -1;
      if (status === 409 || status === 404) {
        // Never pretend this one saved, and don't retry into the same wall
        this.conflict.set(status === 409 ? 'changed' : 'deleted');
        this.state.set('failed');
        return;
      }
      if (status === 400) {
        this.problem.set(errorText(error as HttpErrorResponse, "This board can't be saved as it is"));
        this.state.set('failed');
        return;
      }
      this.failures += 1;
      this.state.set('failed');
      this.retry = setTimeout(() => { void this.saveNow(); }, Math.min(RETRY_MAX_MS, 1500 * 2 ** Math.min(this.failures - 1, 5)));
    }
  }

  private later(ms: number): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.saveNow(); }, ms);
  }

  // Try again, pressed by the person: straight away, with the waiting reset
  retryNow(): Promise<void> {
    this.failures = 0;
    return this.saveNow();
  }

  // Before another board opens: send what is waiting and say whether it all reached the server
  async flush(): Promise<boolean> {
    for (let tries = 0; tries < 3 && this.unsaved && !this.conflict() && !this.closed; tries++) {
      if (this.inFlight) await this.inFlight;
      else await this.saveNow();
      if (this.state() === 'failed') break;
    }
    return !this.unsaved;
  }

  // The board is being left: from now on this saves the board as it was left, keeps retrying on its own while
  // the API is away, and closes once everything reached the server or saving can't go on (a conflict, a refusal).
  // The promise says when, so opening the same board again can wait for it.
  drain(left: () => BoardDocument): Promise<void> {
    this.read = left;
    return new Promise(done => {
      this.drained = () => { this.drained = null; this.close(); done(); };
      if (!this.unsaved || this.conflict() || this.problem()) this.settle();
      else void this.saveNow();
    });
  }

  // A change to a board that is being left: an upload finishing after the page closed
  changedWhileLeaving(): void {
    if (!this.drained || this.closed) return;
    this.version += 1;
    this.problem.set(null);
    this.later(0);
  }

  get draining(): boolean {
    return !!this.drained && !this.closed;
  }

  // The new board a stale tab's changes were kept as: it saves to there from now on
  movedTo(send: (document: BoardDocument, updatedAt: string | null) => Observable<{ updatedAt: string }>, updatedAt: string): void {
    this.send = send;
    this.updatedAt = updatedAt;
    this.savedVersion = this.version;
    this.unsavedSteps.set(0);
    this.failures = 0;
    this.conflict.set(null);
    this.problem.set(null);
    this.state.set('saved');
  }

  close(): void {
    this.closed = true;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retry) clearTimeout(this.retry);
    clearInterval(this.periodic);
  }

  private settle(): void {
    if (this.drained && !this.inFlight && !this.debounce) this.drained();
  }
}
