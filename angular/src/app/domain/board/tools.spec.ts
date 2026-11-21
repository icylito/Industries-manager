import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BoardEngine } from '../../application/board/board-engine';
import { BoardItem, BoardView } from '../models/board';
import { Draft, Hit, PointerCtx, TOOLS, ToolUi, hitTest } from './tools';
import { Rect, worldFromScreen } from './geometry';
import { environment } from '../../../environments/environment';
import { provideInfrastructure } from '../../infrastructure/providers';

const note = (id: string, x = 0, y = 0): BoardItem => ({
  id,
  type: 'note',
  x,
  y,
  w: 100,
  h: 60,
  blocks: [],
  tone: 'white',
  tilt: 0,
});

// The tools are driven here with plain objects: no page, no DOM, no pointer events
describe('Board tools', () => {
  let board: BoardEngine;
  let view: BoardView;
  let box: Rect | null;
  let draft: Draft | null;
  let from: string | null;
  let shapes: number;
  let notices: string[];
  const ui: ToolUi = {
    view: () => view,
    setView: (v) => (view = v),
    setBox: (b) => (box = b),
    setDraft: (d) => (draft = d),
    lineFrom: () => from,
    setLineFrom: (id) => (from = id),
    lineAdded: () => {},
    shapeDone: () => shapes++,
    notice: (line) => notices.push(line),
  };
  const at = (
    x: number,
    y: number,
    hit: Hit = { kind: 'empty' },
    extra: Partial<PointerCtx> = {},
  ): PointerCtx => ({
    screen: { x, y },
    world: worldFromScreen({ x, y }, view),
    hit,
    button: 0,
    adding: false,
    duplicating: false,
    ...extra,
  });

  beforeEach(async () => {
    view = { x: 0, y: 0, zoom: 1 };
    box = null;
    draft = null;
    from = null;
    shapes = 0;
    notices = [];
    TestBed.configureTestingModule({
      providers: [...provideInfrastructure(), provideHttpClient(), provideHttpClientTesting()],
    });
    board = TestBed.inject(BoardEngine);
    const opened = board.open(1);
    TestBed.inject(HttpTestingController)
      .expectOne(environment.apiUrl + '/scratchpad/boards/1')
      .flush({
        id: 1,
        name: 'b',
        pinned: false,
        view: null,
        createdAt: 'c',
        updatedAt: 't',
        document: { version: 1, items: [note('a'), note('b', 300)], lines: [], groups: [] },
      });
    await opened;
  });

  it('drags what is picked as one step, at any zoom', () => {
    view = { x: 0, y: 0, zoom: 2 };
    const gesture = TOOLS.select.down(at(10, 10, { kind: 'item', id: 'a' }), board, ui)!;
    gesture.move(at(30, 50));
    gesture.move(at(110, 210));
    gesture.up(at(110, 210));
    expect(board.doc().items[0]).toMatchObject({ x: 50, y: 100 });
    board.undo();
    expect(board.doc().items[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('copies on a drag with the duplicate key, leaving the originals', () => {
    const gesture = TOOLS.select.down(
      at(10, 10, { kind: 'item', id: 'a' }, { duplicating: true }),
      board,
      ui,
    )!;
    gesture.move(at(60, 10));
    gesture.up(at(60, 10));
    expect(board.doc().items.length).toBe(3);
    expect(board.doc().items[0].x).toBe(0);
    expect(board.doc().items[2].x).toBe(50);
    expect(board.selectedIds()).toEqual([board.doc().items[2].id]);
    board.undo();
    expect(board.doc().items.length).toBe(2);
  });

  it('picks by a box dragged on empty space, adding to what was picked when asked', () => {
    board.pick('b');
    const gesture = TOOLS.select.down(
      at(-10, -10, { kind: 'empty' }, { adding: true }),
      board,
      ui,
    )!;
    gesture.move(at(50, 50));
    expect(box).toEqual({ x: -10, y: -10, w: 60, h: 60 });
    gesture.up(at(50, 50));
    expect(box).toBeNull();
    expect(board.selectedIds().sort()).toEqual(['a', 'b']);
  });

  it('leaves a press in a note to the note, only picking it', () => {
    expect(TOOLS.select.down(at(5, 5, { kind: 'editable', id: 'a' }), board, ui)).toBeNull();
    expect(board.selectedIds()).toEqual(['a']);
  });

  it('resizes with the grip, never below the smallest size', () => {
    const gesture = TOOLS.select.down(at(100, 60, { kind: 'grip', id: 'a' }), board, ui)!;
    gesture.move(at(-500, -500));
    gesture.up(at(-500, -500));
    expect(board.doc().items[0]).toMatchObject({ w: 120, h: 60 });
  });

  it('joins two things with an arrow on the second click', () => {
    TOOLS.line.down(at(0, 0, { kind: 'item', id: 'a' }), board, ui);
    expect(from).toBe('a');
    TOOLS.line.down(at(0, 0, { kind: 'item', id: 'b' }), board, ui);
    expect(board.doc().lines).toMatchObject([{ from: 'a', to: 'b', head: 'end' }]);
    expect(board.selectedLineId()).toBe(board.doc().lines[0].id);
  });

  it('draws a pen stroke as one thing, its points from its own corner', () => {
    const gesture = TOOLS.pen.down(at(500, 500), board, ui)!;
    for (let i = 1; i <= 50; i++) gesture.move(at(500 + i * 4, 500 + (i % 2) * 20));
    expect(draft?.kind).toBe('stroke');
    gesture.up(at(700, 500));
    expect(draft).toBeNull();
    const stroke = board.doc().items[2];
    expect(stroke.type).toBe('stroke');
    if (stroke.type !== 'stroke') return;
    expect(stroke.points.length).toBeGreaterThan(3);
    expect(Math.min(...stroke.points)).toBeGreaterThanOrEqual(0);
    expect(stroke.x).toBeLessThan(500);
    board.undo();
    expect(board.doc().items.length).toBe(2);
  });

  it('stops a stroke at its length limit and a board at its drawing limit, and says so', () => {
    const long = TOOLS.pen.down(at(0, 0), board, ui)!;
    for (let i = 1; i <= 2100; i++) long.move(at(i * 2, (i % 2) * 5));
    long.up(at(0, 0));
    expect(notices[0]).toContain('as long as one stroke can be');
    const stroke = board.doc().items.find((i) => i.type === 'stroke');
    expect(stroke && stroke.type === 'stroke' && stroke.points.length / 2).toBeLessThanOrEqual(
      2000,
    );
    const full = Array.from({ length: 25 }, (_, n) => ({
      id: 'full' + n,
      type: 'stroke' as const,
      kind: 'pen' as const,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      points: new Array(4000).fill(1),
    }));
    board.apply({ op: 'add', items: full });
    expect(TOOLS.pen.down(at(5, 5), board, ui)).toBeNull();
    expect(notices.at(-1)).toContain('holds as much drawing as it can');
  });

  it('draws a box behind everything, and goes back to Select', () => {
    const gesture = TOOLS.rect.down(at(-50, -50), board, ui)!;
    gesture.move(at(450, 150));
    gesture.up(at(450, 150));
    expect(board.doc().items[0]).toMatchObject({ type: 'rect', x: -50, y: -50, w: 500, h: 200 });
    expect(shapes).toBe(1);
  });

  it('pans with the hand, and Esc puts the view back', () => {
    const gesture = TOOLS.hand.down(at(0, 0), board, ui)!;
    gesture.move(at(40, -20));
    expect(view).toMatchObject({ x: 40, y: -20 });
    gesture.cancel();
    expect(view).toMatchObject({ x: 0, y: 0 });
  });

  it('reads what is under the pointer from the page', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div data-item="n1"><div contenteditable="true"><b id="w">word</b></div><button id="btn">x</button><span id="body">b</span><span data-grip="n1" id="g"></span></div>';
    document.body.append(host);
    expect(hitTest(document.getElementById('w'))).toEqual({ kind: 'editable', id: 'n1' });
    expect(hitTest(document.getElementById('btn'))).toEqual({ kind: 'control' });
    expect(hitTest(document.getElementById('body'))).toEqual({ kind: 'item', id: 'n1' });
    expect(hitTest(document.getElementById('g'))).toEqual({ kind: 'grip', id: 'n1' });
    host.remove();
  });
});
