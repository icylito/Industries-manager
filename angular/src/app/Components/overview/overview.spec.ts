import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OverviewPage } from './overview';
import { Shortcuts } from '../../services/shortcuts';

const row = (id: number, over: object = {}) => ({ id, name: 'Row ' + id, sector: 'Public Sector', price: 1, release: '2012-06-01', duplicateOf: null, importedFrom: null, lostFields: null, extra: null, ...over });

describe('OverviewPage', () => {
  let fixture: ComponentFixture<OverviewPage>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [OverviewPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  const load = (rows: object[]) => {
    http.expectOne(r => r.url.endsWith('/industries')).flush(rows);
    http.match(r => r.url.endsWith('/schema')).forEach(r => r.flush({ version: 1, createdAt: '', changedBy: '', note: null, fields: [] }));
    fixture.detectChanges();
  };

  it('shows grey blocks while loading, then the page', () => {
    expect(el().querySelector('.skeleton')).not.toBeNull();
    load([row(1), row(2, { sector: 'Private Sector' })]);
    expect(el().querySelector('.skeleton')).toBeNull();
    expect(el().querySelector('h1')?.textContent).toBe('All industries');
    expect(el().querySelector('.centre-label')?.textContent).toContain('All industries');
  });

  it('explains an empty table instead of drawing empty charts', () => {
    load([]);
    expect(el().querySelector('.empty-card h2')?.textContent).toBe('No industries yet');
    expect(el().querySelector('.donut')).toBeNull();
  });

  it('says it could not load, in plain words, with the technical line behind a link', () => {
    // The service retries a 503 on a timer before the page hears about it, so the failed state is set directly here
    http.expectOne(r => r.url.endsWith('/industries'));
    const page = fixture.componentInstance;
    page.failure.set('no response from the server');
    page.loading.set(false);
    fixture.detectChanges();
    expect(el().querySelector('.notice-card h2')?.textContent).toContain("couldn't load");
    expect(el().querySelector('.details')).toBeNull();
    (el().querySelector('.link-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('.details')?.textContent).toContain('GET /industries failed');
  });

  it('links to Browse with exactly the picked rows, and hides the link when nothing is picked', () => {
    load([row(1, { sector: 'Private Sector' }), row(2), row(3, { sector: 'Private Sector', duplicateOf: 1 })]);
    expect(el().querySelector('a.open-btn')).toBeNull();
    const page = fixture.componentInstance;
    page.togglePick('Private Sector');
    page.toggleAttention('dup');
    fixture.detectChanges();
    const link = el().querySelector('a.open-btn') as HTMLAnchorElement;
    expect(link.textContent).toContain('Open 1 in Browse');
    const url = new URL(link.href, 'http://x');
    expect(url.searchParams.get('sector')).toBe('Private Sector');
    expect(url.searchParams.get('flags')).toBe('duplicate');
    expect(url.hash).toBe('#browse');
    // Filters that match nothing together say so and hide the link
    page.toggleAttention('lost');
    page.toggleAttention('dup');
    fixture.detectChanges();
    expect(el().querySelector('.nomatch')).not.toBeNull();
    expect(el().querySelector('a.open-btn')).toBeNull();
  });

  it('runs its functions from the keys, and lets go of them when it closes', () => {
    load([row(1), row(2)]);
    const keys = TestBed.inject(Shortcuts);
    expect(keys.hasPage()).toBe(true);
    keys.onKey(new KeyboardEvent('keydown', { key: 'c' }));
    expect(fixture.componentInstance.sel().cmp).toBe(true);
    fixture.destroy();
    expect(keys.hasPage()).toBe(false);
  });
});
