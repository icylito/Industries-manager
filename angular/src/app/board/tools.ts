import { BoardView } from '../models/board';
import type { BoardEngine, Tx } from './board-engine';
import { KINDS, newId } from './item-kinds';
import { Point, Rect, intersects, rectFrom, simplify, worldFromScreen } from './geometry';

// What the pointer does on the board, one small piece per tool. The page turns a pointer event into a PointerCtx
// and hands it to the tool in hand; everything after that (what is picked, what moves, what is drawn) is here,
// without the page, so it can be tested with plain objects. Each gesture is one undo step: it opens a Tx when it
// starts, commits when the pointer lets go, and cancels on Esc or a lost pointer.

export type BoardTool = 'select' | 'hand' | 'line' | 'pen' | 'marker' | 'rect';

// What is under the pointer
export type Hit =
  | { kind: 'item' | 'grip' | 'group' | 'line'; id: string }
  // Inside a note's words or a box: the browser places the caret and selects words, the board only picks the note
  | { kind: 'editable'; id: string | null }
  // A button, a link or a video's controls on the board, which handle the press themselves
  | { kind: 'control' }
  | { kind: 'empty' };

export interface PointerCtx {
  // Inside the canvas, in pixels from its top left corner
  screen: Point;
  // The same point in board units
  world: Point;
  hit: Hit;
  button: number;
  // The held keys of the Mouse rows in the Shortcuts panel: Add to selection, and Duplicate while dragging
  adding: boolean;
  duplicating: boolean;
}

// The few things a tool needs from the page: the camera, and what it draws while a gesture is under way
export interface ToolUi {
  view(): BoardView;
  setView(view: BoardView): void;
  // The box being dragged to pick things, in screen pixels
  setBox(box: Rect | null): void;
  // A stroke or box being drawn, in board units, before it becomes part of the board
  setDraft(draft: Draft | null): void;
  lineFrom(): string | null;
  setLineFrom(id: string | null): void;
  // A new line is picked with its label ready to type
  lineAdded(id: string): void;
  // A box is drawn: go back to Select, so the next press picks rather than draws again
  shapeDone(): void;
  // A plain line for the toast: a stroke at its length limit, or a board with as much drawing as it can hold
  notice(line: string): void;
}

export type Draft = { kind: 'stroke'; mode: 'pen' | 'marker'; points: number[] } | { kind: 'rect'; rect: Rect };

export interface Gesture {
  move(c: PointerCtx): void;
  up(c: PointerCtx): void;
  cancel(): void;
}

export interface Tool {
  down(c: PointerCtx, engine: BoardEngine, ui: ToolUi): Gesture | null;
}

// How wide each stroke is drawn, in board units. The marker is see-through and in the signal colour.
export const STROKE_WIDTH = { pen: 2.5, marker: 16 } as const;
const MAX_POINTS = 2000;
// The API's limit for drawing on one board (api_v2/Scratchpad/BoardRules.cs), checked here first so a board never
// stops saving because of one more stroke
export const MAX_BOARD_POINTS = 50_000;
// A press that moves less than this many pixels is a click, not a drag
const DRAG_START = 3;

export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable="true"]');
}

export function hitTest(target: EventTarget | null): Hit {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return { kind: 'empty' };
  const attr = (selector: string, name: string) => el.closest(selector)?.getAttribute(name) ?? null;
  const grip = attr('[data-grip]', 'data-grip');
  if (grip) return { kind: 'grip', id: grip };
  const group = attr('[data-group]', 'data-group');
  if (group) return { kind: 'group', id: group };
  const line = attr('[data-line]', 'data-line');
  if (line) return { kind: 'line', id: line };
  if (isEditable(el)) return { kind: 'editable', id: attr('[data-item]', 'data-item') };
  if (el.closest('button, a, video, [data-control]')) return { kind: 'control' };
  const item = attr('[data-item]', 'data-item');
  if (item) return { kind: 'item', id: item };
  return { kind: 'empty' };
}

// Space, the middle button or the Hand tool: drag the view around
export function panGesture(start: PointerCtx, ui: ToolUi): Gesture {
  const origin = ui.view();
  return {
    move: c => ui.setView({ x: origin.x + c.screen.x - start.screen.x, y: origin.y + c.screen.y - start.screen.y, zoom: origin.zoom }),
    up: () => {},
    cancel: () => ui.setView(origin),
  };
}

