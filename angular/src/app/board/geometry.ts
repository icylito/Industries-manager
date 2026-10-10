import { BoardView } from '../models/board';

// The board's maths, in one place and without the page: boxes, the camera, lines between cards, where new
// things go and how a drawn stroke is thinned. Board units are what is stored; screen units are pixels inside
// the canvas, from its top left corner.

export interface Point { x: number; y: number; }
export interface Size { w: number; h: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function tidyView(view: Partial<BoardView> | null | undefined): BoardView {
  const x = view && Number.isFinite(view.x) ? view.x! : 0;
  const y = view && Number.isFinite(view.y) ? view.y! : 0;
  return { x, y, zoom: clampZoom(view?.zoom ?? 1) };
}

// The box around all of these, or null for none
export function bounds(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// The box two corners make, whichever way they were dragged
export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function worldFromScreen(p: Point, view: BoardView): Point {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}

export function screenFromWorld(p: Point, view: BoardView): Point {
  return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y };
}

// A new zoom that keeps the board point under the screen point where it is, so zooming never loses the place
export function zoomAround(view: BoardView, zoom: number, at: Point): BoardView {
  const next = clampZoom(zoom);
  const world = worldFromScreen(at, view);
  return { x: at.x - world.x * next, y: at.y - world.y * next, zoom: next };
}

// The view that shows this box in the middle of the screen. share is how much of the screen it may fill.
export function viewOnto(box: Rect, screen: Size, share: number, margin = 0): BoardView {
  const zoom = clampZoom(Math.min(
    (screen.w * share - margin * 2) / Math.max(box.w, 1),
    (screen.h * share - margin * 2) / Math.max(box.h, 1)));
  return { x: screen.w / 2 - (box.x + box.w / 2) * zoom, y: screen.h / 2 - (box.y + box.h / 2) * zoom, zoom };
}

export function centre(box: Rect): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// Where a line from the middle of this box toward a point leaves the box
export function edgePoint(box: Rect, toward: Point): Point {
  const middle = centre(box);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  if (dx === 0 && dy === 0) return middle;
  const sx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

// A gentle bow: a fixed sideways push, capped so a short line does not loop back on itself
export function curveOffset(a: Point, b: Point): number {
  return Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
}

// The control point of the quadratic, pushed sideways off the midpoint. bend is -1, 0 or 1.
export function curveControl(a: Point, b: Point, bend: number): Point {
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (bend === 0) return middle;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = bend * curveOffset(a, b);
  return { x: middle.x - (dy / length) * offset, y: middle.y + (dx / length) * offset };
}

export function quadPoint(a: Point, control: Point, b: Point, t: number): Point {
  const s = 1 - t;
  return {
    x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
  };
}

// A line as it is drawn: from the edge of one box to the edge of the other, bowed when bend is not 0.
// The same shape is used to draw it, to place its label and to count what it crosses.
export interface LinePath { a: Point; c: Point; b: Point; d: string; middle: Point; }
export function linePath(from: Rect, to: Rect, bend: number): LinePath {
  const a = edgePoint(from, centre(to));
  const b = edgePoint(to, centre(from));
  const c = curveControl(a, b, bend);
  const d = bend === 0 ? `M ${a.x} ${a.y} L ${b.x} ${b.y}` : `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  return { a, c, b, d, middle: quadPoint(a, c, b, 0.5) };
}

// How many of the other boxes this line would cut through, sampled along it
export function crossings(from: Rect, to: Rect, bend: number, others: readonly Rect[]): number {
  const path = linePath(from, to, bend);
  let count = 0;
  for (const box of others) {
    for (let t = 0.05; t < 0.96; t += 0.05) {
      const p = quadPoint(path.a, path.c, path.b, t);
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) { count++; break; }
    }
  }
  return count;
}

// The side to bow a curve so it crosses fewer cards. Ties bow to the right of the direction of travel.
export function bestBend(from: Rect, to: Rect, others: readonly Rect[]): 1 | -1 {
  return crossings(from, to, 1, others) <= crossings(from, to, -1, others) ? 1 : -1;
}

// The nearest free spot for a new thing, reading along rows from the top left of what is on screen, so a new
// note never lands on top of something else
export function freeSpot(size: Size, view: BoardView, taken: readonly Rect[]): Point {
  const gap = 24;
  const left = -view.x / view.zoom + 48;
  const top = -view.y / view.zoom + 48;
  const clashes = (x: number, y: number) =>
    taken.some(box => intersects({ x: x - gap, y: y - gap, w: size.w + gap * 2, h: size.h + gap * 2 }, box));
  for (let row = 0; row < 60; row++) {
    for (let col = 0; col < 24; col++) {
      const x = left + col * (size.w + gap);
      const y = top + row * (size.h + gap);
      if (!clashes(x, y)) return { x, y };
    }
  }
  return { x: left, y: top };
}

// Fewer points along a drawn stroke that still look the same (Ramer-Douglas-Peucker), so a long scribble stays
// small enough to save. points is one flat list, x then y.
export function simplify(points: readonly number[], tolerance: number): number[] {
  const count = points.length / 2;
  if (count <= 2) return [...points];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const ax = points[first * 2], ay = points[first * 2 + 1];
    const bx = points[last * 2], by = points[last * 2 + 1];
    const length = Math.hypot(bx - ax, by - ay);
    let far = -1, farthest = tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = points[i * 2], py = points[i * 2 + 1];
      const distance = length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > farthest) { farthest = distance; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([first, far], [far, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

// A stroke's points as an SVG path, measured from its own corner
export function strokePath(points: readonly number[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0]} ${points[1]}`;
  if (points.length === 2) return d + ` l 0.01 0`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
}
