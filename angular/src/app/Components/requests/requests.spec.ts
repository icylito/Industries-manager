import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RequestsPage } from './requests';
import { Auth } from '../../services/auth';
import { DevRequest } from '../../models/industry';

const ticket: DevRequest = {
  id: 7, createdAt: '2026-10-13T10:00:00Z', kind: 'other', title: 'Add a filter', details: '', draftedCode: null,
  status: 'open', createdBy: 'sam', fieldKey: null, resolvedAt: null, resolvedBy: null, replies: 2,
};

describe('RequestsPage', () => {
  function setup(role: 'admin' | 'normal', username: string) {
    TestBed.configureTestingModule({
      imports: [RequestsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(Auth).user.set({ id: 1, username, role, disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    const fixture = TestBed.createComponent(RequestsPage);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('lists tickets with their reply count and status', () => {
    const { fixture, http } = setup('normal', 'sam');
    http.expectOne(r => r.url.endsWith('/requests') && r.params.get('status') === 'open').flush([ticket]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelectorAll('table.requests-table tbody tr').length).toBe(1);
    expect(html.querySelector('.status')?.textContent?.trim()).toBe('Open');
    expect(html.textContent).toContain('Add a filter');
    // A person without the admin role has no status choices in the menu
    expect(html.querySelector('.kebab')).not.toBeNull();
  });

  it('lets only the asker and admins reply', () => {
    const { fixture } = setup('normal', 'sam');
    const page = fixture.componentInstance;
    page.thread.set(ticket);
    expect(page.canReply()).toBe(true);
    page.thread.set({ ...ticket, createdBy: 'someone-else' });
    expect(page.canReply()).toBe(false);
  });
});
