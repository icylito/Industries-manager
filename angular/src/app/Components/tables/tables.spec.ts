import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { TablesPage } from './tables';
import { Auth } from '../../services/auth';
import { AuthUser, Role, UserTable } from '../../models/industry';
import { environment } from '../../../environments/environment';

const url = `${environment.apiUrl}/tables`;
const leads: UserTable = {
  id: 7, name: 'Leads', rowCount: 2, createdBy: 'sam', createdAt: '', updatedAt: '', deletedAt: null, version: 3,
  columns: [
    { key: 'company', label: 'Company', type: 'text', required: true, maxLength: 40, min: null, max: null, custom: true, hidden: false },
    { key: 'score', label: 'Score', type: 'number', required: false, maxLength: null, min: 0, max: 100, custom: true, hidden: false },
    { key: 'old', label: 'Old', type: 'text', required: false, maxLength: null, min: null, max: null, custom: true, hidden: true },
  ],
};
const user = (role: Role): AuthUser => ({ id: 1, username: 'sam', role, disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });

describe('TablesPage', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function setup(role: Role, id: number | null = null) {
    params = new BehaviorSubject(convertToParamMap(id === null ? {} : { id: String(id) }));
    TestBed.configureTestingModule({
      imports: [TablesPage],
      // Saving a new table and deleting one navigate, so those addresses have to exist
      providers: [provideRouter([{ path: 'tables', children: [] }, { path: 'tables/:id', children: [] }]),
        provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params } }],
    });
    TestBed.inject(Auth).user.set(user(role));
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TablesPage);
    fixture.detectChanges();
    http.expectOne(url).flush([leads]);
    if (id !== null) {
      http.expectOne(r => r.url === `${url}/${id}/rows`).flush({
        total: 2, page: 1, size: 25,
        rows: [{ id: 1, data: { company: 'Acme', score: 80, old: 'kept' }, createdBy: 'sam', createdAt: '', updatedAt: 't1' },
               { id: 2, data: { company: 'Beta', score: null }, createdBy: 'sam', createdAt: '', updatedAt: 't2' }],
      });
    }
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const buttons = (f: { nativeElement: unknown }) => Array.from(el(f).querySelectorAll('button')).map(b => b.textContent?.trim());

  afterEach(() => http.verify());

  it('lists the tables with their visible column count', () => {
    const f = setup('manager');
    expect(el(f).querySelector('.table-card')?.textContent).toContain('Leads');
    expect(el(f).querySelector('.card-meta')?.textContent).toContain('2 rows');
    expect(el(f).querySelector('.card-meta')?.textContent).toContain('2 columns');
  });

  it('shows New table and the bin to a manager, and neither to a plain user', () => {
    expect(buttons(setup('manager'))).toEqual(expect.arrayContaining(['New table', 'Bin']));
    TestBed.resetTestingModule();
    const plain = buttons(setup('normal'));
    expect(plain).not.toContain('New table');
    expect(plain).not.toContain('Bin');
  });

  it('makes a table from a name and columns, with no key on a new column', () => {
    const f = setup('admin');
    const page = f.componentInstance;
    page.startNew();
    page.draftName.set('Deals');
    const uid = page.draftColumns()[0].uid;
    page.patchColumn(uid, { label: 'Stage', choices: 'Lead\nWon\n\n' });
    page.saveTable();
    const call = http.expectOne(r => r.method === 'POST' && r.url === url);
    expect(call.request.body).toEqual({
      name: 'Deals',
      columns: [{ key: null, label: 'Stage', type: 'text', required: false, maxLength: null, min: null, max: null, options: ['Lead', 'Won'] }],
    });
    call.flush({ ...leads, id: 9, name: 'Deals' });
  });

  it('refuses to send a column with no name', () => {
    const f = setup('admin');
    const page = f.componentInstance;
    page.startNew();
    page.draftName.set('Deals');
    page.saveTable();
    expect(page.editorError()).toBe('Every column needs a name');
    http.expectNone(r => r.method === 'POST');
  });

  it('drops limits that no longer fit when a column changes type', () => {
    const f = setup('admin');
    const page = f.componentInstance;
    page.startNew();
    const uid = page.draftColumns()[0].uid;
    page.patchColumn(uid, { maxLength: 20, choices: 'A' });
    page.patchColumn(uid, { type: 'number' });
    expect(page.draftColumns()[0]).toMatchObject({ type: 'number', maxLength: null, choices: '' });
  });

  it('edits columns with their keys and the table version, and names a removed one as hidden', () => {
    const f = setup('manager', 7);
    const page = f.componentInstance;
    page.startEdit();
    expect(page.draftColumns().map(c => c.key)).toEqual(['company', 'score']);
    page.removeColumn(page.draftColumns()[1].uid);
    expect(page.removedLabels()).toBe('Score');
    page.saveTable();
    const call = http.expectOne(r => r.method === 'PUT' && r.url === `${url}/7`);
    expect(call.request.body.version).toBe(3);
    expect(call.request.body.columns.map((c: { key: string }) => c.key)).toEqual(['company']);
    call.flush(leads);
    http.expectOne(r => r.url === `${url}/7/rows`).flush({ total: 0, page: 1, size: 25, rows: [] });
  });

  it('shows only the visible columns, and -- for an empty value', () => {
    const f = setup('normal', 7);
    const heads = Array.from(el(f).querySelectorAll('table thead th')).map(th => th.textContent?.trim());
    expect(heads).toEqual(['Company', 'Score']);
    expect(el(f).querySelectorAll('table tbody tr')[1].textContent).toContain('--');
    expect(el(f).querySelector('.actions')).toBeNull();
  });

  it('sends a number as a number and an empty box as nothing, and keeps the row time for the guard', () => {
    const f = setup('manager', 7);
    const page = f.componentInstance;
    page.openRowForm(page.rows()[0]);
    page.setValue('score', '81');
    page.setValue('company', '  ');
    page.saveRow();
    const call = http.expectOne(r => r.method === 'PUT' && r.url === `${url}/7/rows/1`);
    expect(call.request.body).toEqual({ values: { company: null, score: 81 }, updatedAt: 't1' });
    call.flush({ type: 'x', errors: { company: ['Company is required'] } }, { status: 400, statusText: 'Bad Request' });
    expect(page.rowErrors()).toEqual({ company: 'Company is required' });
  });

  it('only deletes a table once its name is typed', () => {
    const f = setup('manager', 7);
    const page = f.componentInstance;
    page.deleting.set(true);
    page.deleteTyped.set('lead');
    page.confirmDelete();
    http.expectNone(r => r.method === 'DELETE');
    page.deleteTyped.set(' LEADS ');
    expect(page.typedMatches()).toBe(true);
    page.confirmDelete();
    http.expectOne(r => r.method === 'DELETE' && r.url === `${url}/7`).flush({ deleted: 7, keptUntil: '' });
  });
});
