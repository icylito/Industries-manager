import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BoardItem, FileItem, NoteTone, PaperItem, Snapshot, TextAlign } from '../../models/board';
import { IndustryApi } from '../../services/industry-api';
import { Shortcuts, modHeld } from '../../services/shortcuts';
import { BoardEngine } from '../../board/board-engine';
import { BoardsStore } from '../../board/boards-store';
import { TrayStore } from '../../board/tray-store';
import { KINDS, kindOf } from '../../board/item-kinds';
import { Rect, bounds, clampZoom, linePath, strokePath, viewOnto, worldFromScreen, zoomAround } from '../../board/geometry';
import { BoardTool, Draft, Gesture, PointerCtx, STROKE_WIDTH, TOOLS, ToolUi, hitTest, isEditable, panGesture } from '../../board/tools';
import { BoardItemView } from './board-item';
import { CompanyRail, INDUSTRY_DRAG, RailRow, placeIndustry } from './company-rail';
import { FileCards } from './file-cards';
import { PageNotice } from './page-notice';
import { BoardHistory } from './board-history';
import { MAX_FILE_MB, nameForPasted } from './board-files';
import { FONT_GROUPS, ensureFont, ensureFonts, fontCss } from './rich-text';
import { SNAP_DRAG, snapWhen } from '../carry-tray/snapshot-look';

