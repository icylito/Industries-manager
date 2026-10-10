import { Component, computed, inject, input, output, signal } from '@angular/core';
import { BoardsStore } from '../../board/boards-store';
import { BoardEngine } from '../../board/board-engine';
import { BoardSummary } from '../../models/board';

// The Scratchpad's History tab: every board the person keeps, pinned ones first, then the most recently
// changed. Open, rename in place, pin, and delete with a question in the row. A pinned board can't be deleted
// until it is unpinned, the same rule as pinned versions on the History page.
@Component({
  selector: 'app-board-history',
  templateUrl: './board-history.html',
  styleUrl: './board-history.css',
})
export class BoardHistory {
  protected boards = inject(BoardsStore);
  private engine = inject(BoardEngine);
  current = input<number | null>(null);
  opened = output<number>();

  static readonly PAGE = 10;
  page = signal(0);
  pages = computed(() => Math.max(1, Math.ceil(this.boards.sorted().length / BoardHistory.PAGE)));
  shownPage = computed(() => Math.min(this.page(), this.pages() - 1));
  paged = computed(() => this.boards.sorted().slice(this.shownPage() * BoardHistory.PAGE, (this.shownPage() + 1) * BoardHistory.PAGE));

  renaming = signal<number | null>(null);
  confirming = signal<number | null>(null);
  busy = signal<number | null>(null);
  message = signal('');
  making = signal(false);

  constructor() {
    // The list opens on the page that holds the board being worked on
    void this.boards.load().then(() => {
      const at = this.boards.sorted().findIndex(board => board.id === this.current());
      if (at >= 0) this.page.set(Math.floor(at / BoardHistory.PAGE));
    });
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

  startRename(board: BoardSummary): void {
    this.confirming.set(null);
    this.renaming.set(board.id);
    setTimeout(() => {
      const box = document.querySelector('.bh-rename') as HTMLInputElement | null;
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
    // A delete that empties the last page steps back one
    if (this.page() > this.pages() - 1) this.page.set(this.pages() - 1);
  }

  when(iso: string): string {
    const at = new Date(iso);
    const today = new Date();
    const day = at.toDateString() === today.toDateString()
      ? 'Today'
      : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: at.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    return day + ', ' + at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  things(n: number): string {
    return n === 0 ? 'Empty' : n === 1 ? '1 thing' : n + ' things';
  }
}
