import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PaperItem, TextSize } from '../../../domain/models/board';
import { BoardEngine, Tx } from '../../../application/board/board-engine';
import { worldFromScreen, worldLength } from '../../../domain/board/geometry';
import {
  FONT_GROUPS,
  SIZE_STEPS,
  ensureFont,
  renderBlocks,
  serializeBlocks,
  sizeToExec,
} from './rich-text';

// One note or text box, edited in place. The words picked get bold, highlight, a font and a size, all
// stored as runs, so a single word can look different from the words beside it (OVERVIEW_HANDOFF item d).

@Component({
  selector: 'app-note-editor',
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.css',
})
export class NoteEditor {
  item = input.required<PaperItem>();
  private board = inject(BoardEngine);
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
  // The typing burst under way: one undo step from the first key to the blur, or to a format press
  private tx: Tx | null = null;

  constructor() {
    effect(() => {
      // Only an outside change (open, undo, redo) redraws from the runs, so typing never jumps the caret
      this.board.external();
      const blocks = untracked(() => this.item().blocks ?? []);
      const el = this.editor()?.nativeElement;
      if (el) el.innerHTML = renderBlocks(blocks);
    });

    const onSelection = () => this.updateBar();
    document.addEventListener('selectionchange', onSelection);
    this.destroy.onDestroy(() => document.removeEventListener('selectionchange', onSelection));
  }

  // The words as they are now go on the board. A burst starts on the first change if none is open, so typing
  // after an undo, or after something else on the board changed, is still its own step.
  private store(): void {
    const el = this.editor()?.nativeElement;
    if (!el) return;
    if (!this.tx?.open) this.tx = this.board.begin();
    this.tx.apply({ op: 'patch', ids: [this.item().id], patch: { blocks: serializeBlocks(el) } });
  }

  private endBurst(): void {
    this.tx?.commit();
    this.tx = null;
  }

  onFocus(): void {
    this.focused = true;
  }

  onInput(): void {
    this.store();
  }

  // The browser's own Ctrl+B would land inside the typing burst, so Ctrl+Z after bolding would take the typed words
  // too: it goes through format instead, its own undo step. Italic and underline aren't kept in a note's runs, so
  // the browser's Ctrl+I and Ctrl+U are stopped rather than showing a look that is gone after a reload.
  onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i' && key !== 'u') return;
    event.preventDefault();
    if (key === 'b') this.format('bold', undefined, false);
  }

  onBlur(): void {
    this.focused = false;
    const el = this.editor()?.nativeElement;
    // Only when the words really differ, so a blur after an undo never writes the old words back
    if (el && this.tx?.open) this.store();
    this.endBurst();
    // A press on the little toolbar blurs the editor first, so give the press time to land
    setTimeout(() => {
      if (!this.focused) this.bar.set(false);
    }, 200);
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
    const canvas = this.editor()?.nativeElement.closest('.canvas') as HTMLElement | null;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const view = this.board.view();
    const box = range.getBoundingClientRect();
    const item = this.item();
    const wantedX = box.left + box.width / 2;
    const clampedX = Math.min(Math.max(wantedX, canvasRect.left + 70), canvasRect.right - 70);
    // Above the words when there is room, below them when there is not, so it never covers them
    const below = box.top - 54 < canvasRect.top;
    const wantedY = below ? box.bottom : box.top;
    const clampedY = Math.min(Math.max(wantedY, canvasRect.top + 6), canvasRect.bottom - 6);
    this.barBelow.set(below);
    const at = worldFromScreen(
      { x: clampedX - canvasRect.left, y: clampedY - canvasRect.top },
      view,
    );
    this.barPos.set({ x: at.x - item.x, y: at.y - item.y });
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
    const by = worldLength({ x: dx, y: dy }, this.board.view());
    this.barPos.set({ x: spot.x + by.x, y: spot.y + by.y });
  }

  // The offset is multiplied by the counter-scale, so the gap between the bar and the words is the same
  // on screen at 100% and zoomed right out, where the bar would otherwise sit on top of them.
  barTransform = computed(() => {
    const scale = this.barScale();
    const y = (this.barBelow() ? 12 : -140) * scale;
    return 'translate(' + -50 * scale + '%, ' + y + '%) scale(' + scale + ')';
  });

  private markColour(): string {
    return (
      getComputedStyle(document.documentElement).getPropertyValue('--mark').trim() || '#ffe58a'
    );
  }

  // restore puts back the words picked before a press on the bar took the focus; a key press keeps the caret as it is
  format(command: string, value?: string, restore = true): void {
    const el = this.editor()?.nativeElement;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (restore && this.saved && selection) {
      selection.removeAllRanges();
      selection.addRange(this.saved);
    }
    // One undo step per formatting press: the typing before it is its own step
    this.endBurst();
    // A press that changes nothing kept (bold with nothing picked, in an empty note) is no undo step
    const shape = () =>
      JSON.stringify(serializeBlocks(el).map((block) => [block.list, block.runs]));
    const before = shape();
    document.execCommand(command, false, value);
    if (shape() !== before) this.store();
    this.endBurst();
    this.updateBar();
  }

  bold(): void {
    this.format('bold');
  }
  highlight(): void {
    this.format('hiliteColor', this.markColour());
  }
  bullets(): void {
    this.format('insertUnorderedList');
  }
  numbers(): void {
    this.format('insertOrderedList');
  }

  setSize(size: TextSize): void {
    this.format('fontSize', sizeToExec(size));
  }

  setFont(family: string): void {
    this.fontsOpen.set(false);
    ensureFont(family);
    this.format('fontName', family);
  }
}