// The Scratchpad: one endless board at a time, picked from the person's boards on the History tab. Everything
// that changes the board goes through the board engine (board/board-engine.ts), and everything the pointer does
// on the board is a tool in board/tools.ts. Each thing is drawn by board-item.ts, the companies by company-rail.ts
// and files are looked after by file-cards.ts. This page lays out the board, routes events, and owns the bars.
// See OVERVIEW_HANDOFF.md for the feel this must keep.
@Component({
  selector: 'app-scratchpad',
  imports: [BoardItemView, CompanyRail, BoardHistory, NgTemplateOutlet, RouterLink],
  providers: [FileCards, PageNotice],
  templateUrl: './scratchpad.html',
  styleUrl: './scratchpad.css',
})
export class ScratchpadPage {
  protected board = inject(BoardEngine);
  protected boards = inject(BoardsStore);
  protected tray = inject(TrayStore);
  protected files = inject(FileCards);
  protected notice = inject(PageNotice);
  private api = inject(IndustryApi);
  protected shortcuts = inject(Shortcuts);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);

  private canvas = viewChild<ElementRef<HTMLElement>>('canvas');
  protected readonly Math = Math;

  // Board or History, and the board asked for, from the address so Back works and a link opens the same board
  private query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  tab = computed(() => (this.query().get('tab') === 'history' ? 'history' : 'board'));
  private wanted = computed(() => {
    const id = Number(this.query().get('board'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  // Couldn't list the boards, or make a first one
  noBoards = signal(false);

  tool = signal<BoardTool>('select');
  spaceDown = signal(false);
  box = signal<Rect | null>(null);
  draft = signal<Draft | null>(null);
  lineFrom = signal<string | null>(null);
  private gesture: Gesture | null = null;

  // Where a file being dragged over the page is
  fileOver = signal<'none' | 'page' | 'button' | 'board'>('none');
  readonly maxFileMb = MAX_FILE_MB;
  protected readonly strokeWidth = STROKE_WIDTH;
  // The stroke being drawn grows in place, so it is worked out afresh each time
  protected readonly strokePath = strokePath;
  protected readonly snapWhen = snapWhen;
  // A stroke's points never change in place (a change makes a new array), so its path is worked out once
  private strokePaths = new WeakMap<number[], string>();
  protected strokeD(points: number[]): string {
    let d = this.strokePaths.get(points);
    if (d === undefined) this.strokePaths.set(points, (d = strokePath(points)));
    return d;
  }

  fontsOpen = signal(false);
  protected readonly fontGroups = FONT_GROUPS;
  protected readonly fontCss = fontCss;

  protected readonly tools: { id: BoardTool; label: string; command: string }[] = [
    { id: 'select', label: 'Select', command: 'sp.select' },
    { id: 'hand', label: 'Hand', command: 'sp.hand' },
    { id: 'line', label: 'Line', command: 'sp.line' },
    { id: 'pen', label: 'Pen', command: 'sp.pen' },
    { id: 'marker', label: 'Marker', command: 'sp.marker' },
    { id: 'rect', label: 'Box', command: 'sp.rect' },
  ];

  pickedCount = computed(() => this.board.selectedIds().length);
  picked = computed(() => this.board.selectedOne());
  pickedPaper = computed(() => {
    const one = this.picked();
    return one && (one.type === 'note' || one.type === 'text') ? one : null;
  });
  pickedFont = computed(() => this.pickedPaper()?.blocks.flatMap(block => block.runs).find(run => run.text)?.font ?? 'Inter');
  pickedStyle = computed(() => {
    const runs = this.pickedPaper()?.blocks.flatMap(block => block.runs).filter(run => run.text) ?? [];
    return { bold: runs.length > 0 && runs.every(run => run.bold), highlight: runs.length > 0 && runs.every(run => run.highlight) };
  });
  // The picked things that take a paper colour
  pickedToned = computed(() => this.board.selection().filter(item => KINDS[item.type].toned));
  bar = computed(() => {
    const one = this.picked();
    return one ? kindOf(one).bar : null;
  });

  // What the tool in hand does, in the same spot on the toolbar so it never jumps around
  toolHint = computed(() => {
    const tool = this.tool();
    if (this.spaceDown() || tool === 'hand') return 'Drag to move around the board. Scrolling also moves it, ' + this.shortcuts.mouseMod('mouse.zoom') + ' + scroll zooms.';
    if (tool === 'line') return this.lineFrom() ? 'Now click the thing to point it at.' : 'Click a thing, then another. The arrow points at the second, and follows when either moves.';
    if (tool === 'pen') return 'Draw by hand. Each stroke is one thing you can move, group or delete.';
    if (tool === 'marker') return 'Mark something out with a wide see-through stroke.';
    if (tool === 'rect') return 'Drag to draw a box around an area. Esc goes back to Select.';
    return 'Drag a box on empty space to select several things. ' + this.shortcuts.mouseMod('mouse.add') + ' + click adds one, '
      + this.shortcuts.mouseMod('mouse.dup') + ' + drag copies.';
  });

  layerTransform = computed(() => {
    const view = this.board.view();
    return 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
  });
  zoomPercent = computed(() => Math.round(this.board.view().zoom * 100));

  selectedGroupName = computed(() => this.board.doc().groups.find(group => group.id === this.board.selectedGroupId())?.name ?? '');

  // The outline of a group, drawn from the real boxes of its members so it grows and shrinks with them
  groupBoxes = computed(() => {
    const byId = new Map(this.board.doc().items.map(item => [item.id, item]));
    return this.board.doc().groups.flatMap(group => {
      const box = bounds(group.itemIds.map(id => byId.get(id)).filter((item): item is BoardItem => !!item));
      return box ? [{ id: group.id, name: group.name, x: box.x - 18, y: box.y - 18, w: box.w + 36, h: box.h + 36 }] : [];
    });
  });

  // Lines meet the real edge of each thing and follow it whenever it moves
  lineShapes = computed(() => {
    const byId = new Map(this.board.doc().items.map(item => [item.id, item]));
    return this.board.doc().lines.flatMap(line => {
      const from = byId.get(line.from);
      const to = byId.get(line.to);
      if (!from || !to) return [];
      const path = linePath(from, to, line.bend);
      return [{ id: line.id, d: path.d, head: line.head, label: line.label, pill: path.middle, name: this.nameOf(from) + ' to ' + this.nameOf(to) }];
    });
  });
  selectedLine = computed(() => this.board.doc().lines.find(line => line.id === this.board.selectedLineId()) ?? null);
  editingLineId = signal<string | null>(null);

  private ui: ToolUi = {
    view: () => this.board.view(),
    setView: view => this.board.setView(view),
    setBox: box => this.box.set(box),
    setDraft: draft => this.draft.set(draft),
    lineFrom: () => this.lineFrom(),
    setLineFrom: id => this.lineFrom.set(id),
    lineAdded: () => setTimeout(() => (document.querySelector('.line-label') as HTMLInputElement | null)?.focus(), 0),
    shapeDone: () => this.tool.set('select'),
    notice: line => this.notice.show([line]),
  };

  constructor() {
    void this.tray.load();
    // While this page is open, a snapshot on the tray can be put on the board with its +
    this.tray.placer.set(snap => this.placeSnap(snap));

    // The board named in the address opens; with none, the last one opened here, or the first, or a new one
    effect(() => {
      const id = this.wanted();
      untracked(() => void this.openWanted(id));
    });

    // A saved board moves up the History list with its new count
    effect(() => {
      const state = this.board.save();
      const id = this.board.boardId();
      if (state === 'saved' && id != null) untracked(() => this.boards.touched(id, this.board.doc().items.length));
    });

    // Fonts used on the board are loaded once, so a note in Caveat shows in Caveat after a reload
    effect(() => {
      for (const item of this.board.doc().items) {
        if (item.type !== 'note' && item.type !== 'text') continue;
        for (const block of item.blocks) for (const run of block.runs) if (run.font) ensureFont(run.font);
      }
    });

    // Files dragged over the page: the browser must never open a dropped file, wherever it lands
    let depth = 0;
    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event)) { depth++; if (this.fileOver() === 'none') this.fileOver.set('page'); } };
    const onDragLeave = (event: DragEvent) => { if (hasFiles(event) && --depth <= 0) { depth = 0; this.fileOver.set('none'); } };
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const onDrop = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); depth = 0; this.fileOver.set('none'); };
    const onPaste = (event: ClipboardEvent) => this.onPaste(event);
    const onKeyDown = (event: KeyboardEvent) => this.boardKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') this.spaceDown.set(false); };
    const listen: [string, EventListener][] = [
      ['dragenter', onDragEnter as EventListener], ['dragleave', onDragLeave as EventListener], ['dragover', onDragOver as EventListener],
      ['drop', onDrop as EventListener], ['paste', onPaste as EventListener], ['keydown', onKeyDown as EventListener], ['keyup', onKeyUp as EventListener],
    ];
    for (const [name, fn] of listen) document.addEventListener(name, fn);
    // Closing the tab or reloading while a change or an upload is on its way: the browser asks first
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!this.board.hasUnsaved() && !this.files.uploading) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);

    const off = this.shortcuts.register('scratchpad', {
      'sp.select': () => this.setTool('select'),
      'sp.hand': () => this.setTool('hand'),
      'sp.line': () => this.setTool('line'),
      'sp.pen': () => this.setTool('pen'),
      'sp.marker': () => this.setTool('marker'),
      'sp.rect': () => this.setTool('rect'),
      'sp.sticky': () => this.board.place('note', 'auto', {}),
      'sp.text': () => this.board.place('text', 'auto', {}),
      'sp.undo': () => this.undo(),
      'sp.redo': () => this.redo(),
      'sp.zoom100': () => this.zoomTo(1),
      'sp.fit': () => this.fit(),
      'sp.zoomSel': () => this.zoomToSelection(),
      'sp.clear': () => this.escape(),
      'sp.group': () => this.board.groupSelection(''),
      'sp.ungroup': () => this.board.ungroupSelected(),
      'sp.duplicate': () => this.duplicate(),
      'sp.selectAll': () => this.board.selectAll(),
      'sp.back': () => this.order('back'),
      'sp.front': () => this.order('front'),
    });

    let wheelNode: HTMLElement | null = null;
    const onWheel = (event: WheelEvent) => this.boardWheel(event);
    afterNextRender(() => {
      wheelNode = this.canvas()?.nativeElement ?? null;
      // Added by hand and not passive, so Ctrl + scroll zooms the board and never the browser
      wheelNode?.addEventListener('wheel', onWheel, { passive: false });
    });

    this.destroy.onDestroy(() => {
      off();
      for (const [name, fn] of listen) document.removeEventListener(name, fn);
      window.removeEventListener('beforeunload', onLeave);
      wheelNode?.removeEventListener('wheel', onWheel);
      this.gesture?.cancel();
      this.tray.placer.set(null);
      // The board is let go at once, and whatever is waiting is saved in the background
      this.board.leave();
    });
  }

  // ---- which board ----

  private async openWanted(id: number | null): Promise<void> {
    if (id != null && id === this.board.boardId() && this.board.status() !== 'error') return;
    if (id == null) {
      const start = await this.boards.startingBoard();
      if (start == null) { this.noBoards.set(true); return; }
      this.noBoards.set(false);
      void this.router.navigate([], { queryParams: { board: start }, queryParamsHandling: 'merge', replaceUrl: true });
      return;
    }
    // Leaving a board sends what is waiting first. If it can't be saved, it stays open and says so.
    if (this.board.boardId() != null && this.board.boardId() !== id && this.board.status() === 'ready') {
      const saved = await this.board.close();
      if (!saved) {
        this.notice.show(["This board couldn't be saved, so it stays open. Try again before opening another."]);
        void this.router.navigate([], { queryParams: { board: this.board.boardId() }, queryParamsHandling: 'merge', replaceUrl: true });
        return;
      }
    }
    this.gesture?.cancel();
    this.gesture = null;
    this.lineFrom.set(null);
    if (await this.board.open(id)) {
      this.boards.remember(id);
      void this.refreshCards();
    }
  }

  // From the History tab: open this board on the Board tab
  openBoard(id: number): void {
    void this.router.navigate([], { queryParams: { board: id, tab: null }, queryParamsHandling: 'merge' });
  }

  showTab(tab: 'board' | 'history'): void {
    void this.router.navigate([], { queryParams: { tab: tab === 'history' ? 'history' : null }, queryParamsHandling: 'merge' });
  }

  retryOpen(): void {
    this.noBoards.set(false);
    const id = this.wanted();
    if (id != null) void this.board.open(id).then(ok => { if (ok) void this.refreshCards(); });
    else void this.openWanted(null);
  }

  async keepMine(): Promise<void> {
    const id = await this.board.keepMineAsNewBoard();
    if (typeof id === 'string') { this.notice.show([/[.!?]$/.test(id) ? id : id + '.']); return; }
    void this.boards.load();
    void this.router.navigate([], { queryParams: { board: id }, queryParamsHandling: 'merge', replaceUrl: true });
    this.notice.show(['Your changes are kept as a new board, "' + this.board.boardName() + '". The other one is as it was saved elsewhere.']);
  }

  // Cards show what the table says now. Only the companies on the board are asked for, never the table.
  private async refreshCards(): Promise<void> {
    const ids = [...this.board.industryIds()];
    if (ids.length === 0) return;
    try {
      this.board.refreshCards(await firstValueFrom(this.api.industriesByIds(ids)));
    } catch {
      // The cards keep what they showed last time
    }
  }

  // ---- tools and edit keys ----

  setTool(tool: BoardTool): void {
    this.gesture?.cancel();
    this.gesture = null;
    this.lineFrom.set(null);
    this.tool.set(tool);
  }

  undo(): void { this.tray.follow(this.board.undo()); }
  redo(): void { this.tray.follow(this.board.redo()); }

  duplicate(): void {
    const ids = this.board.pickedIds();
    if (ids.length === 0) return;
    const idFor = this.board.duplicate(ids, { x: 24, y: 24 });
    // Refused (the board can't hold more drawing): what was picked stays picked
    if (idFor.size) this.board.setSelection([...idFor.values()]);
  }

  order(to: 'back' | 'front'): void {
    const ids = this.board.pickedIds();
    if (ids.length) this.board.apply({ op: 'order', ids, to });
  }

  private escape(): void {
    if (this.gesture) { this.gesture.cancel(); this.gesture = null; return; }
    this.lineFrom.set(null);
    this.fontsOpen.set(false);
    if (this.tool() !== 'select') this.tool.set('select');
    else this.board.clearSelection();
  }

  // Space (pan), Delete (remove) and the arrows (nudge) are kept for the browser by the shortcuts panel, so the
  // board takes care of those itself, and only when the person is not typing
  private boardKeyDown(event: KeyboardEvent): void {
    if (this.tab() !== 'board' || isEditable(event.target) || this.shortcuts.panelOpen()) return;
    if (event.code === 'Space') {
      this.spaceDown.set(true);
      event.preventDefault();
      return;
    }
    const target = event.target as Element | null;
    const focusedLine = target?.getAttribute?.('data-line');
    if (focusedLine && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.board.pickLine(focusedLine);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (focusedLine && !this.board.selectedLineId()) this.board.pickLine(focusedLine);
      if (this.board.selectedIds().length || this.board.selectedGroupId() || this.board.selectedLineId()) {
        event.preventDefault();
        this.board.removeSelection();
      }
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = arrows[event.key];
    if (step && !event.ctrlKey && !event.metaKey && !event.altKey && this.board.pickedIds().length) {
      event.preventDefault();
      const by = event.shiftKey ? 10 : 1;
      this.board.nudge(step[0] * by, step[1] * by);
    }
  }

  // ---- pointers: the tool in hand does the work, see board/tools.ts ----

  private ctx(event: PointerEvent): PointerCtx | null {
    const rect = this.canvas()?.nativeElement.getBoundingClientRect();
    if (!rect) return null;
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      world: worldFromScreen(screen, this.board.view()),
      hit: hitTest(event.target),
      button: event.button,
      adding: modHeld(this.shortcuts.mouseMod('mouse.add'), event),
      duplicating: modHeld(this.shortcuts.mouseMod('mouse.dup'), event),
    };
  }

  onPointerDown(event: PointerEvent): void {
    if (this.board.status() !== 'ready' || event.button === 2) return;
    const c = this.ctx(event);
    if (!c) return;
    this.gesture?.cancel();
    // A press anywhere but in words leaves the note or box being typed in, so the next key is a tool key again
    if (c.hit.kind !== 'editable' && isEditable(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const panning = this.spaceDown() || event.button === 1;
    this.gesture = panning ? panGesture(c, this.ui) : TOOLS[this.tool()].down(c, this.board, this.ui);
    if (!this.gesture) return;
    // Drawing on the board, not selecting the page's text
    if (c.hit.kind !== 'editable') event.preventDefault();
    this.canvas()?.nativeElement.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.gesture) return;
    const c = this.ctx(event);
    if (c) this.gesture.move(c);
  }

  onPointerUp(event: PointerEvent, lost = false): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    try {
      this.canvas()?.nativeElement.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone
    }
    const c = this.ctx(event);
    if (lost || !c) gesture.cancel(); else gesture.up(c);
  }

  // ---- the view ----

  private screenSize(): { w: number; h: number } | null {
    const rect = this.canvas()?.nativeElement.getBoundingClientRect();
    return rect ? { w: rect.width, h: rect.height } : null;
  }

  private boardWheel(event: WheelEvent): void {
    const rect = this.canvas()?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const view = this.board.view();
    // The panel's Zoom row picks the held key. A trackpad pinch always arrives as Ctrl + scroll, so it zooms either way.
    if (modHeld(this.shortcuts.mouseMod('mouse.zoom'), event) || event.ctrlKey) {
      this.board.setView(zoomAround(view, view.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
    } else {
      this.board.setView({ x: view.x - event.deltaX, y: view.y - event.deltaY, zoom: view.zoom });
    }
  }

  zoomTo(zoom: number): void {
    const size = this.screenSize();
    if (size) this.board.setView(zoomAround(this.board.view(), clampZoom(zoom), { x: size.w / 2, y: size.h / 2 }));
  }

  zoomIn(): void { this.zoomTo(this.board.view().zoom * 1.25); }
  zoomOut(): void { this.zoomTo(this.board.view().zoom * 0.8); }

  fit(): void {
    const size = this.screenSize();
    const box = bounds(this.board.doc().items);
    if (!size) return;
    if (!box) { this.board.setView({ x: 0, y: 0, zoom: 1 }); return; }
    this.board.setView(viewOnto(box, size, 1, 60));
  }

  zoomToSelection(): void {
    const size = this.screenSize();
    const box = bounds(this.board.selection());
    if (!size) return;
    if (!box) { this.zoomTo(1); return; }
    this.board.setView(viewOnto(box, size, 0.65));
  }

  // ---- dropping and pasting ----

  private worldAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas()?.nativeElement.getBoundingClientRect();
    return rect ? worldFromScreen({ x: clientX - rect.left, y: clientY - rect.top }, this.board.view()) : null;
  }

  onCanvasDragOver(event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes('Files') && !types.includes(INDUSTRY_DRAG) && !types.includes(SNAP_DRAG)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (types.includes('Files')) this.fileOver.set('board');
  }

  onCanvasDragLeave(event: DragEvent): void {
    const node = this.canvas()?.nativeElement;
    if (this.fileOver() === 'board' && (!event.relatedTarget || !node?.contains(event.relatedTarget as Node))) this.fileOver.set('page');
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    this.fileOver.set('none');
    if (this.board.status() !== 'ready') return;
    const at = this.worldAt(event.clientX, event.clientY) ?? undefined;
    const snapId = event.dataTransfer?.getData(SNAP_DRAG);
    if (snapId) {
      const snap = this.tray.items().find(one => one.id === snapId);
      if (snap) this.placeSnap(snap, at);
      return;
    }
    const company = event.dataTransfer?.getData(INDUSTRY_DRAG);
    if (company) {
      try {
        placeIndustry(this.board, JSON.parse(company) as RailRow, at ? { center: at } : 'auto');
      } catch {
        // Not something this page put there
      }
      return;
    }
    this.files.add(Array.from(event.dataTransfer?.files ?? []), at);
  }

  // Off the tray and onto the board, as a frozen card. Undo puts it back in the tray.
  placeSnap(snap: Snapshot, center?: { x: number; y: number }): void {
    if (this.board.status() !== 'ready') return;
    if (this.tab() !== 'board') this.showTab('board');
    // A full board refuses it, and then it stays in the tray
    if (this.board.place('snap', center ? { center } : 'auto', { snap }) == null) return;
    this.tray.placed(this.board.lastStep(), snap);
  }

  onButtonDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.fileOver.set('button');
  }

  onButtonDragLeave(): void {
    if (this.fileOver() === 'button') this.fileOver.set('page');
  }

  onButtonDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.fileOver.set('none');
    this.files.add(Array.from(event.dataTransfer?.files ?? []));
  }

  onPick(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.files.add(files);
  }

  // Ctrl+V with a picture on the clipboard puts it on the board. Pasting into a note or a box stays theirs.
  private onPaste(event: ClipboardEvent): void {
    if (isEditable(event.target) || this.tab() !== 'board') return;
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    this.files.add(files.map(file => new File([file], nameForPasted(file), { type: file.type })));
  }

  fileButtonLabel = computed(() => {
    const over = this.fileOver();
    return over === 'button' ? 'Release to add it' : over === 'none' ? '+ File or image' : 'Drop files here';
  });

  // ---- paper colours and the TEXT bar ----

  protected readonly tones: { key: NoteTone; label: string }[] = [
    { key: 'white', label: 'White' }, { key: 'gray', label: 'Grey' }, { key: 'ink', label: 'Ink' }, { key: 'amber', label: 'Orange' },
  ];

  allTone(items: BoardItem[], tone: NoteTone): boolean {
    return items.length > 0 && items.every(item => ('tone' in item ? item.tone : 'white') === tone);
  }

  setTone(items: BoardItem[], tone: NoteTone): void {
    this.board.apply({ op: 'patch', ids: items.map(item => item.id), patch: { tone } });
  }

  setAlign(align: TextAlign): void {
    const one = this.pickedPaper();
    if (!one) return;
    this.board.apply({ op: 'patch', ids: [one.id], patch: { align } });
    this.board.external.update(n => n + 1);
  }

  // Bold or highlight every word of the note. On when any part is off, so a mixed note turns all on first.
  toggleWhole(style: 'bold' | 'highlight'): void {
    const one = this.pickedPaper();
    const runs = one?.blocks.flatMap(block => block.runs).filter(run => run.text.length > 0) ?? [];
    if (!one || runs.length === 0) return;
    const on = !runs.every(run => run[style]);
    this.restyle(one, run => ({ ...run, [style]: on || undefined }));
  }

  toggleFonts(): void {
    if (!this.fontsOpen()) ensureFonts();
    this.fontsOpen.update(open => !open);
  }

  pickFont(font: string): void {
    const one = this.pickedPaper();
    if (!one) return;
    ensureFont(font);
    this.restyle(one, run => ({ ...run, font: font === 'Inter' ? undefined : font }));
  }

  private restyle(one: PaperItem, change: (run: PaperItem['blocks'][number]['runs'][number]) => PaperItem['blocks'][number]['runs'][number]): void {
    this.board.apply({
      op: 'patch', ids: [one.id],
      patch: item => (item.type === 'note' || item.type === 'text'
        ? { ...item, blocks: item.blocks.map(block => ({ ...block, runs: block.runs.map(change) })) } : item),
    });
    this.board.external.update(n => n + 1);
  }

  // ---- lines and groups ----

  private nameOf(item: BoardItem): string {
    if (item.type === 'industry' || item.type === 'file') return item.name;
    if (item.type === 'snap') return item.snap.title;
    return KINDS[item.type].label.toLowerCase();
  }

  // Typing a label or a group name is one undo step from the first letter to leaving the box
  private nameTx: ReturnType<BoardEngine['begin']> | null = null;

  onLabelInput(id: string, value: string): void {
    if (!this.nameTx?.open) this.nameTx = this.board.begin();
    this.nameTx.apply({ op: 'patchLine', id, patch: { label: value.slice(0, 200) } });
  }

  onGroupNameInput(groupId: string, value: string): void {
    if (!this.nameTx?.open) this.nameTx = this.board.begin();
    this.nameTx.apply({ op: 'renameGroup', groupId, name: value.slice(0, 60) });
  }

  onNameDone(): void {
    this.nameTx?.commit();
    this.nameTx = null;
    this.editingLineId.set(null);
  }

  editLineLabel(id: string): void {
    this.board.pickLine(id);
    this.editingLineId.set(id);
    setTimeout(() => {
      const input = document.querySelector('.line-pill.edit') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  // The bar above the board narrows the one picked thing with these
  asFile(item: BoardItem): FileItem | null { return item.type === 'file' ? item : null; }
  tone(item: BoardItem): NoteTone | null { return 'tone' in item ? item.tone : null; }
  kindLabel(item: BoardItem): string { return KINDS[item.type].label; }
}
