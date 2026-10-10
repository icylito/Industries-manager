import { describe, expect, it } from 'vitest';
import { bestBend, bounds, crossings, freeSpot, intersects, linePath, simplify, viewOnto, worldFromScreen, zoomAround } from './geometry';

describe('board geometry', () => {
  it('finds the box around things, and none for nothing', () => {
    expect(bounds([])).toBeNull();
    expect(bounds([{ x: 10, y: 20, w: 5, h: 5 }, { x: -5, y: 0, w: 5, h: 50 }])).toEqual({ x: -5, y: 0, w: 20, h: 50 });
  });

  it('zooms toward the pointer, keeping the board point under it, within 10% and 400%', () => {
    const view = { x: 40, y: -30, zoom: 1.2 };
    const at = { x: 300, y: 200 };
    const before = worldFromScreen(at, view);
    const next = zoomAround(view, 2, at);
    const after = worldFromScreen(at, next);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAround(view, 99, at).zoom).toBe(4);
    expect(zoomAround(view, 0.001, at).zoom).toBe(0.1);
  });

  it('shows a box in the middle of the screen', () => {
    const view = viewOnto({ x: 100, y: 100, w: 200, h: 100 }, { w: 800, h: 600 }, 1, 0);
    const middle = worldFromScreen({ x: 400, y: 300 }, view);
    expect(middle.x).toBeCloseTo(200);
    expect(middle.y).toBeCloseTo(150);
  });

  it('draws a line from edge to edge, and bows it to the side that crosses fewer cards', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 400, y: 0, w: 100, h: 100 };
    const path = linePath(from, to, 0);
    expect(path.a.x).toBeCloseTo(100);
    expect(path.b.x).toBeCloseTo(400);
    // A card sitting just under the straight line, on the side a bend of 1 bows toward
    const below = { x: 230, y: 70, w: 40, h: 60 };
    const side = crossings(from, to, 1, [below]) > crossings(from, to, -1, [below]) ? -1 : 1;
    expect(bestBend(from, to, [below])).toBe(side);
  });

  it('puts a new thing in free space, never on top of another', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const taken = [{ x: 48, y: 48, w: 250, h: 150 }];
    const spot = freeSpot({ w: 250, h: 150 }, view, taken);
    expect(intersects({ ...spot, w: 250, h: 150 }, taken[0])).toBe(false);
  });

  it('thins a stroke but keeps its ends and its corners', () => {
    const straight = [0, 0, 1, 0.01, 2, 0, 3, 0.01, 4, 0];
    expect(simplify(straight, 0.5)).toEqual([0, 0, 4, 0]);
    const corner = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10];
    expect(simplify(corner, 0.5)).toEqual([0, 0, 10, 0, 10, 10]);
  });
});
