import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scratchpad, clampZoom, normalizeView } from './scratchpad';
import { environment } from '../../environments/environment';

const url = environment.apiUrl + '/scratchpad';
const row = { id: 7, name: 'Horizon Water LLC', sector: 'Private Sector', price: 12.5 };

describe('Scratchpad', () => {
  let pad: Scratchpad;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    pad = TestBed.inject(Scratchpad);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  // Open the board so nothing is still loading when a save is tried
  async function open(): Promise<void> {
    const loading = pad.load();
    http.expectOne(url).flush({ document: { version: 1, view: { x: 0, y: 0, zoom: 1 }, items: [], lines: [], groups: [] }, updatedAt: null });
    await loading;
  }

  it('starts empty and at 100%', () => {
    expect(pad.board().items.length).toBe(0);
    expect(pad.board().view).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('reads the board from the API', async () => {
    const loading = pad.load();
    http.expectOne(url).flush({
      document: { version: 1, view: { x: 10, y: 20, zoom: 2 }, items: [{ id: 'a', type: 'note', x: 1, y: 2, w: 250, h: 150, text: 'hi' }] },
      updatedAt: '2026-10-08T00:00:00+00:00',
    });
    await loading;
    expect(pad.loading()).toBe(false);
    expect(pad.board().items.length).toBe(1);
    expect(pad.board().view).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it('shows the plain failure state when the board cannot be read', async () => {
    // The API client retries a 5xx three times before it gives up, so let those tries happen
    const loading = pad.load();
    const fail = () => http.expectOne(url).flush('nope', { status: 500, statusText: 'Server error' });
    fail();
    await vi.advanceTimersByTimeAsync(600);
    fail();
    await vi.advanceTimersByTimeAsync(1100);
    fail();
    await vi.advanceTimersByTimeAsync(2100);
    fail();
    await loading;
    expect(pad.loadError()).toBe(true);
    expect(pad.loading()).toBe(false);
  });

  it('puts an industry on the board and picks it', () => {
    pad.addIndustry(row, { x: 40, y: 40 });
    expect(pad.board().items.length).toBe(1);
    expect(pad.board().items[0].type).toBe('industry');
    expect(pad.board().items[0].industryId).toBe(7);
    expect(pad.selectedIds()).toEqual([pad.board().items[0].id]);
  });

  it('adds notes and text boxes', () => {
    pad.addPaper('note', { x: 0, y: 0 });
    pad.addPaper('text', { x: 0, y: 0 });
    expect(pad.board().items.map(item => item.type)).toEqual(['note', 'text']);
  });

  it('takes back a move in one undo and gives it again with redo', () => {
    pad.addIndustry(row, { x: 0, y: 0 });
    const id = pad.board().items[0].id;
    pad.begin();
    pad.moveManyLive([{ id, x: 200, y: 300 }]);
    pad.end();
    expect(pad.board().items[0].x).toBe(200);
    expect(pad.canUndo()).toBe(true);

    pad.undo();
    expect(pad.board().items[0].x).toBe(0);

    pad.redo();
    expect(pad.board().items[0].x).toBe(200);
  });

  it('takes back a delete and the whole typing burst', () => {
    pad.addPaper('note', { x: 0, y: 0 });
    const id = pad.board().items[0].id;
    pad.begin();
    pad.textLive(id, 'to check');
    pad.end();
    expect(pad.board().items[0].text).toBe('to check');

    pad.undo();
    expect(pad.board().items[0].text).toBe('');

    pad.removeItems([id]);
    expect(pad.board().items.length).toBe(0);
    pad.undo();
    expect(pad.board().items.length).toBe(1);
  });

  it('keeps a new thing out of the way of the others', () => {
    pad.addIndustry(row, { x: 0, y: 0 });
    const spot = pad.freeSpot(236, 92);
    const clash = pad.board().items.some(item =>
      spot.x < item.x + item.w && spot.x + 236 > item.x && spot.y < item.y + item.h && spot.y + 92 > item.y);
    expect(clash).toBe(false);
  });

  it('picks several things at once, and adds and removes one', () => {
    pad.addIndustry(row, { x: 0, y: 0 });
    pad.addPaper('note', { x: 400, y: 0 });
    const ids = pad.board().items.map(item => item.id);
    pad.setSelection(ids);
    expect(pad.selection().length).toBe(2);
    pad.togglePick(ids[0]);
    expect(pad.selectedIds()).toEqual([ids[1]]);
    pad.clearSelection();
    expect(pad.selectedIds()).toEqual([]);
  });

  it('groups what is picked, ungroups it, and drops the group when its things go', () => {
    pad.addIndustry(row, { x: 0, y: 0 });
    pad.addPaper('note', { x: 400, y: 0 });
    const ids = pad.board().items.map(item => item.id);
    pad.setSelection(ids);
    const groupId = pad.addGroup('Top three');
    expect(groupId).toBeTruthy();
    expect(pad.groups().length).toBe(1);
    expect(pad.groupFor(ids[0])?.name).toBe('Top three');
    expect(pad.membersOf(groupId!).length).toBe(2);

    pad.ungroup(groupId!);
    expect(pad.groups().length).toBe(0);
    expect(pad.board().items.length).toBe(2);

    pad.setSelection(ids);
    const second = pad.addGroup('Again');
    pad.deleteGroup(second!);
    expect(pad.board().items.length).toBe(0);
    expect(pad.board().groups.length).toBe(0);
  });

  it('glues a line to two things and takes it with them', () => {
    pad.addIndustry(row, { x: 0, y: 0 });
    pad.addPaper('note', { x: 400, y: 0 });
    const ids = pad.board().items.map(item => item.id);
    pad.addLine(ids[0], ids[1]);
    expect(pad.lines().length).toBe(1);
    // The same line is not drawn twice
    pad.addLine(ids[0], ids[1]);
    expect(pad.lines().length).toBe(1);

    pad.removeItems([ids[0]]);
    expect(pad.lines().length).toBe(0);
  });

  it('clamps the zoom and tidies a missing view', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(99)).toBe(4);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(normalizeView(undefined)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(normalizeView({ x: 5, y: 6, zoom: 99 })).toEqual({ x: 5, y: 6, zoom: 4 });
  });

  it('saves the whole board and reads Saved', async () => {
    await open();
    pad.addPaper('note', { x: 0, y: 0 });
    expect(pad.saveState()).toBe('save');
    const saving = pad.saveNow();
    const request = http.expectOne(url);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.document.version).toBe(1);
    request.flush({ updatedAt: '2026-10-08T00:00:00+00:00' });
    await saving;
    expect(pad.saveState()).toBe('saved');
  });

  it('reads Failed to save straight away, and a later try reaches Saved', async () => {
    await open();
    pad.addPaper('note', { x: 0, y: 0 });
    const first = pad.saveNow();
    http.expectOne(url).flush('boom', { status: 500, statusText: 'Server error' });
    await first;
    expect(pad.saveState()).toBe('failed');

    pad.retrySave();
    const retry = http.expectOne(url);
    retry.flush({ updatedAt: '2026-10-08T00:01:00+00:00' });
    await vi.advanceTimersByTimeAsync(0);
    expect(pad.saveState()).toBe('saved');
  });

  it('a change made while a save is in flight keeps Save until it is covered', async () => {
    await open();
    pad.addPaper('note', { x: 0, y: 0 });
    const first = pad.saveNow();
    const request = http.expectOne(url);
    pad.addPaper('text', { x: 300, y: 0 });
    expect(pad.saveState()).toBe('save');
    request.flush({ updatedAt: '2026-10-08T00:00:00+00:00' });
    await first;
    // The answer did not cover the second change, so nothing is called saved
    expect(pad.saveState()).toBe('save');

    const follow = pad.saveNow();
    http.expectOne(url).flush({ updatedAt: '2026-10-08T00:01:00+00:00' });
    await follow;
    expect(pad.saveState()).toBe('saved');
  });

  it('a stale save is refused with 409 and the board is said to have changed elsewhere', async () => {
    await open();
    pad.addPaper('note', { x: 0, y: 0 });
    const saving = pad.saveNow();
    http.expectOne(url).flush('changed', { status: 409, statusText: 'Conflict' });
    await saving;
    expect(pad.saveState()).toBe('failed');
    expect(pad.conflict()).toBe(true);
  });

  it('labels a line, adds arrowheads and bows it, each as one undo step', async () => {
    await open();
    pad.addIndustry(row, { x: 0, y: 0 });
    pad.addPaper('note', { x: 400, y: 0 });
    const ids = pad.board().items.map(item => item.id);
    pad.addLine(ids[0], ids[1]);
    const lineId = pad.lines()[0].id;

    pad.setLineLabel(lineId, 'depends on');
    expect(pad.lines()[0].label).toBe('depends on');
    pad.setLineHead(lineId, 'both');
    expect(pad.lines()[0].head).toBe('both');
    pad.setLineCurve(lineId, true);
    const bent = pad.lines()[0].bend;
    expect([1, -1]).toContain(bent);
    pad.flipLine(lineId);
    expect(pad.lines()[0].bend).toBe(-bent);

    // Each press was its own undo step: flip, then the curve, then the arrowhead
    pad.undo();
    expect(pad.lines()[0].bend).toBe(bent);
    pad.undo();
    expect(pad.lines()[0].bend).toBe(0);
    expect(pad.lines()[0].head).toBe('both');
    pad.undo();
    expect(pad.lines()[0].head).toBe('none');
  });

  it('turning the curve off straightens the line', async () => {
    await open();
    pad.addIndustry(row, { x: 0, y: 0 });
    pad.addPaper('note', { x: 400, y: 0 });
    const ids = pad.board().items.map(item => item.id);
    pad.addLine(ids[0], ids[1]);
    const lineId = pad.lines()[0].id;
    pad.setLineCurve(lineId, true);
    expect(pad.lines()[0].bend).not.toBe(0);
    pad.setLineCurve(lineId, false);
    expect(pad.lines()[0].bend).toBe(0);
  });
});
