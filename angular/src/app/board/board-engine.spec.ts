import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardEngine } from './board-engine';
import { BoardItem } from '../models/board';
import { environment } from '../../environments/environment';

const url = environment.apiUrl + '/scratchpad/boards';
const note = (id: string, x = 0): BoardItem => ({ id, type: 'note', x, y: 0, w: 100, h: 60, blocks: [], tone: 'white', tilt: 0 });

describe('Board engine', () => {
  let http: HttpTestingController;
  let board: BoardEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    board = TestBed.inject(BoardEngine);
  });

  afterEach(() => vi.useRealTimers());

  async function open(items: BoardItem[] = [], id = 1, updatedAt = 't0') {
    const opened = board.open(id);
    http.expectOne(`${url}/${id}`).flush({
      id, name: 'Ideas', pinned: false, view: { x: 10, y: 20, zoom: 2 }, createdAt: 'c', updatedAt,
      document: { version: 1, items, lines: [], groups: [] },
    });
    await opened;
  }

  const puts = () => http.match(r => r.method === 'PUT');
  const answer = async (put: TestRequest, updatedAt: string) => { put.flush({ updatedAt }); await vi.advanceTimersByTimeAsync(0); };

  describe('undo', () => {
    it('opens a board where the person left it, and moving around is never an undo step or a save', async () => {
      await open([note('a')]);
      expect(board.view()).toEqual({ x: 10, y: 20, zoom: 2 });
      board.setView({ x: 0, y: 0, zoom: 1 });
      expect(board.canUndo()).toBe(false);
      vi.advanceTimersByTime(2000);
      expect(puts()).toEqual([]);
      const patch = http.expectOne(r => r.method === 'PATCH' && r.url === `${url}/1`);
      expect(patch.request.body).toEqual({ view: { x: 0, y: 0, zoom: 1 } });
      board.apply({ op: 'move', positions: [{ id: 'a', x: 50, y: 0 }] });
      board.setView({ x: 99, y: 99, zoom: 3 });
      board.undo();
      // Undo takes back the move, and never moves the camera
      expect(board.doc().items[0].x).toBe(0);
      expect(board.view()).toEqual({ x: 99, y: 99, zoom: 3 });
    });

    it('makes a drag one step, and a cancelled drag puts things back with no step', async () => {
      await open([note('a')]);
      const tx = board.begin();
      for (let x = 1; x <= 30; x++) tx.apply({ op: 'move', positions: [{ id: 'a', x, y: 0 }] });
      tx.commit();
      expect(board.doc().items[0].x).toBe(30);
      board.undo();
      expect(board.doc().items[0].x).toBe(0);
      expect(board.canUndo()).toBe(false);

      const lost = board.begin();
      lost.apply({ op: 'move', positions: [{ id: 'a', x: 70, y: 0 }] });
      lost.cancel();
      expect(board.doc().items[0].x).toBe(0);
      expect(board.canUndo()).toBe(false);
    });

    it('commits an open typing step when something else starts, so neither is lost', async () => {
      await open([note('a'), note('b', 200)]);
      const typing = board.begin();
      typing.apply({ op: 'patch', ids: ['a'], patch: { blocks: [{ id: 'x', list: 'none', runs: [{ text: 'hello' }] }] } });
      board.apply({ op: 'move', positions: [{ id: 'b', x: 300, y: 0 }] });
      expect(typing.open).toBe(false);
      board.undo();
      expect(board.doc().items[1].x).toBe(200);
      const a = board.doc().items[0];
      expect(a.type === 'note' && a.blocks[0].runs[0].text).toBe('hello');
      board.undo();
      const b = board.doc().items[0];
      expect(b.type === 'note' && b.blocks).toEqual([]);
    });

    it('gives an upload id and fresh prices to every board in the history, never as a step', async () => {
      await open([{ id: 'c', type: 'industry', x: 0, y: 0, w: 1, h: 1, industryId: 4, name: 'Old', sector: null, price: 1, rank: null }]);
      const fileId = board.place('file', 'auto', { name: 'a.png', contentType: 'image/png', sizeBytes: 3 });
      board.fileStored(fileId, { id: 9, name: 'a.png', contentType: 'image/png', sizeBytes: 3 });
      board.refreshCards([{ id: 4, name: 'New', sector: null, price: 2 }]);
      board.undo();
      expect(board.doc().items.length).toBe(1);
      const card = board.doc().items[0];
      expect(card.type === 'industry' && card.price).toBe(2);
      board.redo();
      const file = board.doc().items[1];
      expect(file.type === 'file' && file.fileId).toBe(9);
    });

    it('caps the history at 100 steps', async () => {
      await open([note('a')]);
      for (let x = 1; x <= 130; x++) board.apply({ op: 'move', positions: [{ id: 'a', x, y: 0 }] });
      let steps = 0;
      while (board.canUndo()) { board.undo(); steps++; }
      expect(steps).toBe(100);
      expect(board.doc().items[0].x).toBe(30);
    });

    it('duplicates beside the originals and groups, ungroups and orders in single steps', async () => {
      await open([note('a'), note('b', 200)]);
      board.setSelection(['a', 'b']);
      const group = board.groupSelection('Pair');
      expect(board.selectedGroupId()).toBe(group);
      const copies = board.duplicate(board.pickedIds(), { x: 24, y: 24 });
      expect(board.doc().items.length).toBe(4);
      expect(board.doc().groups.length).toBe(2);
      expect(board.doc().items.find(i => i.id === copies.get('a'))?.x).toBe(24);
      board.pickGroup(group!);
      board.ungroupSelected();
      expect(board.selectedIds()).toEqual(['a', 'b']);
      board.undo();
      board.undo();
      board.undo();
      expect(board.doc().items.length).toBe(2);
      expect(board.doc().groups).toEqual([]);
    });
  });

  describe('saving', () => {
    it('sends one save for a burst of typing, after it goes quiet, and only then says Saved', async () => {
      await open([note('a')]);
      const tx = board.begin();
      for (let i = 0; i < 40; i++) {
        tx.apply({ op: 'patch', ids: ['a'], patch: { blocks: [{ id: 'x', list: 'none', runs: [{ text: 'x'.repeat(i + 1) }] }] } });
        vi.advanceTimersByTime(250);
      }
      expect(board.save()).toBe('save');
      expect(puts()).toEqual([]);
      vi.advanceTimersByTime(700);
      const sent = puts();
      expect(sent.length).toBe(1);
      expect(sent[0].request.body.updatedAt).toBe('t0');
      expect(board.save()).toBe('save');
      await answer(sent[0], 't1');
      expect(board.save()).toBe('saved');
    });

    it('sends one save at a time: a change while one is out goes next, with the newer updatedAt', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 1, y: 0 }] });
      vi.advanceTimersByTime(700);
      const first = puts();
      expect(first.length).toBe(1);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 2, y: 0 }] });
      vi.advanceTimersByTime(700);
      expect(puts()).toEqual([]);
      await answer(first[0], 't1');
      expect(board.save()).toBe('save');
      vi.advanceTimersByTime(700);
      const second = puts();
      expect(second.length).toBe(1);
      expect(second[0].request.body.updatedAt).toBe('t1');
      expect(second[0].request.body.document.items[0].x).toBe(2);
      await answer(second[0], 't2');
      expect(board.save()).toBe('saved');
    });

    it('says Failed to save, keeps the changes, and Try again saves them', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush('down', { status: 500, statusText: 'Server Error' });
      await vi.advanceTimersByTimeAsync(0);
      expect(board.save()).toBe('failed');
      expect(board.doc().items[0].x).toBe(5);
      board.retrySave();
      const again = puts();
      expect(again.length).toBe(1);
      expect(again[0].request.body.document.items[0].x).toBe(5);
      await answer(again[0], 't1');
      expect(board.save()).toBe('saved');
    });

    it('backs off while the API keeps failing, without a flood', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      let sent = 0;
      for (let t = 0; t < 180; t++) {
        await vi.advanceTimersByTimeAsync(1000);
        for (const put of puts()) { sent++; put.flush('down', { status: 503, statusText: 'Unavailable' }); }
      }
      expect(sent).toBeGreaterThan(3);
      expect(sent).toBeLessThan(13);
      expect(board.save()).toBe('failed');
    });

    it('says why the API refused the board, and waits for the next change instead of retrying', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush({ errors: { items: ['A board holds at most 500 things'] } }, { status: 400, statusText: 'Bad Request' });
      await vi.advanceTimersByTimeAsync(0);
      expect(board.save()).toBe('failed');
      expect(board.saveProblem()).toBe('A board holds at most 500 things');
      vi.advanceTimersByTime(60_000);
      expect(puts()).toEqual([]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 6, y: 0 }] });
      expect(board.saveProblem()).toBeNull();
      vi.advanceTimersByTime(700);
      await answer(puts()[0], 't1');
      expect(board.save()).toBe('saved');
    });

    it('stops after a 409, saves nothing over the other copy, and counts what reload would lose', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush('changed', { status: 409, statusText: 'Conflict' });
      await vi.advanceTimersByTimeAsync(0);
      expect(board.conflict()).toBe(true);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 6, y: 0 }] });
      board.saveNow();
      vi.advanceTimersByTime(300_000);
      expect(puts()).toEqual([]);
      expect(board.unsavedSteps()).toBe(2);
      expect(await board.close()).toBe(false);
    });

    it('keeps changes a stale tab could not save as a new board, history and all', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush('changed', { status: 409, statusText: 'Conflict' });
      await vi.advanceTimersByTimeAsync(0);
      const kept = board.keepMineAsNewBoard();
      const create = http.expectOne(r => r.method === 'POST' && r.url === url);
      expect(create.request.body.name).toBe('Ideas (my copy)');
      expect(create.request.body.document.items[0].x).toBe(5);
      create.flush({ id: 2, name: 'Ideas (my copy)', pinned: false, createdAt: 'c', updatedAt: 'n1', things: 1 });
      expect(await kept).toBe(2);
      expect(board.conflict()).toBe(false);
      expect(board.save()).toBe('saved');
      expect(board.canUndo()).toBe(true);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 9, y: 0 }] });
      vi.advanceTimersByTime(700);
      const next = puts();
      expect(next[0].request.url).toBe(`${url}/2`);
      expect(next[0].request.body.updatedAt).toBe('n1');
    });

    it('sends nothing at all while nothing changes, and the 2 minute save only when something waits', async () => {
      await open([note('a')]);
      vi.advanceTimersByTime(300_000);
      expect(http.match(() => true)).toEqual([]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush('down', { status: 0, statusText: 'Offline' });
      await vi.advanceTimersByTimeAsync(0);
      expect(board.save()).toBe('failed');
    });

    it('drops a late answer from a board that was opened again, and never calls it saved', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      const late = puts()[0];
      await open([note('a', 77)], 1, 't9');
      late.flush({ updatedAt: 't1' });
      await vi.advanceTimersByTimeAsync(0);
      expect(board.doc().items[0].x).toBe(77);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 78, y: 0 }] });
      vi.advanceTimersByTime(700);
      expect(puts()[0].request.body.updatedAt).toBe('t9');
    });

    it('gets back to Saved with every change once the API is back', async () => {
      await open([note('a')]);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 5, y: 0 }] });
      vi.advanceTimersByTime(700);
      puts()[0].flush('offline', { status: 0, statusText: '' });
      await vi.advanceTimersByTimeAsync(0);
      board.apply({ op: 'move', positions: [{ id: 'a', x: 6, y: 0 }] });
      vi.advanceTimersByTime(1500);
      const back = puts();
      expect(back.length).toBe(1);
      expect(back[0].request.body.document.items[0].x).toBe(6);
      await answer(back[0], 't1');
      expect(board.save()).toBe('saved');
    });
  });
});
