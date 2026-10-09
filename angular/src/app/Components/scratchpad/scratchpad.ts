import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription, firstValueFrom } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BoardItem, Industry, NoteTone, Snapshot, TextAlign } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';
import { Shortcuts, modHeld } from '../../services/shortcuts';
import { ITEM_SIZE, Scratchpad, clampZoom, curveControl, isImage, quadPoint } from '../../services/scratchpad';
import { NoteEditor } from './note-editor';
import { MAX_FILE_MB, nameForPasted, refusalFor, sizeText, typeLabel } from './board-files';
import { FONT_GROUPS, ensureFont, ensureFonts, fontCss } from './rich-text';

// A file's upload while the page is open. Gone after a reload: a card whose upload never finished says so.
interface Upload { pct: number; failed: boolean; }

// A company dragged from the rail onto the board, and a snapshot dragged off the carry tray
const INDUSTRY_DRAG = 'application/x-scratchpad-industry';
const SNAP_DRAG = 'application/x-scratchpad-snap';

// The endless board. Pan and zoom, industry cards, sticky notes and text boxes, several things picked at
// once, groups, lines that stay glued, undo and redo, and the whole thing saved per person on its own.
// See OVERVIEW_HANDOFF.md for the feel this must keep.

interface Drag {
  mode: 'item' | 'pan' | 'box' | 'group';
  startX: number;
  startY: number;
  origins: { id: string; x: number; y: number }[];
  viewX: number;
  viewY: number;
}

interface Box { x0: number; y0: number; x1: number; y1: number; }

@Component({
  selector: 'app-scratchpad',
  imports: [NoteEditor, NgTemplateOutlet, RouterLink],
  templateUrl: './scratchpad.html',
  styleUrl: './scratchpad.css',
})
export class ScratchpadPage {
  protected pad = inject(Scratchpad);
  // The template draws the picking box, and a template cannot reach Math on its own
  protected readonly Math = Math;
  private api = inject(IndustryApi);
  protected shortcuts = inject(Shortcuts);
  private destroy = inject(DestroyRef);

  private canvas = viewChild<ElementRef<HTMLElement>>('canvas');

  search = signal('');
  spaceDown = signal(false);
  box = signal<Box | null>(null);
  lineFrom = signal<string | null>(null);

  private drag: Drag | null = null;

  // The rail never loads the table. With no search it shows the 3 most expensive rows, and says so;
  // typing swaps them for up to 10 name matches. See OVERVIEW_HANDOFF.md, "the companies rail".
  static readonly TOP = 3;
  static readonly MATCHES = 10;
  matches = signal<Industry[]>([]);
  railLoading = signal(true);
  railError = signal(false);
  railHelper = computed(() => (this.search().trim() ? 'Drag one onto the board, or press +.' : 'Most expensive first. Search for any other.'));
  private railTimer: ReturnType<typeof setTimeout> | null = null;
  private railCall: Subscription | null = null;

  // Files: the upload of each card while it runs, the pictures fetched for showing, and the refusal toast
  uploads = signal<Record<string, Upload>>({});
  private pendingFiles = new Map<string, File>();
  previews = signal<Record<number, string>>({});
  private previewAsked = new Set<number>();
  notice = signal<string[]>([]);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  // Where a file being dragged is: anywhere on the page, over the + File or image field, or over the board
  fileOver = signal<'none' | 'page' | 'button' | 'board'>('none');
  readonly maxFileMb = MAX_FILE_MB;
  protected readonly typeLabel = typeLabel;
  protected readonly sizeText = sizeText;
  protected readonly isImage = isImage;

  // The TEXT bar's font list, the same fonts the note's own bar offers
  fontsOpen = signal(false);
  protected readonly fontGroups = FONT_GROUPS;
  protected readonly fontCss = fontCss;

