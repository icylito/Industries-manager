import { describe, expect, it } from 'vitest';
import {
  bestBend,
  bounds,
  crossings,
  edgePoint,
  freeSpot,
  intersects,
  linePath,
  screenFromWorld,
  simplify,
  viewOnto,
  worldFromScreen,
  worldLength,
  zoomAround,
} from './geometry';

describe('board geometry', () => {
  it('finds the box around things, and none for nothing', () => {
    expect(bounds([])).toBeNull();
    expect(
      bounds([
        { x: 10, y: 20, w: 5, h: 5 },
        { x: -5, y: 0, w: 5, h: 50 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 20, h: 50 });
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
    // A card just under the middle of the line. A bend of 1 bows down through it (its middle at y 77), -1 bows
    // up and clear (y 23), so the line bows up.
    const below = { x: 230, y: 70, w: 40, h: 60 };
    expect(crossings(from, to, 1, [below])).toBe(1);
    expect(crossings(from, to, -1, [below])).toBe(0);
    expect(bestBend(from, to, [below])).toBe(-1);
  });

  it('counts only what the drawn line crosses, from edge to edge, not what lies between the middles (B10)', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 400, y: 0, w: 100, h: 100 };
    // Inside the first card, between its middle and its edge: a line drawn from the middle would cut it
    const tucked = { x: 60, y: 40, w: 30, h: 20 };
    expect(crossings(from, to, 0, [tucked])).toBe(0);
    expect(crossings(from, to, 0, [{ x: 240, y: 40, w: 20, h: 20 }])).toBe(1);
  });

  it('turns screen points into board points and back, at any zoom', () => {
    for (const view of [
      { x: 0, y: 0, zoom: 1 },
      { x: 40, y: -30, zoom: 2.5 },
      { x: -900, y: 120, zoom: 0.1 },
    ]) {
      const screen = { x: 317, y: -42 };
      const back = screenFromWorld(worldFromScreen(screen, view), view);
      expect(back.x).toBeCloseTo(screen.x);
      expect(back.y).toBeCloseTo(screen.y);
    }
    expect(worldFromScreen({ x: 140, y: 70 }, { x: 40, y: -30, zoom: 2 })).toEqual({
      x: 50,
      y: 50,
    });
    // A distance on screen is shorter on the board when zoomed in
    expect(worldLength({ x: 30, y: -12 }, { x: 99, y: 99, zoom: 3 })).toEqual({ x: 10, y: -4 });
  });

  it('finds where a line toward a point leaves a box', () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    expect(edgePoint(box, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(edgePoint(box, { x: 100, y: -300 })).toEqual({ x: 100, y: 0 });
    expect(edgePoint(box, { x: 300, y: 150 })).toEqual({ x: 200, y: 100 });
    expect(edgePoint(box, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it('says whether two boxes overlap, and touching edges do not', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(intersects(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
    expect(intersects(a, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
    expect(intersects(a, { x: 100, y: 0, w: 50, h: 50 })).toBe(false);
    expect(intersects(a, { x: 0, y: -60, w: 50, h: 50 })).toBe(false);
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
