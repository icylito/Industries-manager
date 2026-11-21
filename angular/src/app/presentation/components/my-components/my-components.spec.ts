import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ElementRef } from '@angular/core';
import { convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MyComponents } from './my-components';
import { Auth } from '../../../application/auth';
import { provideInfrastructure } from '../../../infrastructure/providers';

describe('MyComponents', () => {
  let component: MyComponents;
  let fixture: ComponentFixture<MyComponents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponents],
      providers: [
        ...provideInfrastructure(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponents);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // E9: a guest sees the table and nothing else
  it('shows a guest no Add form, no Actions column, and asks for no requests', async () => {
    const http = TestBed.inject(HttpTestingController);
    const row = {
      id: 1,
      name: 'Alpha',
      sector: 'Public Sector',
      price: 1,
      release: null,
      duplicateOf: null,
      importedFrom: null,
      lostFields: null,
      extra: null,
    };
    http
      .match((r) => r.url.endsWith('/health'))
      .forEach((r) =>
        r.flush({
          state: 'ready',
          message: '',
          attempts: 1,
          appliedMigrations: [],
          updatedAt: '',
          history: { ready: true, message: '' },
        }),
      );
    http
      .match((r) => r.url.endsWith('/schema'))
      .forEach((r) =>
        r.flush({ version: 1, createdAt: '', changedBy: '', note: null, fields: [] }),
      );
    http.match((r) => r.url.endsWith('/industries')).forEach((r) => r.flush([row]));
    http.expectNone((r) => r.url.includes('/requests'));
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('form')).toBeNull();
    expect(html.querySelector('th.actions-col')).toBeNull();
    expect(html.querySelector('td.actions')).toBeNull();

    // With an account all three are there
    TestBed.inject(Auth).user.set({
      id: 1,
      username: 'sam',
      role: 'normal',
      disabled: false,
      mustChangePassword: false,
      createdAt: '',
      lastLoginAt: null,
    });
    fixture.detectChanges();
    // The form is in the pop up the Add button opens
    expect(html.querySelector('form')).toBeNull();
    (html.querySelector('.tools .add-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(html.querySelector('form')).not.toBeNull();
    expect(html.querySelector('th.actions-col')).not.toBeNull();
    expect(html.querySelector('td.actions')).not.toBeNull();
  });

  it('tags a row New or Updated from its recent activity, and offers the sectors the table has', () => {
    component.industries.set([
      {
        id: 1,
        name: 'Alpha',
        sector: 'Energy',
        price: 1,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
      {
        id: 2,
        name: 'Beta',
        sector: 'Retail',
        price: 2,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
    ]);
    // New lasts a week from when the row was added, so the dates are worked out from today
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    component.activity.set(
      new Map([
        [1, { added: daysAgo(2), edited: null }],
        [2, { added: daysAgo(9), edited: daysAgo(1) }],
        [4, { added: daysAgo(8), edited: null }],
      ]),
    );
    expect(component.tag(1)).toBe('new');
    expect(component.tag(2)).toBe('updated');
    expect(component.tag(3)).toBeNull();
    expect(component.tag(4)).toBeNull();
    // With no list in the rules the form offers whatever the table already uses
    expect(component.sectorChoices()).toEqual(['Energy', 'Retail']);
  });

  it('scrolls the calendar into view when it opens, so its bottom is not cut off', () => {
    vi.useFakeTimers();
    try {
      // A stand-in for the calendar box, the test page does not draw the form that holds it
      const scroll = vi.fn();
      component.calendarBox = {
        nativeElement: { scrollIntoView: scroll },
      } as unknown as ElementRef<HTMLElement>;
      component.toggleCalendar();
      vi.runAllTimers();
      expect(component.calendarOpen()).toBe(true);
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes only after the row asks, and never uses the browser popup', () => {
    const http = TestBed.inject(HttpTestingController);
    const confirmSpy = vi.spyOn(window, 'confirm');
    component.industries.set([
      {
        id: 1,
        name: 'Alpha',
        sector: 'Public Sector',
        price: 1,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
      {
        id: 2,
        name: 'Beta',
        sector: 'Public Sector',
        price: 2,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
    ]);

    component.confirmingId.set(1);
    http.expectNone((r) => r.method === 'DELETE');

    component.remove(1);
    expect(component.deletingId()).toBe(1);
    http
      .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/industries/1'))
      .flush({ deleted: 1, table: 'Industries', id: 1, name: 'Alpha' });

    expect(component.industries().map((i) => i.id)).toEqual([2]);
    expect(component.deleted()).toBe('Deleted 1 row from Industries: Alpha.');
    expect(component.confirmingId()).toBeNull();
    expect(component.deletingId()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('clears the delete message after ten seconds and drops a sector nobody has any more', () => {
    vi.useFakeTimers();
    const http = TestBed.inject(HttpTestingController);
    component.industries.set([
      {
        id: 1,
        name: 'Alpha',
        sector: 'Oil',
        price: 1,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
      {
        id: 2,
        name: 'Beta',
        sector: 'Public Sector',
        price: 2,
        release: null,
        duplicateOf: null,
        importedFrom: null,
        lostFields: null,
        extra: null,
      },
    ]);
    component.sectorFilter.set('Oil');

    component.remove(1);
    http
      .expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/industries/1'))
      .flush({ deleted: 1, table: 'Industries', id: 1, name: 'Alpha' });

    expect(component.sectorFilter()).toBe('');
    expect(component.deleted()).toBe('Deleted 1 row from Industries: Alpha.');
    vi.advanceTimersByTime(9999);
    expect(component.deleted()).not.toBe('');
    vi.advanceTimersByTime(1);
    expect(component.deleted()).toBe('');
    vi.useRealTimers();
  });

  it('sends the row as Edit found it, and offers their version when someone changed it meanwhile', () => {
    const http = TestBed.inject(HttpTestingController);
    // jsdom has no scrolling, Edit scrolls the form into view
    Element.prototype.scrollIntoView ??= () => {};
    const alpha = {
      id: 1,
      name: 'Alpha',
      sector: 'Public Sector',
      price: 1,
      release: null,
      duplicateOf: null,
      importedFrom: null,
      lostFields: null,
      extra: { ticker: 'AL' },
    };
    component.industries.set([alpha]);
    component.edit(alpha);
    component.form.controls.price.setValue(2);
    component.submit();
    const save = http.expectOne(
      (r) => r.method === 'PUT' && r.url.endsWith('/industries/update/1'),
    );
    expect(save.request.body.price).toBe(2);
    expect(save.request.body.original).toEqual({
      name: 'Alpha',
      sector: 'Public Sector',
      price: 1,
      release: null,
      extra: { ticker: 'AL' },
    });
    save.flush(
      'Someone changed this row since you opened it. Load their version, then make your change again',
      { status: 409, statusText: 'Conflict' },
    );
    expect(component.changedMeanwhile()).toBe(true);
    expect(component.editingId()).toBe(1);

    component.loadTheirVersion();
    const theirs = { ...alpha, name: 'Alpha Renamed', price: 7 };
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/industries/1')).flush(theirs);
    expect(component.form.controls.name.value).toBe('Alpha Renamed');
    expect(component.changedMeanwhile()).toBe(false);
    expect(component.editingOriginal()?.price).toBe(7);
    expect(component.industries()[0].name).toBe('Alpha Renamed');
  });

  // The Overview opens Browse with filters in the address. The count has to match what the Overview showed.
  describe('filters from the address', () => {
    const row = (id: number, over: object = {}) => ({
      id,
      name: 'Row ' + id,
      sector: 'Public Sector',
      price: 1,
      release: '2012-06-01',
      duplicateOf: null,
      importedFrom: null,
      lostFields: null,
      extra: null,
      ...over,
    });
    const open = (params: Record<string, string>, rows: object[]) => {
      const page = component as any;
      page.seedFromAddress(convertToParamMap(params));
      component.industries.set(rows as any);
      component.loading.set(false);
      page.finishSeeding();
    };
    const ids = () => component.filtered().map((i) => i.id);

    it('reads the sector, the prices and the dates', () => {
      open(
        {
          sector: 'Private Sector',
          minPrice: '2.5',
          maxPrice: '4.9999',
          releaseFrom: '2010-01-01',
          releaseTo: '2014-12-31',
        },
        [
          row(1, { sector: 'Private Sector', price: 2.5, release: '2014-12-31' }),
          row(2, { sector: 'Private Sector', price: 2.4999, release: '2014-12-31' }),
          row(3, { sector: 'Private Sector', price: 5, release: '2014-12-31' }),
          row(4, { sector: 'Private Sector', price: 3, release: '2015-01-01' }),
          row(5, { sector: 'Private Sector', price: 3, release: null }),
          row(6, { sector: 'Public Sector', price: 3, release: '2012-01-01' }),
          row(7, { sector: 'Private Sector', price: null, release: '2012-01-01' }),
          row(8, { sector: 'Private Sector', price: 4.9999, release: '2010-01-01' }),
        ],
      );
      expect(ids()).toEqual([1, 8]);
      expect(component.hasFilters()).toBe(true);
    });

    it('counts several flags as OR, and the flags together as one term next to the other filters', () => {
      const rows = [
        row(1, { sector: 'Private Sector', duplicateOf: 9 }),
        row(2, { sector: 'Private Sector', lostFields: ['price'] }),
        row(3, { sector: 'Private Sector' }),
        row(4, { sector: 'Public Sector', duplicateOf: 9 }),
        row(5, { sector: 'Private Sector', price: null }),
      ];
      open({ sector: 'Private Sector', flags: 'duplicate,lost' }, rows);
      expect(ids()).toEqual([1, 2]);
      component.clearFilters();
      component.toggleFlag('noprice');
      component.toggleFlag('nodate');
      expect(ids()).toEqual([5]);
    });

    it('ignores what it does not know and still shows the table', () => {
      open(
        {
          sector: 'Nope',
          flags: 'banana,lost',
          minPrice: 'abc',
          releaseFrom: '2010-13-45',
          releaseTo: 'soon',
        },
        [row(1), row(2, { lostFields: ['name'] })],
      );
      expect(component.sectorFilter()).toBe('');
      expect(component.minPrice()).toBeNull();
      expect(component.releaseFrom()).toBeNull();
      expect(component.releaseTo()).toBeNull();
      expect([...component.flagFilter()]).toEqual(['lost']);
      expect(ids()).toEqual([2]);
      // A flag it doesn't know on its own leaves the table whole
      component.clearFilters();
      open({ flags: 'banana' }, [row(1)]);
      expect(ids()).toEqual([1]);
    });

    it('shows the whole table with no address at all, and clearing leaves nothing behind', () => {
      open({}, [row(1), row(2)]);
      expect(ids()).toEqual([1, 2]);
      expect(component.hasFilters()).toBe(false);
      open({ q: 'Row 2', releaseFrom: '2012-01-01', flags: 'duplicate' }, [
        row(1),
        row(2, { duplicateOf: 1 }),
      ]);
      expect(ids()).toEqual([2]);
      component.clearFilters();
      expect(component.hasFilters()).toBe(false);
      expect(component.releaseFrom()).toBeNull();
      expect(component.flagFilter().size).toBe(0);
    });

    it('opens one row ready to edit for a person who is signed in, and ignores an id that is not there', () => {
      // jsdom has no scrollIntoView, the form scrolls into view in a real browser
      Element.prototype.scrollIntoView = () => {};
      TestBed.inject(Auth).user.set({
        id: 1,
        username: 'sam',
        role: 'admin',
        disabled: false,
        mustChangePassword: false,
        createdAt: '',
        lastLoginAt: null,
      });
      open({ edit: '2' }, [row(1), row(2, { name: 'Second' })]);
      expect(component.editingId()).toBe(2);
      expect(component.form.controls.name.value).toBe('Second');
      component.cancelEdit();
      open({ edit: '99' }, [row(1)]);
      expect(component.editingId()).toBeNull();
    });
  });

  // A filter only shows when the whole loaded table has something it could match, and a filter
  // that is switched on stays visible so it can always be cleared. Everything shows while loading.
  describe('filters with nothing to match', () => {
    const row = (id: number, over: object = {}) => ({
      id,
      name: 'Row ' + id,
      sector: 'Public Sector',
      price: 1,
      release: '2012-06-01',
      duplicateOf: null,
      importedFrom: null,
      lostFields: null,
      extra: null,
      ...over,
    });
    const flagKeys = () => component.visibleFlags().map((f) => f.key);

    it('hides a flag chip no row has, and keeps one that is switched on', () => {
      component.loading.set(false);
      component.industries.set([row(1), row(2, { price: null })]);
      expect(flagKeys()).toEqual(['noprice']);
      component.toggleFlag('duplicate');
      expect(flagKeys()).toEqual(['duplicate', 'noprice']);
    });

    it('hides the price and date boxes when no row has one', () => {
      component.loading.set(false);
      component.industries.set([row(1, { price: null, release: null })]);
      expect(component.showPrice()).toBe(false);
      expect(component.showDates()).toBe(false);
      component.minPrice.set(2);
      expect(component.showPrice()).toBe(true);
    });

    it('hides Sector when there is only one, and keeps it when one is chosen', () => {
      component.loading.set(false);
      component.industries.set([row(1), row(2)]);
      expect(component.showSector()).toBe(false);
      component.sectorFilter.set('Public Sector');
      expect(component.showSector()).toBe(true);
    });

    it('shows every control while the first load is still running', () => {
      component.loading.set(true);
      component.industries.set([]);
      expect(component.showSector()).toBe(true);
      expect(component.showPrice()).toBe(true);
      expect(component.showDates()).toBe(true);
      expect(flagKeys().length).toBe(4);
    });
  });
});
