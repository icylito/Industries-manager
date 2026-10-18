import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Industry } from '../../../domain/models/industry';
import { IndustryApi } from '../../../infrastructure/industry-api';
import { BoardEngine, Placement } from '../../../application/board/board-engine';

// A company dragged from the rail onto the board
export const INDUSTRY_DRAG = 'application/x-scratchpad-industry';
export type RailRow = Industry & { rank?: number | null };

// A company card on the board, once: a company already there is never added twice
export function placeIndustry(
  board: BoardEngine,
  row: RailRow,
  placement: Placement = 'auto',
): void {
  if (board.industryIds().has(row.id) || board.status() !== 'ready') return;
  board.place('industry', placement, {
    industryId: row.id,
    name: row.name,
    sector: row.sector,
    price: row.price,
    rank: row.rank ?? null,
  });
}

// The companies on the Scratchpad's rail. It never loads the table: with no search it shows the 3 most expensive
// rows, and says so; typing swaps them for up to 10 name matches. See OVERVIEW_HANDOFF.md, "the companies rail".
@Component({
  selector: 'app-company-rail',
  templateUrl: './company-rail.html',
  styleUrl: './company-rail.css',
})
export class CompanyRail {
  static readonly TOP = 3;
  static readonly MATCHES = 10;

  protected board = inject(BoardEngine);
  private api = inject(IndustryApi);

  search = signal('');
  matches = signal<Industry[]>([]);
  railLoading = signal(true);
  railError = signal(false);
  railHelper = computed(() =>
    this.search().trim()
      ? 'Drag one onto the board, or press +.'
      : 'Most expensive first. Search for any other.',
  );
  private timer: ReturnType<typeof setTimeout> | null = null;
  private call: Subscription | null = null;

  constructor() {
    this.loadRail();
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      this.call?.unsubscribe();
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
    if (this.timer) clearTimeout(this.timer);
    // A short pause, so a typed word is one request rather than one per letter
    this.timer = setTimeout(() => this.loadRail(), 250);
  }

  loadRail(): void {
    const query = this.search().trim();
    this.call?.unsubscribe();
    this.railLoading.set(true);
    const call = query
      ? this.api.searchIndustries(query, CompanyRail.MATCHES)
      : this.api.topIndustries(CompanyRail.TOP);
    this.call = call.subscribe({
      next: (rows) => {
        this.matches.set(rows);
        this.railLoading.set(false);
        this.railError.set(false);
      },
      error: () => {
        this.matches.set([]);
        this.railLoading.set(false);
        this.railError.set(true);
      },
    });
  }

  // A card added from the top list carries its place in that list (#1..#3). One added from a search has no rank.
  private rankOf(row: Industry): number | null {
    if (this.search().trim()) return null;
    const at = this.matches().findIndex((one) => one.id === row.id);
    return at >= 0 ? at + 1 : null;
  }

  onBoard(row: Industry): boolean {
    return this.board.industryIds().has(row.id);
  }

  addIndustry(row: Industry): void {
    placeIndustry(this.board, { ...row, rank: this.rankOf(row) });
  }

  onRailDragStart(event: DragEvent, row: Industry): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(INDUSTRY_DRAG, JSON.stringify({ ...row, rank: this.rankOf(row) }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  rowPrice(row: Industry): string {
    return row.price === null || row.price === undefined ? 'No price' : '$' + row.price.toFixed(3);
  }
}