  pickedCount = computed(() => this.pad.selectedIds().length);
  // What the tool in hand does, in the same spot on the toolbar so it never jumps around
  toolHint = computed(() => {
    if (this.spaceDown() || this.pad.tool() === 'hand') return 'Drag to move around the board. Scrolling also moves it, Ctrl + scroll zooms.';
    if (this.pad.tool() === 'line') return this.lineFrom() ? 'Now click the item to join it to.' : 'Click an item, then another. The line follows when either moves.';
    return 'Drag a box on empty space to select several things. ' + this.shortcuts.mouseMod('mouse.add') + ' + click adds one.';
  });
  // The one thing picked, which decides the bar: COMPANY, FILE or TEXT
  picked = computed(() => this.pad.selectedOne());
  pickedFont = computed(() => this.picked()?.blocks?.flatMap(block => block.runs).find(run => run.text)?.font ?? 'Inter');
  pickedStyle = computed(() => {
    const runs = this.picked()?.blocks?.flatMap(block => block.runs).filter(run => run.text) ?? [];
    return { bold: runs.length > 0 && runs.every(run => run.bold), highlight: runs.length > 0 && runs.every(run => run.highlight) };
  });

  layerTransform = computed(() => {
    const view = this.pad.board().view;
    return 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
  });

  zoomPercent = computed(() => Math.round(this.pad.board().view.zoom * 100));

  pickedTones = computed(() => this.pad.selection().filter(item => item.type === 'note'));

  selectedGroupName = computed(() => {
    const id = this.pad.selectedGroupId();
    if (!id) return '';
    return this.pad.groups().find(group => group.id === id)?.name ?? '';
  });

  // The outline of a group, drawn from the real boxes of its members so it grows and shrinks with them
  groupBoxes = computed(() => {
    const byId = new Map(this.pad.board().items.map(item => [item.id, item]));
    const out: { id: string; name: string; x: number; y: number; w: number; h: number }[] = [];
    for (const group of this.pad.groups()) {
      const members = group.itemIds.map(id => byId.get(id)).filter((item): item is BoardItem => !!item);
      if (members.length === 0) continue;
      const x = Math.min(...members.map(item => item.x)) - 18;
      const y = Math.min(...members.map(item => item.y)) - 18;
      const right = Math.max(...members.map(item => item.x + item.w)) + 18;
      const bottom = Math.max(...members.map(item => item.y + item.h)) + 18;
      out.push({ id: group.id, name: group.name, x, y, w: right - x, h: bottom - y });
    }
    return out;
  });

  // Lines meet the real edge of each card and follow it whenever it moves. A bend bows the middle.
  lineShapes = computed(() => {
    const byId = new Map(this.pad.board().items.map(item => [item.id, item]));
    const out: { id: string; d: string; head: 'none' | 'end' | 'both'; label: string; pill: { x: number; y: number } }[] = [];
    for (const line of this.pad.lines()) {
      const from = byId.get(line.from);
      const to = byId.get(line.to);
      if (!from || !to) continue;
      const start = this.edgePoint(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 });
      const end = this.edgePoint(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
      if (line.bend === 0) {
        out.push({
          id: line.id, head: line.head, label: line.label,
          d: 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y,
          pill: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        });
      } else {
        const control = curveControl(start, end, line.bend);
        out.push({
          id: line.id, head: line.head, label: line.label,
          d: 'M ' + start.x + ' ' + start.y + ' Q ' + control.x + ' ' + control.y + ' ' + end.x + ' ' + end.y,
          pill: quadPoint(start, control, end, 0.5),
        });
      }
    }
    return out;
  });

  selectedLine = computed(() => this.pad.lines().find(line => line.id === this.pad.selectedLineId()) ?? null);
  editingLineId = signal<string | null>(null);

