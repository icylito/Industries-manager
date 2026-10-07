import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MyComponents } from './my-components';
import { Auth } from '../../services/auth';

describe('MyComponents', () => {
  let component: MyComponents;
  let fixture: ComponentFixture<MyComponents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponents],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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
    const row = { id: 1, name: 'Alpha', sector: 'Public Sector', price: 1, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null };
    http.match(r => r.url.endsWith('/health')).forEach(r => r.flush({ state: 'ready', message: '', attempts: 1, appliedMigrations: [], updatedAt: '', history: { ready: true, message: '' } }));
    http.match(r => r.url.endsWith('/schema')).forEach(r => r.flush({ version: 1, createdAt: '', changedBy: '', note: null, fields: [] }));
    http.match(r => r.url.endsWith('/industries')).forEach(r => r.flush([row]));
    http.expectNone(r => r.url.includes('/requests'));
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('form')).toBeNull();
    expect(html.querySelector('th.actions-col')).toBeNull();
    expect(html.querySelector('td.actions')).toBeNull();

    // With an account all three are there
    TestBed.inject(Auth).user.set({ id: 1, username: 'sam', role: 'normal', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    fixture.detectChanges();
    expect(html.querySelector('form')).not.toBeNull();
    expect(html.querySelector('th.actions-col')).not.toBeNull();
    expect(html.querySelector('td.actions')).not.toBeNull();
  });

  it('deletes only after the row asks, and never uses the browser popup', () => {
    const http = TestBed.inject(HttpTestingController);
    const confirmSpy = vi.spyOn(window, 'confirm');
    component.industries.set([
      { id: 1, name: 'Alpha', sector: 'Public Sector', price: 1, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null },
      { id: 2, name: 'Beta', sector: 'Public Sector', price: 2, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null },
    ]);

    component.confirmingId.set(1);
    http.expectNone(r => r.method === 'DELETE');

    component.remove(1);
    expect(component.deletingId()).toBe(1);
    http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/industries/1')).flush({ deleted: 1, table: 'Industries', id: 1, name: 'Alpha' });

    expect(component.industries().map(i => i.id)).toEqual([2]);
    expect(component.deleted()).toBe('Deleted 1 row from Industries: Alpha.');
    expect(component.confirmingId()).toBeNull();
    expect(component.deletingId()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
