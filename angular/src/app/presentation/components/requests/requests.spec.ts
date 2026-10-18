import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RequestsPage } from './requests';
import { Auth } from '../../../application/auth';
import { DevRequest } from '../../../domain/models/industry';

const ticket: DevRequest = {
  id: 7,
  createdAt: '2026-10-13T10:00:00Z',
  kind: 'other',
  title: 'Add a filter',
  details: '',
  draftedCode: null,
  status: 'open',
  createdBy: 'sam',
  fieldKey: null,
  resolvedAt: null,
  resolvedBy: null,
  replies: 2,
};

describe('RequestsPage', () => {
  function setup(role: 'admin' | 'normal', username: string) {
    TestBed.configureTestingModule({
      imports: [RequestsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(Auth).user.set({
      id: 1,
      username,
      role,
      disabled: false,
      mustChangePassword: false,
      createdAt: '',
      lastLoginAt: null,
    });
    const fixture = TestBed.createComponent(RequestsPage);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('lists tickets with their reply count and status', () => {
    const { fixture, http } = setup('normal', 'sam');
    http
      .expectOne((r) => r.url.endsWith('/requests') && r.params.get('status') === 'open')
      .flush([ticket]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelectorAll('table.requests-table tbody tr').length).toBe(1);
    expect(html.querySelector('.status')?.textContent?.trim()).toBe('Open');
    expect(html.textContent).toContain('Add a filter');
    expect(html.querySelector('.kebab')).not.toBeNull();
  });

  it('keeps the list to the quick info, with one action', () => {
    const { fixture, http } = setup('normal', 'sam');
    http.expectOne((r) => r.url.endsWith('/requests')).flush([ticket]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const heads = [...html.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(heads).toEqual(['#', 'Ticket', 'Created by', 'Status', 'Action']);
    html.querySelector<HTMLButtonElement>('.kebab')!.click();
    fixture.detectChanges();
    const items = [...html.querySelectorAll('.row-menu [role="menuitem"]')].map((b) =>
      b.textContent?.trim(),
    );
    expect(items).toEqual(['Open ticket']);
  });

  it('shows everything about a ticket inside it', () => {
    const { fixture } = setup('normal', 'sam');
    const page = fixture.componentInstance;
    page.ticketId.set(7);
    page.threadLoading.set(false);
    page.thread.set({
      ...ticket,
      details: 'Filter by **sector**',
      resolvedAt: '2026-10-14T09:00:00Z',
      resolvedBy: 'boss',
      status: 'done',
    });
    page.messages.set([
      {
        id: 1,
        requestId: 7,
        createdAt: '2026-10-13T11:00:00Z',
        author: 'sam',
        fromDeveloper: false,
        body: 'Any news?',
      },
      {
        id: 2,
        requestId: 7,
        createdAt: '2026-10-13T12:00:00Z',
        author: 'dev',
        fromDeveloper: true,
        body: 'On it',
      },
    ]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const facts = Object.fromEntries(
      [...html.querySelectorAll('.ticket-facts > div')].map((d) => [
        d.querySelector('dt')!.textContent!.trim(),
        d.querySelector('dd')!.textContent!.trim(),
      ]),
    );
    expect(Object.keys(facts)).toEqual([
      'Created by',
      'Created at',
      'Type',
      'Replies',
      'Last reply',
      'Closed',
      'Status',
    ]);
    expect(facts['Status']).toBe('Done');
    expect(facts['Created by']).toBe('sam');
    expect(facts['Replies']).toBe('2');
    expect(facts['Last reply']).toContain('by dev');
    expect(facts['Closed']).toContain('by boss');
    expect(html.querySelector('.ticket-details span.b')?.textContent).toBe('sector');
  });

  it('only reads the status in the list, even for an admin', () => {
    const { fixture, http } = setup('admin', 'boss');
    http.expectOne((r) => r.url.endsWith('/requests')).flush([ticket]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.requests-table .status-trigger')).toBeNull();
    expect(html.querySelector('.requests-table .status')?.textContent?.trim()).toBe('Open');
  });

  it('picks which tickets show from one drop down', () => {
    const { fixture, http } = setup('normal', 'sam');
    http.expectOne((r) => r.params.get('status') === 'open').flush([ticket]);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const trigger = html.querySelector<HTMLButtonElement>('.filter-menu .status-trigger')!;
    expect(trigger.textContent?.trim()).toBe('Open');
    trigger.click();
    fixture.detectChanges();
    const options = [...html.querySelectorAll<HTMLButtonElement>('.filter-menu [role="option"]')];
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Open',
      'In progress',
      'Done',
      'Dismissed',
      'All',
    ]);
    options[2].click();
    http.expectOne((r) => r.params.get('status') === 'done').flush([]);
    fixture.detectChanges();
    expect(html.querySelector('.filter-menu .status-list')).toBeNull();
    expect(trigger.textContent?.trim()).toBe('Done');
  });

  it('asks for a new ticket in a pop up that keeps the text until it is sent', () => {
    const { fixture, http } = setup('normal', 'sam');
    http.expectOne((r) => r.url.endsWith('/requests')).flush([]);
    const page = fixture.componentInstance;
    const html = fixture.nativeElement as HTMLElement;
    page.openAsk();
    fixture.detectChanges();
    expect(html.querySelector('section.modal[role="dialog"][aria-modal="true"]')).not.toBeNull();

    // A stray close keeps what was typed
    page.title.set('Add a sector filter');
    page.closeAsk();
    fixture.detectChanges();
    expect(html.querySelector('section.modal')).toBeNull();
    page.openAsk();
    expect(page.title()).toBe('Add a sector filter');

    // While it sends, Escape and the backdrop can't close it
    page.send();
    page.onEscape();
    expect(page.asking()).toBe(true);

    // A failed send keeps the text and shows why inside the pop up
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/requests'))
      .flush({ error: 'Too long' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(page.asking()).toBe(true);
    expect(page.title()).toBe('Add a sector filter');
    expect(html.querySelector('section.modal .field-error')).not.toBeNull();

    // A good send clears it, closes the pop up and says so above the list
    page.send();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/requests'))
      .flush({ ...ticket, id: 8 }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    expect(page.asking()).toBe(false);
    expect(page.title()).toBe('');
    expect(page.sent()).toContain('Sent');
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