// Moves these things together. With duplicating, the first real move leaves the originals and moves copies.
function dragGesture(start: PointerCtx, ids: string[], engine: BoardEngine, ui: ToolUi): Gesture {
  const tx: Tx = engine.begin();
  let moving = ids;
  let origins = new Map(engine.doc().items.filter(item => ids.includes(item.id)).map(item => [item.id, { x: item.x, y: item.y }]));
  let started = false;
  return {
    move: c => {
      const dx = c.screen.x - start.screen.x;
      const dy = c.screen.y - start.screen.y;
      if (!started) {
        if (Math.hypot(dx, dy) < DRAG_START) return;
        started = true;
        if (start.duplicating) {
          const idFor = engine.duplicate(ids, { x: 0, y: 0 }, tx);
          moving = [...idFor.values()];
          origins = new Map([...idFor].map(([from, to]) => [to, origins.get(from)!]));
          engine.setSelection(moving);
        }
      }
      const zoom = ui.view().zoom;
      tx.apply({ op: 'move', positions: moving.map(id => ({ id, x: origins.get(id)!.x + dx / zoom, y: origins.get(id)!.y + dy / zoom })) });
    },
    up: () => tx.commit(),
    cancel: () => tx.cancel(),
  };
}

// The grip in the corner: bigger or smaller, never below the kind's smallest size
function resizeGesture(start: PointerCtx, id: string, engine: BoardEngine, ui: ToolUi): Gesture | null {
  const item = engine.doc().items.find(one => one.id === id);
  const min = item && KINDS[item.type].minSize;
  if (!item || !min) return null;
  const tx = engine.begin();
  const origin = { w: item.w, h: item.h };
  return {
    move: c => {
      const zoom = ui.view().zoom;
      const w = Math.max(min.w, origin.w + (c.screen.x - start.screen.x) / zoom);
      const h = Math.max(min.h, origin.h + (c.screen.y - start.screen.y) / zoom);
      tx.apply({ op: 'resize', id, w: Math.round(w), h: Math.round(h) });
    },
    up: () => tx.commit(),
    cancel: () => tx.cancel(),
  };
}

// A box dragged on empty space picks everything it touches, added to what was picked when adding
function boxGesture(start: PointerCtx, engine: BoardEngine, ui: ToolUi): Gesture {
  const kept = start.adding ? engine.selectedIds() : [];
  let box: Rect = { x: start.screen.x, y: start.screen.y, w: 0, h: 0 };
  ui.setBox(box);
  return {
    move: c => { box = rectFrom(start.screen, c.screen); ui.setBox(box); },
    up: () => {
      ui.setBox(null);
      if (box.w < DRAG_START && box.h < DRAG_START) return;
      const view = ui.view();
      const corner = worldFromScreen(box, view);
      const area = { x: corner.x, y: corner.y, w: box.w / view.zoom, h: box.h / view.zoom };
      const touched = engine.doc().items.filter(item => intersects(item, area)).map(item => item.id);
      engine.setSelection([...kept, ...touched]);
    },
    cancel: () => ui.setBox(null),
  };
}

const select: Tool = {
  down: (c, engine, ui) => {
    const hit = c.hit;
    switch (hit.kind) {
      case 'control':
        return null;
      case 'grip':
        return resizeGesture(c, hit.id, engine, ui);
      case 'group': {
        engine.pickGroup(hit.id);
        return dragGesture(c, engine.groupMembers(hit.id).map(item => item.id), engine, ui);
      }
      case 'line':
        engine.pickLine(hit.id);
        return null;
      case 'editable':
        // The words are the note's: the browser keeps the press, so the caret goes where it was clicked
        if (hit.id && c.adding) engine.togglePick(hit.id);
        else if (hit.id && !engine.isPicked(hit.id)) engine.pick(hit.id);
        return null;
      case 'item':
        if (c.adding) { engine.togglePick(hit.id); return null; }
        if (!engine.isPicked(hit.id)) engine.pick(hit.id);
        return dragGesture(c, engine.selectedIds(), engine, ui);
      case 'empty':
        if (!c.adding) engine.clearSelection();
        return boxGesture(c, engine, ui);
    }
  },
};