  constructor() {
    void this.pad.load().then(() => this.refreshCards());
    // The periodic save lives with the page, not the service, so closing the page stops it
    this.pad.startAutoSave();
    this.loadRail();

    // A picture card shows its preview, fetched once with the sign in, since an <img> can't send it
    effect(() => {
      for (const item of this.pad.board().items) {
        if (item.type === 'file' && item.fileId != null && isImage(item.contentType)) this.askPreview(item.fileId);
      }
    });
    // Fonts used on the board are loaded once, so a note in Caveat shows in Caveat after a reload
    effect(() => {
      for (const item of this.pad.board().items) for (const block of item.blocks ?? []) for (const run of block.runs) if (run.font) ensureFont(run.font);
    });

    // Files dragged over the page: the browser must never open a dropped file, wherever it lands
    let depth = 0;
    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event)) { depth++; if (this.fileOver() === 'none') this.fileOver.set('page'); } };
    const onDragLeave = (event: DragEvent) => { if (hasFiles(event) && --depth <= 0) { depth = 0; this.fileOver.set('none'); } };
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const onDrop = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); depth = 0; this.fileOver.set('none'); };
    const onPaste = (event: ClipboardEvent) => this.onPaste(event);
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    this.destroy.onDestroy(() => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
      for (const url of Object.values(this.previews())) URL.revokeObjectURL(url);
      if (this.noticeTimer) clearTimeout(this.noticeTimer);
      if (this.railTimer) clearTimeout(this.railTimer);
      this.railCall?.unsubscribe();
    });

    const off = this.shortcuts.register('scratchpad', {
      'sp.select': () => this.pad.tool.set('select'),
      'sp.hand': () => this.pad.tool.set('hand'),
      'sp.line': () => this.pad.tool.set('line'),
      'sp.sticky': () => this.pad.addPaper('note'),
      'sp.text': () => this.pad.addPaper('text'),
      'sp.undo': () => this.pad.undo(),
      'sp.redo': () => this.pad.redo(),
      'sp.zoom100': () => this.zoomTo(1),
      'sp.fit': () => this.fit(),
      'sp.zoomSel': () => this.zoomToSelection(),
      'sp.clear': () => this.pad.clearSelection(),
    }, {
      'sp.select': 'Select tool',
      'sp.hand': 'Hand tool',
      'sp.line': 'Line tool',
      'sp.sticky': 'New sticky note',
      'sp.text': 'New text box',
      'sp.undo': 'Undo',
      'sp.redo': 'Redo',
      'sp.zoom100': 'Zoom to 100%',
      'sp.fit': 'Fit everything on screen',
      'sp.zoomSel': 'Zoom to the selection',
      'sp.clear': 'Clear the selection',
    });

    // Space (pan) and Delete (remove) are kept for the browser by the shortcuts panel, so the board
    // takes care of those two itself, and only when the person is not typing.
    const onKeyDown = (event: KeyboardEvent) => this.boardKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') this.spaceDown.set(false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    let wheelNode: HTMLElement | null = null;
    const onWheel = (event: WheelEvent) => this.boardWheel(event);
    afterNextRender(() => {
      wheelNode = this.canvas()?.nativeElement ?? null;
      // Added by hand and not passive, so Ctrl + scroll zooms the board and never the browser
      wheelNode?.addEventListener('wheel', onWheel, { passive: false });
    });

    this.destroy.onDestroy(() => {
      this.pad.stopAutoSave();
      off();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      wheelNode?.removeEventListener('wheel', onWheel);
    });
  }

  reload(): void {
    void this.pad.load().then(() => this.refreshCards());
    this.loadRail();
  }

  // Cards show what the table says now. Only the companies on the board are asked for, never the table.
  private async refreshCards(): Promise<void> {
    const ids = [...this.pad.industryIds()].filter((id): id is number => typeof id === 'number');
    if (ids.length === 0) return;
    try {
      this.pad.refreshCards(await firstValueFrom(this.api.industriesByIds(ids)));
    } catch {
      // The cards keep what they showed last time
    }
  }

  onSearch(value: string): void {
    this.search.set(value);
    if (this.railTimer) clearTimeout(this.railTimer);
    // A short pause, so a typed word is one request rather than one per letter
    this.railTimer = setTimeout(() => this.loadRail(), 250);
  }

  loadRail(): void {
    const query = this.search().trim();
    this.railCall?.unsubscribe();
    this.railLoading.set(true);
    const call = query ? this.api.searchIndustries(query, ScratchpadPage.MATCHES) : this.api.topIndustries(ScratchpadPage.TOP);
    this.railCall = call.subscribe({
      next: rows => { this.matches.set(rows); this.railLoading.set(false); this.railError.set(false); },
      error: () => { this.matches.set([]); this.railLoading.set(false); this.railError.set(true); },
    });
  }

  // A card added from the top list carries its place in that list (#1..#3). One added from a search has no rank.
  private rankOf(row: Industry): number | null {
    if (this.search().trim()) return null;
    const at = this.matches().findIndex(one => one.id === row.id);
    return at >= 0 ? at + 1 : null;
  }

  onBoard(row: Industry): boolean {
    return this.pad.industryIds().has(row.id);
  }

  onRailDragStart(event: DragEvent, row: Industry): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(INDUSTRY_DRAG, JSON.stringify({ ...row, rank: this.rankOf(row) }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  // ---- files and pictures ----

  // The world point under a screen point, so a drop lands where the person let go
  private worldAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.rect();
    if (!rect) return null;
    const view = this.pad.board().view;
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
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
    const at = this.worldAt(event.clientX, event.clientY) ?? undefined;
    const snapId = event.dataTransfer?.getData(SNAP_DRAG);
    if (snapId) { this.pad.placeSnap(snapId, at); return; }
    const company = event.dataTransfer?.getData(INDUSTRY_DRAG);
    if (company) {
      try {
        const row = JSON.parse(company) as Industry & { rank: number | null };
        if (!this.pad.industryIds().has(row.id)) {
          const size = { w: 236, h: 92 };
          this.pad.addIndustry(row, at ? { x: at.x - size.w / 2, y: at.y - size.h / 2 } : undefined);
        }
      } catch {
        // Not something this page put there
      }
      return;
    }
    this.addFiles(Array.from(event.dataTransfer?.files ?? []), at);
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
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onPick(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.addFiles(files);
  }

  // Ctrl+V with a picture on the clipboard puts it on the board. Pasting into a note or a box stays theirs.
  private onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    this.addFiles(files.map(file => new File([file], nameForPasted(file), { type: file.type })));
  }

  // Each file is checked, then goes on the board at once and uploads in the background. Several dropped
  // together land side by side from the drop point.
  addFiles(files: File[], at?: { x: number; y: number }): void {
    const refused: string[] = [];
    // The first lands centred on the drop point, the rest in a row to its right, never on top of each other
    let left: number | null = null;
    for (const file of files) {
      const why = refusalFor(file);
      if (why) { refused.push(why); continue; }
      const contentType = file.type || 'application/octet-stream';
      const width = isImage(contentType) ? ITEM_SIZE.image.w : ITEM_SIZE.file.w;
      // addFile centres the card on the point it is given
      if (at && left === null) left = at.x - width / 2;
      const spot = at && left !== null ? { x: left + width / 2, y: at.y } : undefined;
      if (left !== null) left += width + 24;
      const id = this.pad.addFile({ name: file.name, contentType, sizeBytes: file.size }, spot);
      this.upload(id, file);
    }
    if (refused.length) this.showNotice(refused);
  }

  private upload(itemId: string, file: File): void {
    this.pendingFiles.set(itemId, file);
    this.setUpload(itemId, { pct: 0, failed: false });
    this.api.uploadScratchFile(file).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.setUpload(itemId, { pct: Math.round((event.loaded / event.total) * 100), failed: false });
        } else if (event.type === HttpEventType.Response && event.body) {
          this.pad.fileStored(itemId, event.body);
          this.pendingFiles.delete(itemId);
          this.setUpload(itemId, null);
        }
      },
      error: (err: HttpErrorResponse) => {
        // A refusal from the API (it checks again) is said in the toast; anything else waits on the card for Try again
        if (err.status === 400 || err.status === 413) this.showNotice([errorText(err, "Couldn't upload " + file.name)]);
        this.setUpload(itemId, { pct: 0, failed: true });
      },
    });
  }

  retryUpload(itemId: string): void {
    const file = this.pendingFiles.get(itemId);
    if (file) this.upload(itemId, file);
  }

  private setUpload(itemId: string, state: Upload | null): void {
    this.uploads.update(all => {
      const next = { ...all };
      if (state) next[itemId] = state; else delete next[itemId];
      return next;
    });
  }

  // How a file card reads under its name: uploading, failed, never finished, or its size and type
  fileMeta(item: BoardItem): { text: string; bad: boolean } {
    const up = this.uploads()[item.id];
    if (up?.failed) return { text: "Couldn't upload", bad: true };
    if (up) return { text: 'Uploading ' + up.pct + '%', bad: false };
    if (item.fileId == null) return { text: "Couldn't upload. Remove it and add the file again", bad: true };
    return { text: typeLabel(item.name) + ', ' + sizeText(item.sizeBytes), bad: false };
  }

  canRetry(item: BoardItem): boolean {
    return !!this.uploads()[item.id]?.failed && this.pendingFiles.has(item.id);
  }

  private askPreview(fileId: number): void {
    if (this.previewAsked.has(fileId)) return;
    this.previewAsked.add(fileId);
    this.api.scratchFileBlob(fileId).subscribe({
      next: blob => this.previews.update(all => ({ ...all, [fileId]: URL.createObjectURL(blob) })),
      // No preview: the card falls back to the plain file look
      error: () => {},
    });
  }

  // Open a picture or a PDF in a new tab, anything else downloads with its own name
  openFile(item: BoardItem): void {
    if (item.fileId == null) return;
    this.api.scratchFileBlob(item.fileId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const shows = isImage(item.contentType) || item.contentType === 'application/pdf';
        if (shows) {
          window.open(url, '_blank', 'noopener');
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.download = item.name ?? 'file';
          link.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: (err: HttpErrorResponse) => this.showNotice([errorText(err, "Couldn't open " + (item.name ?? 'that file'))]),
    });
  }

  // The toast names exactly what was refused, can be closed, and goes on its own after 10 seconds
  showNotice(lines: string[]): void {
    this.notice.set(lines);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set([]), 10_000);
  }

  dismissNotice(): void {
    this.notice.set([]);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  fileButtonLabel = computed(() => {
    const over = this.fileOver();
    return over === 'button' ? 'Release to add it' : over === 'none' ? '+ File or image' : 'Drop files here';
  });

  // ---- the carry tray and snapshots ----

  onTrayDragStart(event: DragEvent, snap: Snapshot): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(SNAP_DRAG, snap.id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  // "7 Oct, 14:02", when it was carried
  snapWhen(iso: string | undefined): string {
    if (!iso) return '';
    const at = new Date(iso);
    return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // The circle as it was: the ink steps lighter slice by slice, the picked slice is the signal colour, the same
  // logic as the Overview's circle, so both read alike
  snapShade(snap: Snapshot, index: number): string {
    if (snap.pick && snap.numbers[index]?.label === snap.pick) return 'var(--signal)';
    const n = Math.max(snap.numbers.length, 1);
    const pct = Math.round(92 - (index * 70) / n);
    return `color-mix(in srgb, var(--text) ${pct}%, var(--surface))`;
  }

  snapCircle(snap: Snapshot): string {
    const total = snap.numbers.reduce((sum, one) => sum + (one.share ?? 0), 0);
    if (!total) return 'var(--track)';
    let from = 0;
    const parts = snap.numbers.map((one, i) => {
      const to = from + ((one.share ?? 0) / total) * 100;
      const part = `${this.snapShade(snap, i)} ${from}% ${to}%`;
      from = to;
      return part;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }

  // ---- paper colours, for one note or several ----

  protected readonly tones: { key: NoteTone; label: string }[] = [
    { key: 'white', label: 'White' }, { key: 'gray', label: 'Grey' }, { key: 'ink', label: 'Ink' }, { key: 'amber', label: 'Orange' },
  ];

  allTone(items: BoardItem[], tone: NoteTone): boolean {
    return items.length > 0 && items.every(item => (item.tone ?? 'white') === tone);
  }

  setTone(items: BoardItem[], tone: NoteTone): void {
    this.pad.setTone(items.map(item => item.id), tone);
  }

  // ---- the TEXT bar ----

  setAlign(align: TextAlign): void {
    const one = this.picked();
    if (one) this.pad.setAlign([one.id], align);
  }

  toggleWhole(style: 'bold' | 'highlight'): void {
    const one = this.picked();
    if (one) this.pad.toggleWhole(one.id, style);
  }

  toggleFonts(): void {
    if (!this.fontsOpen()) ensureFonts();
    this.fontsOpen.update(open => !open);
  }

  pickFont(font: string): void {
    const one = this.picked();
    if (!one) return;
    ensureFont(font);
    this.pad.setFontWhole(one.id, font);
  }

  private rect(): DOMRect | null {
    return this.canvas()?.nativeElement.getBoundingClientRect() ?? null;
  }

  private edgePoint(item: BoardItem, toward: { x: number; y: number }): { x: number; y: number } {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx === 0 ? Number.POSITIVE_INFINITY : (item.w / 2) / Math.abs(dx);
    const sy = dy === 0 ? Number.POSITIVE_INFINITY : (item.h / 2) / Math.abs(dy);
    const scale = Math.min(sx, sy);
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  private boardKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.code === 'Space' && !typing) {
      this.spaceDown.set(true);
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete' && !typing) {
      if (this.pad.selectedIds().length || this.pad.selectedGroupId() || this.pad.selectedLineId()) {
        event.preventDefault();
        this.pad.removeSelection();
      }
      return;
    }
    if (event.key === 'Escape') {
      this.lineFrom.set(null);
      this.fontsOpen.set(false);
    }
  }

  // The key the panel's Add to selection row holds, Shift unless the person changed it
  private adding(event: PointerEvent): boolean {
    return modHeld(this.shortcuts.mouseMod('mouse.add'), event);
  }

  private boardWheel(event: WheelEvent): void {
    const rect = this.rect();
    if (!rect) return;
    event.preventDefault();
    const view = this.pad.board().view;
    // The panel's Zoom row picks the held key. A trackpad pinch always arrives as Ctrl + scroll, so it zooms either way.
    if (modHeld(this.shortcuts.mouseMod('mouse.zoom'), event) || event.ctrlKey) {
      const zoom = clampZoom(view.zoom * Math.exp(-event.deltaY * 0.002));
      this.zoomAround(zoom, event.clientX - rect.left, event.clientY - rect.top);
    } else {
      this.pad.setView({ x: view.x - event.deltaX, y: view.y - event.deltaY, zoom: view.zoom });
    }
  }

  private zoomAround(zoom: number, px: number, py: number): void {
    const view = this.pad.board().view;
    const wx = (px - view.x) / view.zoom;
    const wy = (py - view.y) / view.zoom;
    this.pad.setView({ x: px - wx * zoom, y: py - wy * zoom, zoom: clampZoom(zoom) });
  }

  zoomTo(zoom: number): void {
    const rect = this.rect();
    if (rect) this.zoomAround(zoom, rect.width / 2, rect.height / 2);
  }

  fit(): void {
    const rect = this.rect();
    const items = this.pad.board().items;
    if (!rect || items.length === 0) {
      this.pad.setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...items.map(one => one.x));
    const minY = Math.min(...items.map(one => one.y));
    const maxX = Math.max(...items.map(one => one.x + one.w));
    const maxY = Math.max(...items.map(one => one.y + one.h));
    const pad = 60;
    const zoom = clampZoom(Math.min(
      (rect.width - pad * 2) / Math.max(maxX - minX, 1),
      (rect.height - pad * 2) / Math.max(maxY - minY, 1)));
    this.pad.setView({
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  }

  zoomToSelection(): void {
    const picked = this.pad.selection();
    const rect = this.rect();
    if (!rect) return;
    if (picked.length === 0) {
      this.zoomTo(1);
      return;
    }
    const minX = Math.min(...picked.map(one => one.x));
    const minY = Math.min(...picked.map(one => one.y));
    const maxX = Math.max(...picked.map(one => one.x + one.w));
    const maxY = Math.max(...picked.map(one => one.y + one.h));
    const zoom = clampZoom(Math.min((rect.width * 0.65) / Math.max(maxX - minX, 1), (rect.height * 0.65) / Math.max(maxY - minY, 1)));
    this.pad.setView({
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  }

  // One card per company. From the top list it carries its rank there, from a search none.
  addIndustry(row: Industry): void {
    if (this.onBoard(row)) return;
    this.pad.addIndustry({ id: row.id, name: row.name, sector: row.sector, price: row.price, rank: this.rankOf(row) });
  }

  rowPrice(row: Industry): string {
    if (row.price === null || row.price === undefined) return 'No price';
    return '$' + row.price.toFixed(3);
  }

  zoomIn(): void { this.zoomBy(1.25); }
  zoomOut(): void { this.zoomBy(0.8); }

  private zoomBy(factor: number): void {
    this.zoomTo(this.pad.board().view.zoom * factor);
  }

  addNote(): void { this.pad.addPaper('note'); }
  addText(): void { this.pad.addPaper('text'); }
  makeGroup(): void { this.pad.addGroup(''); }
  ungroupSelected(): void {
    const id = this.pad.selectedGroupId();
    if (id) this.pad.ungroup(id);
  }
  deleteSelected(): void { this.pad.removeSelection(); }

  priceLabel(item: BoardItem): string {
    if (item.price === null || item.price === undefined) return 'No price';
    return '$' + item.price.toFixed(3);
  }

  // ---- pointers ----

  onPointerDown(event: PointerEvent): void {
    const node = this.canvas()?.nativeElement;
    if (!node) return;
    const target = event.target as HTMLElement;
    const rect = node.getBoundingClientRect();

    if (this.spaceDown() || this.pad.tool() === 'hand' || event.button === 1) {
      node.setPointerCapture(event.pointerId);
      const view = this.pad.board().view;
      this.drag = { mode: 'pan', startX: event.clientX, startY: event.clientY, origins: [], viewX: view.x, viewY: view.y };
      return;
    }

    // A line is drawn by picking one thing, then another
    if (this.pad.tool() === 'line') {
      const holder = target.closest('[data-item]') as HTMLElement | null;
      const id = holder?.getAttribute('data-item') ?? null;
      if (!id) { this.lineFrom.set(null); return; }
      const from = this.lineFrom();
      if (!from) this.lineFrom.set(id);
      else {
        this.pad.addLine(from, id);
        this.lineFrom.set(null);
        // A new line is selected with its label box ready, so it can be named straight away
        setTimeout(() => (document.querySelector('.line-label') as HTMLInputElement | null)?.focus(), 0);
      }
      return;
    }

    const groupChip = target.closest('[data-group]') as HTMLElement | null;
    if (groupChip) {
      const id = groupChip.getAttribute('data-group') ?? '';
      this.pad.pickGroup(id);
      const origins = this.pad.membersOf(id).map(item => ({ id: item.id, x: item.x, y: item.y }));
      node.setPointerCapture(event.pointerId);
      this.pad.begin();
      this.drag = { mode: 'group', startX: event.clientX, startY: event.clientY, origins, viewX: 0, viewY: 0 };
      return;
    }

    const lineHit = target.closest('[data-line]') as HTMLElement | null;
    if (lineHit) {
      this.pad.pickLine(lineHit.getAttribute('data-line') ?? '');
      return;
    }

    const holder = target.closest('[data-item]') as HTMLElement | null;
    if (holder && !target.closest('textarea')) {
      const id = holder.getAttribute('data-item') ?? '';
      const item = this.pad.board().items.find(one => one.id === id);
      if (!item) return;
      if (this.adding(event)) { this.pad.togglePick(id); return; }
      if (!this.pad.isPicked(id)) this.pad.pick(id);
      const origins = this.pad.selection().map(one => ({ id: one.id, x: one.x, y: one.y }));
      node.setPointerCapture(event.pointerId);
      this.pad.begin();
      this.drag = { mode: 'item', startX: event.clientX, startY: event.clientY, origins, viewX: 0, viewY: 0 };
      return;
    }

    // Empty board: drag a box around what it touches. The box picks exactly what it touches.
    if (!this.adding(event)) this.pad.clearSelection();
    node.setPointerCapture(event.pointerId);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.box.set({ x0: x, y0: y, x1: x, y1: y });
    this.drag = { mode: 'box', startX: event.clientX, startY: event.clientY, origins: [], viewX: 0, viewY: 0 };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const rect = this.rect();
    if (!rect) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const zoom = this.pad.board().view.zoom;

    if (drag.mode === 'pan') {
      this.pad.setView({ x: drag.viewX + dx, y: drag.viewY + dy, zoom });
      return;
    }
    if (drag.mode === 'box') {
      this.box.update(current => current ? { ...current, x1: event.clientX - rect.left, y1: event.clientY - rect.top } : current);
      return;
    }
    this.pad.moveManyLive(drag.origins.map(one => ({ id: one.id, x: one.x + dx / zoom, y: one.y + dy / zoom })));
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    try {
      this.canvas()?.nativeElement.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone
    }
    if (drag.mode === 'item' || drag.mode === 'group') { this.pad.end(); return; }

    if (drag.mode === 'box') {
      const box = this.box();
      this.box.set(null);
      if (!box) return;
      const view = this.pad.board().view;
      const left = (Math.min(box.x0, box.x1) - view.x) / view.zoom;
      const top = (Math.min(box.y0, box.y1) - view.y) / view.zoom;
      const right = (Math.max(box.x0, box.x1) - view.x) / view.zoom;
      const bottom = (Math.max(box.y0, box.y1) - view.y) / view.zoom;
      const touched = this.pad.board().items
        .filter(item => item.x < right && item.x + item.w > left && item.y < bottom && item.y + item.h > top)
        .map(item => item.id);
      this.pad.setSelection(touched);
    }
  }

  // ---- the group name ----

  // ---- the line label ----

  onLineLabelFocus(): void { this.pad.begin(); }

  onLineLabelInput(id: string, value: string): void { this.pad.lineLabelLive(id, value); }

  onLineLabelBlur(): void {
    this.pad.end();
    this.editingLineId.set(null);
  }

  editLineLabel(id: string): void {
    this.pad.pickLine(id);
    this.editingLineId.set(id);
    setTimeout(() => {
      const input = document.querySelector('.line-pill.edit') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  onGroupNameFocus(): void { this.pad.begin(); }

  onGroupNameInput(id: string, value: string): void { this.pad.renameGroupLive(id, value); }

  onGroupNameBlur(): void { this.pad.end(); }
}
