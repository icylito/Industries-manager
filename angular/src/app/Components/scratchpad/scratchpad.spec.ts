import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScratchpadPage } from './scratchpad';
import { BoardEngine } from '../../board/board-engine';
import { ScratchApi } from '../../board/scratch-api';
import { environment } from '../../../environments/environment';
import { refusalFor, sizeText, typeLabel } from './board-files';
import { By } from '@angular/platform-browser';
import { CompanyRail } from './company-rail';
import { FileCards } from './file-cards';

const url = environment.apiUrl + '/scratchpad';
const row = (id: number, name: string, price: number | null) => ({
  id, name, sector: 'Public Sector', price, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null,
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Scratchpad page', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ board: '1' }));
    await TestBed.configureTestingModule({
      imports: [ScratchpadPage],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: params, get snapshot() { return { queryParamMap: params.value }; } } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    // The address is the page's own state: navigating only changes the query parameters here
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation((_commands, extras) => {
      const next: Record<string, string> = {};
      for (const key of params.value.keys) next[key] = params.value.get(key)!;
      for (const [key, value] of Object.entries(extras?.queryParams ?? {})) {
        if (value == null) delete next[key]; else next[key] = String(value);
      }
      params.next(convertToParamMap(next));
      return Promise.resolve(true);
    });
    // A picture's preview is an object URL, which jsdom's Blob can't make
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // The rail's top three, the tray, then board 1. The rail never asks for the whole table.
  async function open(items: object[] = [], top = [row(1, 'Alpha', 9), row(2, 'Beta', 8), row(3, 'Gamma', 7)]) {
    const fixture = TestBed.createComponent(ScratchpadPage);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/industries/top')).flush(top);
    http.match(url + '/tray').forEach(r => r.flush({ items: [] }));
    await tick();
    http.expectOne(url + '/boards/1').flush({
      id: 1, name: 'My board', pinned: false, view: null, createdAt: '2026-10-10T08:00:00Z', updatedAt: '2026-10-10T08:00:00Z',
      document: { version: 1, items, lines: [], groups: [] },
    });
    http.expectNone(environment.apiUrl + '/industries');
    await tick();
    http.match(r => r.url.endsWith('/industries/by-ids')).forEach(r => r.flush([]));
    fixture.detectChanges();
    return {
      fixture, page: fixture.componentInstance, board: TestBed.inject(BoardEngine), el: fixture.nativeElement as HTMLElement,
      files: fixture.debugElement.injector.get(FileCards),
      rail: fixture.debugElement.query(By.directive(CompanyRail)).componentInstance as CompanyRail,
    };
  }

  it('opens the board named in the address, with its name and the empty board hint', async () => {
    const { el } = await open();
    expect(el.querySelector('.board-name')?.textContent).toContain('My board');
    expect(el.querySelectorAll('.item').length).toBe(0);
    expect(el.textContent).toContain('Nothing on this board yet');
  });

  it('opens the first board on the list when the address names none', async () => {
    params.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(ScratchpadPage);
    fixture.detectChanges();
    await tick();
    http.expectOne(url + '/boards').flush([{ id: 7, name: 'Ideas', pinned: true, createdAt: 'a', updatedAt: '2026-10-10T08:00:00Z', things: 3 }]);
    await tick();
    await tick();
    expect(params.value.get('board')).toBe('7');
    http.expectOne(url + '/boards/7');
  });

  it('adds a note, and undo takes it away again', async () => {
    const { fixture, page, board, el } = await open();
    board.place('note', 'auto', {});
    fixture.detectChanges();
    expect(el.querySelectorAll('.item').length).toBe(1);
    page.undo();
    fixture.detectChanges();
    expect(el.querySelectorAll('.item').length).toBe(0);
  });

  it('shows the three most expensive and says so, and a search swaps them for matches', async () => {
    const { fixture, rail, el } = await open();
    vi.useFakeTimers();
    expect(el.querySelectorAll('.rail-list li').length).toBe(3);
    expect(el.textContent).toContain('Most expensive first.');
    rail.onSearch('alp');
    vi.advanceTimersByTime(300);
    const search = http.expectOne(r => r.url.endsWith('/industries/search'));
    expect(search.request.params.get('q')).toBe('alp');
    expect(search.request.params.get('limit')).toBe('10');
    search.flush([row(1, 'Alpha', 9)]);
    fixture.detectChanges();
    expect(el.querySelectorAll('.rail-list li').length).toBe(1);
    expect(el.textContent).not.toContain('Most expensive first.');
  });

  it('puts a company on once, with its rank from the top list, and turns its + off', async () => {
    const { fixture, rail, board, el } = await open();
    rail.addIndustry(row(2, 'Beta', 8));
    rail.addIndustry(row(2, 'Beta', 8));
    fixture.detectChanges();
    const items = board.doc().items;
    expect(items.length).toBe(1);
    expect(items[0].type === 'industry' && items[0].rank).toBe(2);
    expect(el.querySelector('.card-rank')?.textContent).toBe('#2');
    expect((el.querySelector('[aria-label="Beta is on the board"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('Drag it by the card. Use Line to point it at a note.');
  });

  it('refuses Office and text files in a toast that names them, and puts nothing on the board', async () => {
    const { fixture, files, board, el } = await open();
    vi.useFakeTimers();
    files.add([new File(['x'], 'Quarterly report.docx'), new File(['x'], 'notes.txt')]);
    fixture.detectChanges();
    http.expectNone(r => r.url.endsWith('/scratchpad/files'));
    const toast = el.querySelector('.toast')?.textContent ?? '';
    expect(toast).toContain("Word, PowerPoint and Excel files can't go on the board (Quarterly report.docx).");
    expect(toast).toContain("Text files can't go on the board (notes.txt). Copy the text and paste it instead.");
    expect(board.doc().items.length).toBe(0);
    vi.advanceTimersByTime(10_000);
    fixture.detectChanges();
    expect(el.querySelector('.toast')).toBeNull();
  });

  it('puts a file on at once, shows its upload, and keeps the id the API gives back', async () => {
    const { fixture, page, files, board, el } = await open();
    files.add([new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })]);
    fixture.detectChanges();
    const item = board.doc().items[0];
    expect(item.type === 'file' && item.fileId).toBeNull();
    expect(el.textContent).toContain('Uploading 0%');

    const upload = http.expectOne(r => r.url.endsWith('/scratchpad/files'));
    expect(upload.request.body instanceof FormData).toBe(true);
    upload.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    fixture.detectChanges();
    expect(el.textContent).toContain('Uploading 50%');

    upload.flush({ id: 41, name: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 2048 }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    const stored = board.doc().items[0];
    expect(stored.type === 'file' && stored.fileId).toBe(41);
    expect(el.querySelector('.file-meta')?.textContent).toBe('PDF, 2 KB');
    expect(el.querySelector('.context')?.textContent).toContain('plan.pdf, PDF, 2 KB');
    // Learning the id is not a step of its own: one undo takes the card off
    page.undo();
    expect(board.doc().items.length).toBe(0);
    page.redo();
    const back = board.doc().items[0];
    expect(back.type === 'file' && back.fileId).toBe(41);
  });

  it('shows a failed upload on the card with Try again, and Try again sends it again', async () => {
    const { fixture, files, el } = await open();
    // jsdom can't pass a Blob through the test HTTP client, so the picture's bytes come from a stub
    vi.spyOn(TestBed.inject(ScratchApi), 'fileBlob').mockReturnValue(of(new Blob(['gif'])));
    files.add([new File(['gif'], 'loop.gif', { type: 'image/gif' })]);
    http.expectOne(r => r.url.endsWith('/scratchpad/files')).flush('down', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(el.querySelector('.item[data-kind="file"].failed')).toBeTruthy();
    expect(el.querySelector('.file-meta')?.textContent).toBe("Couldn't upload");

    (el.querySelector('.file-retry') as HTMLButtonElement).click();
    http.expectOne(r => r.url.endsWith('/scratchpad/files')).flush({ id: 7, name: 'loop.gif', contentType: 'image/gif', sizeBytes: 3 }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el.querySelector('.item[data-kind="file"].failed')).toBeNull();
    expect(el.querySelector('img.file-picture')).toBeTruthy();
  });

  it('says plainly when a file card never finished uploading before a reload', async () => {
    const { el } = await open([{ id: 'f1', type: 'file', x: 0, y: 0, w: 270, h: 76, fileId: null, name: 'lost.zip', contentType: 'application/zip', sizeBytes: 9 }]);
    expect(el.querySelector('.file-meta')?.textContent).toContain("Couldn't upload. Remove it and add the file again");
    expect(el.querySelector('.file-retry')).toBeNull();
  });

  it('plays a video in place, fetching it only when Play is pressed', async () => {
    const blob = vi.spyOn(TestBed.inject(ScratchApi), 'fileBlob').mockReturnValue(of(new Blob(['mp4'])));
    const { fixture, el } = await open([{ id: 'v1', type: 'file', x: 0, y: 0, w: 320, h: 232, fileId: 5, name: 'demo.mp4', contentType: 'video/mp4', sizeBytes: 9 }]);
    expect(blob).not.toHaveBeenCalled();
    (el.querySelector('[aria-label="Play demo.mp4"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(blob).toHaveBeenCalledWith(5);
    expect(el.querySelector('video.file-video')).toBeTruthy();
  });

  it('gives a picked note the TEXT bar: bold, alignment and paper for the whole note, each one undo step', async () => {
    const { fixture, page, board, el } = await open();
    const id = board.place('note', 'auto', {})!;
    board.apply({ op: 'patch', ids: [id], patch: { blocks: [{ id: 'b', list: 'none', runs: [{ text: 'slow movers' }] }] } });
    fixture.detectChanges();
    expect(el.querySelector('.ctx-label')?.textContent).toBe('Text');
    const note = () => board.doc().items[0] as Extract<ReturnType<typeof board.doc>['items'][number], { type: 'note' | 'text' }>;

    (el.querySelector('[aria-label="Bold"]') as HTMLButtonElement).click();
    expect(note().blocks[0].runs[0].bold).toBe(true);
    (el.querySelector('[aria-label="Centre"]') as HTMLButtonElement).click();
    expect(note().align).toBe('center');
    (el.querySelector('[aria-label="Ink paper"]') as HTMLButtonElement).click();
    expect(note().tone).toBe('ink');

    page.undo();
    expect(note().tone).toBe('white');
    page.undo();
    expect(note().align).toBeUndefined();
  });

  it('says how many are picked and offers Group, Duplicate and Delete for several', async () => {
    const { fixture, board, el } = await open();
    board.place('note', 'auto', {});
    board.place('text', 'auto', {});
    board.selectAll();
    fixture.detectChanges();
    const bar = el.querySelector('.context')?.textContent ?? '';
    expect(bar).toContain('2 selected. Drag one to move all.');
    expect(bar).toContain('Group under a name');
    expect(bar).toContain('Duplicate');
    expect(bar).toContain('Delete all');
  });

  it('nudges with the arrow keys, a burst being one undo step, and Delete removes what is picked', async () => {
    const { page, board } = await open();
    vi.useFakeTimers();
    const id = board.place('note', 'auto', {})!;
    const start = board.doc().items[0];
    const key = (k: string, shift = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
    key('ArrowRight'); key('ArrowRight'); key('ArrowDown', true);
    expect(board.doc().items[0].x).toBe(start.x + 2);
    expect(board.doc().items[0].y).toBe(start.y + 10);
    vi.advanceTimersByTime(600);
    page.undo();
    expect(board.doc().items[0].x).toBe(start.x);
    expect(board.doc().items[0].y).toBe(start.y);

    board.pick(id);
    key('Delete');
    expect(board.doc().items.length).toBe(0);
  });

  it('after a conflict, offers to keep the changes as a new board or reload, and saves nothing over the other', async () => {
    const { fixture, board, el } = await open();
    vi.useFakeTimers();
    board.place('note', 'auto', {});
    vi.advanceTimersByTime(800);
    http.expectOne(r => r.method === 'PUT' && r.url === url + '/boards/1').flush('changed', { status: 409, statusText: 'Conflict' });
    await vi.advanceTimersByTimeAsync(0);
    board.place('text', 'auto', {});
    vi.advanceTimersByTime(130_000);
    http.expectNone(r => r.method === 'PUT');
    fixture.detectChanges();
    const pill = el.querySelector('.head-side')?.textContent ?? '';
    expect(pill).toContain('This board was changed somewhere else.');
    expect(pill).toContain('Keep mine as a new board');
    expect(pill).toContain('Reload (lose 2 changes)');
  });

  it('lists the boards on the History tab and opens one', async () => {
    const { fixture, el } = await open();
    params.next(convertToParamMap({ board: '1', tab: 'history' }));
    fixture.detectChanges();
    http.expectOne(url + '/boards').flush([
      { id: 1, name: 'My board', pinned: false, createdAt: 'a', updatedAt: '2026-10-09T08:00:00Z', things: 0 },
      { id: 2, name: 'Energy story', pinned: true, createdAt: 'a', updatedAt: '2026-10-08T08:00:00Z', things: 12 },
    ]);
    await tick();
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll('.bh-row')).map(one => one.textContent ?? '');
    expect(rows[0]).toContain('Energy story');
    expect(rows[0]).toContain('12 things');
    expect(rows[1]).toContain('Open now');
    // A pinned board can't be deleted until it is unpinned
    expect((el.querySelectorAll('.bh-row')[0].querySelector('.bh-btn.danger') as HTMLButtonElement).disabled).toBe(true);

    (el.querySelector('.bh-name') as HTMLButtonElement).click();
    await tick();
    expect(params.value.get('board')).toBe('2');
    expect(params.value.get('tab')).toBeNull();
  });
});

describe('board files', () => {
  it('refuses what the API refuses, with the same words', () => {
    expect(refusalFor({ name: 'deck.PPTX', size: 1 })).toBe("Word, PowerPoint and Excel files can't go on the board (deck.PPTX).");
    expect(refusalFor({ name: 'setup.exe', size: 1 })).toBe("That kind of file can't go on the board (setup.exe).");
    expect(refusalFor({ name: 'report.zip', size: 26 * 1024 * 1024 })).toBe('report.zip is bigger than 25 MB.');
    expect(refusalFor({ name: 'photo.jpg', size: 1024 })).toBeNull();
  });

  it('reads a type and a size people understand', () => {
    expect(typeLabel('a.tar.gz')).toBe('GZ');
    expect(typeLabel('README')).toBe('FILE');
    expect(sizeText(812 * 1024)).toBe('812 KB');
    expect(sizeText(3.44 * 1024 * 1024)).toBe('3.4 MB');
    expect(sizeText(18.4 * 1024 * 1024)).toBe('18 MB');
  });
});
