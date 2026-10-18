import { describe, expect, it } from 'vitest';
import { BoardDocument, BoardItem } from '../models/board';
import { applyOp, copiesOf, emptyDocument, openDocument } from './ops';

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
const board = (...items: BoardItem[]): BoardDocument => ({ ...emptyDocument(), items });

describe('board ops', () => {
  it('hands back the same board when nothing changed, so a no-op is never an undo step', () => {
    const doc = board(note('a'));
    expect(applyOp(doc, { op: 'move', positions: [{ id: 'a', x: 0, y: 0 }] })).toBe(doc);
    expect(applyOp(doc, { op: 'patch', ids: ['a'], patch: { tone: 'white' } })).toBe(doc);
    expect(applyOp(doc, { op: 'remove', ids: ['nope'] })).toBe(doc);
    expect(applyOp(doc, { op: 'order', ids: ['a'], to: 'front' })).toBe(doc);
  });

  it('never edits the board it is given, and shares what did not change', () => {
    const doc = board(note('a'), note('b', 200));
    const next = applyOp(doc, { op: 'move', positions: [{ id: 'a', x: 5, y: 6 }] });
    expect(doc.items[0].x).toBe(0);
    expect(next.items[0].x).toBe(5);
    expect(next.items[1]).toBe(doc.items[1]);
  });

  it('takes the lines and the groups with the things removed', () => {
    let doc = board(note('a'), note('b'), note('c'));
    doc = applyOp(doc, {
      op: 'addLine',
      line: { id: 'l', from: 'a', to: 'b', head: 'end', bend: 0, label: '' },
    });
    doc = applyOp(doc, { op: 'group', id: 'g', ids: ['a', 'b'], name: 'Pair' });
    doc = applyOp(doc, { op: 'remove', ids: ['a'] });
    expect(doc.lines).toEqual([]);
    expect(doc.groups).toEqual([]);
  });

  it('keeps a thing in one group only, and refuses a line to nowhere or a second same line', () => {
    let doc = board(note('a'), note('b'), note('c'));
    doc = applyOp(doc, { op: 'group', id: 'g1', ids: ['a', 'b'], name: '' });
    doc = applyOp(doc, { op: 'group', id: 'g2', ids: ['b', 'c'], name: '' });
    expect(doc.groups.map((g) => g.id)).toEqual(['g2']);
    const line = { id: 'l', from: 'a', to: 'b', head: 'end' as const, bend: 0, label: '' };
    doc = applyOp(doc, { op: 'addLine', line });
    expect(applyOp(doc, { op: 'addLine', line: { ...line, id: 'l2' } })).toBe(doc);
    expect(applyOp(doc, { op: 'addLine', line: { ...line, id: 'l3', to: 'zzz' } })).toBe(doc);
  });

  it('puts things in front or behind, and a new box can go straight behind', () => {
    let doc = board(note('a'), note('b'), note('c'));
    doc = applyOp(doc, { op: 'order', ids: ['c'], to: 'back' });
    expect(doc.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    doc = applyOp(doc, {
      op: 'add',
      items: [{ id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, tone: 'white' }],
      back: true,
    });
    expect(doc.items[0].id).toBe('r');
  });

  it('copies things with the lines between them and a group copied whole', () => {
    let doc = board(note('a'), note('b'), note('c'));
    doc = applyOp(doc, {
      op: 'addLine',
      line: { id: 'l1', from: 'a', to: 'b', head: 'end', bend: 0, label: 'leads to' },
    });
    doc = applyOp(doc, {
      op: 'addLine',
      line: { id: 'l2', from: 'b', to: 'c', head: 'end', bend: 0, label: '' },
    });
    doc = applyOp(doc, { op: 'group', id: 'g', ids: ['a', 'b'], name: 'Pair' });
    let n = 0;
    const { op, idFor } = copiesOf(doc, ['a', 'b'], { x: 10, y: 0 }, () => 'n' + ++n);
    const next = applyOp(doc, op);
    expect(next.items.length).toBe(5);
    expect(next.lines.find((l) => l.from === idFor.get('a'))?.label).toBe('leads to');
    expect(next.lines.length).toBe(3);
    expect(next.groups.length).toBe(2);
    expect(next.items.find((i) => i.id === idFor.get('a'))?.x).toBe(10);
  });

  it('opens an old board: plain text notes get blocks, unknown things and their lines are left out', () => {
    const doc = openDocument({
      version: 1,
      items: [
        {
          id: 'a',
          type: 'note',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          text: 'old words',
        } as unknown as BoardItem,
        { id: 'b', type: 'hologram', x: 0, y: 0, w: 1, h: 1 } as unknown as BoardItem,
      ],
      lines: [{ id: 'l', from: 'a', to: 'b', head: 'none', bend: 0, label: '' }],
      groups: [],
    });
    expect(doc.items.length).toBe(1);
    const first = doc.items[0];
    expect(first.type === 'note' && first.blocks[0].runs[0].text).toBe('old words');
    expect(doc.lines).toEqual([]);
  });
});
