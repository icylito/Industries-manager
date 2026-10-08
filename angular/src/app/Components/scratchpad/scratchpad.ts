import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BoardItem, Industry } from '../../models/industry';
import { IndustryApi } from '../../services/industry-api';
import { Shortcuts } from '../../services/shortcuts';
import { Scratchpad, clampZoom, curveControl, quadPoint } from '../../services/scratchpad';
import { NoteEditor } from './note-editor';

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
  imports: [NoteEditor],
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
  rows = signal<Industry[]>([]);
  box = signal<Box | null>(null);
  lineFrom = signal<string | null>(null);

  private drag: Drag | null = null;

  // Exactly three at a time. Anything else is found by searching, then added with its + button.
  matches = computed(() => {
    const query = this.search().trim().toLowerCase();
    const all = this.rows();
    const found = query ? all.filter(row => row.name.toLowerCase().includes(query)) : all;
    return found.slice(0, 3);
  });

  pickedCount = computed(() => this.pad.selectedIds().length);

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
    void this.pad.load();
    // The periodic save lives with the page, not the service, so closing the page stops it
    this.pad.startAutoSave();
    void this.loadRows();

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
    void this.pad.load();
    void this.loadRows();
  }

  private async loadRows(): Promise<void> {
    try {
      const rows = await firstValueFrom(this.api.getAll());
      this.rows.set(rows);
      this.pad.refreshCards(rows);
    } catch {
      this.rows.set([]);
    }
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
    if (event.key === 'Escape') this.lineFrom.set(null);
  }

  private boardWheel(event: WheelEvent): void {
    const rect = this.rect();
    if (!rect) return;
    event.preventDefault();
    const view = this.pad.board().view;
    if (event.ctrlKey || event.metaKey) {
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

  // No rank is shown on a card until the rail has a genuinely ranked list to add from (the user's call)
  addIndustry(row: Industry): void {
    this.pad.addIndustry({ id: row.id, name: row.name, sector: row.sector, price: row.price });
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
      if (event.shiftKey) { this.pad.togglePick(id); return; }
      if (!this.pad.isPicked(id)) this.pad.pick(id);
      const origins = this.pad.selection().map(one => ({ id: one.id, x: one.x, y: one.y }));
      node.setPointerCapture(event.pointerId);
      this.pad.begin();
      this.drag = { mode: 'item', startX: event.clientX, startY: event.clientY, origins, viewX: 0, viewY: 0 };
      return;
    }

    // Empty board: drag a box around what it touches. The box picks exactly what it touches.
    if (!event.shiftKey) this.pad.clearSelection();
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
