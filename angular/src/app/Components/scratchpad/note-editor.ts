import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { BoardItem, TextSize } from '../../models/industry';
import { Scratchpad } from '../../services/scratchpad';
import { FONT_GROUPS, SIZE_STEPS, ensureFont, renderBlocks, serializeBlocks, sizeToExec } from './rich-text';

// One note or text box, edited in place. The words picked get bold, highlight, a font and a size, all
// stored as runs, so a single word can look different from the words beside it (OVERVIEW_HANDOFF item d).

@Component({
  selector: 'app-note-editor',
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.css',
})
export class NoteEditor {
  item = input.required<BoardItem>();
  private pad = inject(Scratchpad);
  private destroy = inject(DestroyRef);
  private editor = viewChild<ElementRef<HTMLElement>>('editor');

  bar = signal(false);
  barPos = signal<{ x: number; y: number } | null>(null);
  // The bar keeps its size on screen at any zoom, and stays inside the board so it is never clipped
  barScale = signal(1);
  barBelow = signal(false);
  fontsOpen = signal(false);
  protected readonly groups = FONT_GROUPS;
  protected readonly sizes = SIZE_STEPS;

  private saved: Range | null = null;
  private focused = false;

  constructor() {
    effect(() => {
      // Only an outside change (open, undo, redo) redraws from the runs, so typing never jumps the caret
      this.pad.external();
      const blocks = untracked(() => this.item().blocks ?? []);
      const el = this.editor()?.nativeElement;
      if (el) el.innerHTML = renderBlocks(blocks);
    });

    const onSelection = () => this.updateBar();
    document.addEventListener('selectionchange', onSelection);
    this.destroy.onDestroy(() => document.removeEventListener('selectionchange', onSelection));
  }

  private store(): void {
    const el = this.editor()?.nativeElement;
    if (!el) return;
    this.pad.blocksLive(this.item().id, serializeBlocks(el));
  }

  onFocus(): void {
    this.focused = true;
    this.pad.begin();
  }

  onInput(): void {
    // Start a burst if one is not already open, so typing after an undo or after a blur is still one step
    this.pad.begin();
    this.store();
  }

  onBlur(): void {
    this.focused = false;
    this.store();
    this.pad.end();
    // A press on the little toolbar blurs the editor first, so give the press time to land
    setTimeout(() => { if (!this.focused) this.bar.set(false); }, 200);
  }

  private updateBar(): void {
    const el = this.editor()?.nativeElement;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      // While the words are being edited the bar stays put, so a press on it is never lost
      if (!this.focused) {
        this.bar.set(false);
        this.saved = null;
      }
      return;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      this.bar.set(false);
      return;
    }
    this.saved = range.cloneRange();
    const canvas = (this.editor()?.nativeElement.closest('.canvas') as HTMLElement | null);
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const view = this.pad.board().view;
    const box = range.getBoundingClientRect();
    const item = this.item();
    const wantedX = box.left + box.width / 2;
    const clampedX = Math.min(Math.max(wantedX, canvasRect.left + 70), canvasRect.right - 70);
    // Above the words when there is room, below them when there is not, so it never covers them
    const below = box.top - 54 < canvasRect.top;
    const wantedY = below ? box.bottom : box.top;
    const clampedY = Math.min(Math.max(wantedY, canvasRect.top + 6), canvasRect.bottom - 6);
    this.barBelow.set(below);
    this.barPos.set({
      x: (clampedX - canvasRect.left - view.x) / view.zoom - item.x,
      y: (clampedY - canvasRect.top - view.y) / view.zoom - item.y,
    });
    this.barScale.set(1 / view.zoom);
    this.bar.set(true);
    // The bar is wide, so once it is drawn pull it back inside the board if it pokes past an edge
    setTimeout(() => this.nudgeInside(), 0);
  }

  private nudgeInside(): void {
    const bar = document.querySelector('.fmt') as HTMLElement | null;
    const canvas = document.querySelector('.canvas') as HTMLElement | null;
    const spot = this.barPos();
    if (!bar || !canvas || !spot) return;
    const rect = bar.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < box.left + 8) dx = box.left + 8 - rect.left;
    else if (rect.right > box.right - 8) dx = box.right - 8 - rect.right;
    if (rect.top < box.top + 8) dy = box.top + 8 - rect.top;
    if (dx === 0 && dy === 0) return;
    const zoom = this.pad.board().view.zoom;
    this.barPos.set({ x: spot.x + dx / zoom, y: spot.y + dy / zoom });
  }

  // The offset is multiplied by the counter-scale, so the gap between the bar and the words is the same
  // on screen at 100% and zoomed right out, where the bar would otherwise sit on top of them.
  barTransform = computed(() => {
    const scale = this.barScale();
    const y = (this.barBelow() ? 12 : -140) * scale;
    return 'translate(' + (-50 * scale) + '%, ' + y + '%) scale(' + scale + ')';
  });

  private markColour(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--mark').trim() || '#ffe58a';
  }

  format(command: string, value?: string): void {
    const el = this.editor()?.nativeElement;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (this.saved && selection) {
      selection.removeAllRanges();
      selection.addRange(this.saved);
    }
    document.execCommand(command, false, value);
    this.store();
    // One undo step per formatting press
    this.pad.end();
    this.pad.begin();
    this.updateBar();
  }

  bold(): void { this.format('bold'); }
  highlight(): void { this.format('hiliteColor', this.markColour()); }
  bullets(): void { this.format('insertUnorderedList'); }
  numbers(): void { this.format('insertOrderedList'); }

  setSize(size: TextSize): void { this.format('fontSize', sizeToExec(size)); }

  setFont(family: string): void {
    this.fontsOpen.set(false);
    ensureFont(family);
    this.format('fontName', family);
  }
}
