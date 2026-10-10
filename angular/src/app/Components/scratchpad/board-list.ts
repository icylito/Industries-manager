import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { BoardsStore } from '../../board/boards-store';
import { BoardEngine } from '../../board/board-engine';
import { BoardSummary } from '../../models/board';

// The Boards section of the Scratchpad's sidebar: every board the person keeps, pinned ones first, then the most
// recently changed. Click one to open it. Rename, pin and delete sit at the end of each row, and a delete asks
// in the row. A pinned board can't be deleted until it is unpinned, the same rule as pinned versions on History.
@Component({
  selector: 'app-board-list',
  templateUrl: './board-list.html',
  styleUrl: './board-list.css',
})
export class BoardList {
  protected boards = inject(BoardsStore);
  private engine = inject(BoardEngine);
  current = input<number | null>(null);
  opened = output<number>();

  private list = viewChild<ElementRef<HTMLElement>>('list');

  renaming = signal<number | null>(null);
  confirming = signal<number | null>(null);
  busy = signal<number | null>(null);
  message = signal('');
  making = signal(false);

  constructor() {
    void this.boards.load();
  }

  async newBoard(): Promise<void> {
    if (this.making()) return;
    this.making.set(true);
    const made = await this.boards.create('Board ' + (this.boards.list().length + 1));
    this.making.set(false);
    if (typeof made === 'string') { this.message.set(made); return; }
    this.message.set('');
    this.opened.emit(made);
  }

  // The board chip at the top of the page brings the person here: the open board's row takes the focus
  focusCurrent(): void {
    setTimeout(() => {
      const row = this.list()?.nativeElement.querySelector<HTMLElement>('[aria-current="true"]')
        ?? this.list()?.nativeElement.querySelector<HTMLElement>('.bl-name');
      row?.focus();
      row?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  startRename(board: BoardSummary): void {
    this.confirming.set(null);
    this.renaming.set(board.id);
    setTimeout(() => {
      const box = this.list()?.nativeElement.querySelector<HTMLInputElement>('.bl-rename');
      box?.focus();
      box?.select();
    }, 0);
  }

  async finishRename(board: BoardSummary, value: string): Promise<void> {
    if (this.renaming() !== board.id) return;
    this.renaming.set(null);
    const name = value.trim();
    if (!name || name === board.name) return;
    const failed = await this.boards.rename(board.id, name);
    this.message.set(failed ?? '');
    // The open board's name at the top follows
    if (!failed && this.engine.boardId() === board.id) this.engine.rename(name.slice(0, 60));
  }

  async togglePin(board: BoardSummary): Promise<void> {
    this.busy.set(board.id);
    this.message.set((await this.boards.setPinned(board.id, !board.pinned)) ?? '');
    this.busy.set(null);
  }

  async remove(board: BoardSummary): Promise<void> {
    this.busy.set(board.id);
    const failed = await this.boards.remove(board.id);
    this.busy.set(null);
    this.confirming.set(null);
    this.message.set(failed ?? '"' + board.name + '" is deleted. Its files stay for 7 days in case you need them.');
  }

  // What the row says when the pointer rests on it
  about(board: BoardSummary): string {
    const things = board.things === 0 ? 'Empty' : board.things === 1 ? '1 thing' : board.things + ' things';
    return board.name + '\n' + things + ', changed ' + this.when(board.updatedAt) + (board.pinned ? '\nPinned' : '');
  }

  private when(iso: string): string {
    const at = new Date(iso);
    const today = new Date();
    const day = at.toDateString() === today.toDateString()
      ? 'today'
      : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: at.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    return day + ' at ' + at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}
