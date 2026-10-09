import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScratchpadPage } from './scratchpad';
import { Scratchpad } from '../../services/scratchpad';
import { environment } from '../../../environments/environment';
import { refusalFor, sizeText, typeLabel } from './board-files';
import { IndustryApi } from '../../services/industry-api';
import { of } from 'rxjs';

const url = environment.apiUrl + '/scratchpad';
const row = (id: number, name: string, price: number | null) => ({
  id, name, sector: 'Public Sector', price, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null,
});

describe('Scratchpad page', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScratchpadPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    // A picture's preview is an object URL, which jsdom's Blob can't make
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // The board, then the rail's top three. The rail never asks for the whole table.
  async function open(items: object[] = [], top = [row(1, 'Alpha', 9), row(2, 'Beta', 8), row(3, 'Gamma', 7)]) {
    const fixture = TestBed.createComponent(ScratchpadPage);
    fixture.detectChanges();
    http.expectOne(url).flush({ document: { version: 1, view: { x: 0, y: 0, zoom: 1 }, items }, updatedAt: null });
    http.expectOne(r => r.url.endsWith('/industries/top')).flush(top);
    http.expectNone(environment.apiUrl + '/industries');
    await fixture.whenStable();
    http.match(r => r.url.endsWith('/industries/by-ids')).forEach(r => r.flush([]));
    fixture.detectChanges();
    return fixture;
  }

  it('opens an empty board', async () => {
    const fixture = await open();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.canvas')).toBeTruthy();
    expect(el.querySelectorAll('.item').length).toBe(0);
    expect(el.textContent).toContain('Drag a company from the list');
  });

  it('adds a note and undo takes it away again', async () => {
    const fixture = await open();
    fixture.componentInstance.addNote();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.item').length).toBe(1);

    TestBed.inject(Scratchpad).undo();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.item').length).toBe(0);
  });

  it('shows the three most expensive and says so, and a search swaps them for matches', async () => {
    const fixture = await open();
    vi.useFakeTimers();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.rail-list li').length).toBe(3);
    expect(el.textContent).toContain('Most expensive first.');

    fixture.componentInstance.onSearch('alp');
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
    const fixture = await open();
    const page = fixture.componentInstance;
    page.addIndustry(row(2, 'Beta', 8));
    page.addIndustry(row(2, 'Beta', 8));
    fixture.detectChanges();
    const items = TestBed.inject(Scratchpad).board().items;
    expect(items.length).toBe(1);
    expect(items[0].rank).toBe(2);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.card-rank')?.textContent).toBe('#2');
    expect((el.querySelector('[aria-label="Beta is on the board"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('Drag it by the card. Use Line to join it to a note.');
  });

  it('refuses Office and text files in a toast that names them, and puts nothing on the board', async () => {
    const fixture = await open();
    vi.useFakeTimers();
    const page = fixture.componentInstance;
    page.addFiles([new File(['x'], 'Quarterly report.docx'), new File(['x'], 'notes.txt')]);
    fixture.detectChanges();
    http.expectNone(r => r.url.endsWith('/scratchpad/files'));
    const toast = (fixture.nativeElement as HTMLElement).querySelector('.toast')?.textContent ?? '';
    expect(toast).toContain("Word, PowerPoint and Excel files can't go on the board (Quarterly report.docx).");
    expect(toast).toContain("Text files can't go on the board (notes.txt). Copy the text and paste it instead.");
    expect(TestBed.inject(Scratchpad).board().items.length).toBe(0);

    vi.advanceTimersByTime(10_000);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.toast')).toBeNull();
  });

  it('puts a file on at once, shows its upload, and keeps the id the API gives back', async () => {
    const fixture = await open();
    const page = fixture.componentInstance;
    const pad = TestBed.inject(Scratchpad);
    page.addFiles([new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })]);
    fixture.detectChanges();
    const item = pad.board().items[0];
    expect(item.type).toBe('file');
    expect(item.fileId).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Uploading 0%');

    const upload = http.expectOne(r => r.url.endsWith('/scratchpad/files'));
    expect(upload.request.body instanceof FormData).toBe(true);
    upload.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Uploading 50%');

    upload.flush({ id: 41, name: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 2048 }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    expect(pad.board().items[0].fileId).toBe(41);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.file-meta')?.textContent).toBe('PDF, 2 KB');
    expect(el.querySelector('.context')?.textContent).toContain('plan.pdf, PDF, 2 KB');
  });

  it('shows a failed upload on the card with Try again, and Try again sends it again', async () => {
    const fixture = await open();
    const page = fixture.componentInstance;
    // jsdom can't pass a Blob through the test HTTP client, so the picture's bytes come from a stub
    vi.spyOn(TestBed.inject(IndustryApi), 'scratchFileBlob').mockReturnValue(of(new Blob(['gif'])));
    page.addFiles([new File(['gif'], 'loop.gif', { type: 'image/gif' })]);
    http.expectOne(r => r.url.endsWith('/scratchpad/files')).flush('down', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.item.file.failed')).toBeTruthy();
    expect(el.querySelector('.file-meta')?.textContent).toBe("Couldn't upload");

    (el.querySelector('.file-retry') as HTMLButtonElement).click();
    http.expectOne(r => r.url.endsWith('/scratchpad/files')).flush({ id: 7, name: 'loop.gif', contentType: 'image/gif', sizeBytes: 3 }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el.querySelector('.item.file.failed')).toBeNull();
    expect(el.querySelector('img.file-picture')).toBeTruthy();
  });

  it('says plainly when a file card never finished uploading before a reload', async () => {
    const fixture = await open([{ id: 'f1', type: 'file', x: 0, y: 0, w: 270, h: 76, fileId: null, name: 'lost.zip', contentType: 'application/zip', sizeBytes: 9 }]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.file-meta')?.textContent).toContain("Couldn't upload. Remove it and add the file again");
    expect((fixture.nativeElement as HTMLElement).querySelector('.file-retry')).toBeNull();
  });

  it('gives a picked note the TEXT bar: bold, alignment and paper for the whole note, each one undo step', async () => {
    const fixture = await open();
    const pad = TestBed.inject(Scratchpad);
    fixture.componentInstance.addNote();
    const id = pad.board().items[0].id;
    pad.blocksLive(id, [{ id: 'b', list: 'none', runs: [{ text: 'slow movers' }] }]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ctx-label')?.textContent).toBe('Text');

    (el.querySelector('[aria-label="Bold"]') as HTMLButtonElement).click();
    expect(pad.board().items[0].blocks?.[0].runs[0].bold).toBe(true);
    (el.querySelector('[aria-label="Centre"]') as HTMLButtonElement).click();
    expect(pad.board().items[0].align).toBe('center');
    (el.querySelector('[aria-label="Ink paper"]') as HTMLButtonElement).click();
    expect(pad.board().items[0].tone).toBe('ink');

    pad.undo();
    expect(pad.board().items[0].tone).toBe('white');
    pad.undo();
    expect(pad.board().items[0].align).toBeUndefined();
  });

  it('says how many are picked and offers Group under a name for several', async () => {
    const fixture = await open();
    const pad = TestBed.inject(Scratchpad);
    fixture.componentInstance.addNote();
    fixture.componentInstance.addText();
    pad.setSelection(pad.board().items.map(item => item.id));
    fixture.detectChanges();
    const bar = (fixture.nativeElement as HTMLElement).querySelector('.context')?.textContent ?? '';
    expect(bar).toContain('2 selected. Drag one to move all.');
    expect(bar).toContain('Group under a name');
    expect(bar).toContain('Delete all');
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
