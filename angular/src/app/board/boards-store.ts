import { Service, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BoardSummary } from '../models/board';
import { ScratchApi } from './scratch-api';
import { errorText } from '../services/industry-api';

const LAST_BOARD = 'stock-listing-last-board';

// The person's boards, as the History tab lists them: pinned first, then the most recently changed.
// Each call answers a plain message on failure, or null when it worked.
@Service()
export class BoardsStore {
  private api = inject(ScratchApi);

  readonly list = signal<BoardSummary[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly sorted = computed(() => [...this.list()].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id));

  async load(): Promise<boolean> {
    this.loading.set(true);
    try {
      this.list.set(await firstValueFrom(this.api.boards()));
      this.failed.set(false);
      return true;
    } catch {
      this.failed.set(true);
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  // The board to open when the page opens with no board named: the last one opened in this browser if it is
  // still there, or else the first in the list, or else a new one
  async startingBoard(): Promise<number | null> {
    if (!this.list().length && !(await this.load())) return null;
    const last = Number(readLast());
    if (this.list().some(board => board.id === last)) return last;
    if (this.list().length) return this.sorted()[0].id;
    const made = await this.create('My board');
    return typeof made === 'number' ? made : null;
  }

  remember(id: number): void {
    try {
      localStorage.setItem(LAST_BOARD, String(id));
    } catch {
      // Blocked storage, the page opens the first board instead
    }
  }

  // A new empty board. Answers its id, or the reason it couldn't be made.
  async create(name: string): Promise<number | string> {
    try {
      const made = await firstValueFrom(this.api.createBoard(name));
      this.list.update(all => [made, ...all]);
      return made.id;
    } catch (err) {
      return errorText(err as HttpErrorResponse, "Couldn't make a new board");
    }
  }

  async rename(id: number, name: string): Promise<string | null> {
    try {
      const done = await firstValueFrom(this.api.changeBoard(id, { name }));
      this.list.update(all => all.map(board => (board.id === id ? { ...board, name: done.name } : board)));
      return null;
    } catch (err) {
      return errorText(err as HttpErrorResponse, "Couldn't rename the board");
    }
  }

  async setPinned(id: number, pinned: boolean): Promise<string | null> {
    try {
      await firstValueFrom(this.api.changeBoard(id, { pinned }));
      this.list.update(all => all.map(board => (board.id === id ? { ...board, pinned } : board)));
      return null;
    } catch (err) {
      return errorText(err as HttpErrorResponse, pinned ? "Couldn't pin the board" : "Couldn't unpin the board");
    }
  }

  async remove(id: number): Promise<string | null> {
    try {
      await firstValueFrom(this.api.deleteBoard(id));
      this.list.update(all => all.filter(board => board.id !== id));
      return null;
    } catch (err) {
      return errorText(err as HttpErrorResponse, "Couldn't delete the board");
    }
  }

  // The open board was saved: its row moves up and shows its new count
  touched(id: number, things: number): void {
    this.list.update(all => all.map(board => (board.id === id ? { ...board, things, updatedAt: new Date().toISOString() } : board)));
  }

  added(board: BoardSummary): void {
    this.list.update(all => [board, ...all.filter(one => one.id !== board.id)]);
  }
}

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_BOARD);
  } catch {
    return null;
  }
}