const hand: Tool = { down: (c, _engine, ui) => panGesture(c, ui) };

// Click one thing, then another: a line glued to both
const line: Tool = {
  down: (c, engine, ui) => {
    const id = c.hit.kind === 'item' || c.hit.kind === 'editable' || c.hit.kind === 'grip' ? c.hit.id : null;
    if (!id) { ui.setLineFrom(null); return null; }
    const from = ui.lineFrom();
    if (!from || from === id) { ui.setLineFrom(id); return null; }
    const lineId = newId();
    engine.apply({ op: 'addLine', line: { id: lineId, from, to: id, head: 'end', bend: 0, label: '' } });
    ui.setLineFrom(null);
    if (engine.doc().lines.some(one => one.id === lineId)) {
      engine.pickLine(lineId);
      ui.lineAdded(lineId);
    }
    return null;
  },
};

// Pen and marker: the stroke follows the pointer and becomes one thing on the board when it lets go
function strokeTool(mode: 'pen' | 'marker'): Tool {
  return {
    down: (c, engine, ui) => {
      if (c.hit.kind === 'control') return null;
      const used = engine.doc().items.reduce((sum, item) => sum + (item.type === 'stroke' ? item.points.length / 2 : 0), 0);
      if (used >= MAX_BOARD_POINTS - 2) {
        ui.notice('This board holds as much drawing as it can. Delete a drawing, or start a new board, to draw more.');
        return null;
      }
      const points = [c.world.x, c.world.y];
      let full = false;
      ui.setDraft({ kind: 'stroke', mode, points });
      return {
        move: m => {
          const zoom = ui.view().zoom;
          const lastX = points[points.length - 2], lastY = points[points.length - 1];
          if (Math.hypot(m.world.x - lastX, m.world.y - lastY) < 1.5 / zoom) return;
          if (points.length / 2 >= Math.min(MAX_POINTS, MAX_BOARD_POINTS - used)) {
            if (!full) ui.notice('That stroke is as long as one stroke can be. Let go and start another to keep drawing.');
            full = true;
            return;
          }
          points.push(m.world.x, m.world.y);
          ui.setDraft({ kind: 'stroke', mode, points: [...points] });
        },
        up: () => {
          ui.setDraft(null);
          const item = strokeItem(mode, simplify(points, mode === 'pen' ? 0.6 : 1.2));
          engine.apply({ op: 'add', items: [item] });
        },
        cancel: () => ui.setDraft(null),
      };
    },
  };
}

// A stroke's points are kept from its own corner, so moving it only moves the corner
export function strokeItem(mode: 'pen' | 'marker', points: number[]) {
  const pad = STROKE_WIDTH[mode] / 2 + 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  const x = minX - pad, y = minY - pad;
  const relative = points.map((value, i) => Math.round((value - (i % 2 === 0 ? x : y)) * 10) / 10);
  return { id: newId(), type: 'stroke' as const, kind: mode, x, y, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2, points: relative };
}

// Drag out a box. A click without a drag makes one of the usual size there.
const rect: Tool = {
  down: (c, engine, ui) => {
    if (c.hit.kind === 'control') return null;
    let area: Rect = { x: c.world.x, y: c.world.y, w: 0, h: 0 };
    ui.setDraft({ kind: 'rect', rect: area });
    return {
      move: m => { area = rectFrom(c.world, m.world); ui.setDraft({ kind: 'rect', rect: area }); },
      up: () => {
        ui.setDraft(null);
        const zoom = ui.view().zoom;
        const small = area.w * zoom < 8 && area.h * zoom < 8;
        const size = small ? KINDS.rect.size({}) : { w: Math.max(area.w, 24), h: Math.max(area.h, 24) };
        const centre = small ? c.world : { x: area.x + area.w / 2, y: area.y + area.h / 2 };
        // Behind what is already there, so a box frames cards rather than covering them
        engine.place('rect', { center: centre }, { w: size.w, h: size.h }, { back: true });
        ui.shapeDone();
      },
      cancel: () => ui.setDraft(null),
    };
  },
};

export const TOOLS: Record<BoardTool, Tool> = {
  select, hand, line, pen: strokeTool('pen'), marker: strokeTool('marker'), rect,
};
