import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersPage } from './users';
import { Auth } from '../../services/auth';
import { AuthUser } from '../../models/industry';

// E7: the add box, and the temporary password panel
describe('UsersPage', () => {
  let http: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/users')).flush([]);
    return fixture;
  }

  it('trims and lower cases the name before sending, and sends nothing for an empty one', () => {
    const page = setup().componentInstance;
    page.newName.set('   ');
    page.add();
    expect(page.addError()).toBe('Type a username');
    http.expectNone(r => r.method === 'POST');

    page.newName.set('  Sam.Lee ');
    page.add();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/users'));
    expect(call.request.body).toEqual({ username: 'sam.lee', role: 'normal' });
    call.flush({ user: { id: 2, username: 'sam.lee', role: 'normal', disabled: false, mustChangePassword: true, createdAt: '', lastLoginAt: null }, temporaryPassword: 'abcdefgh23456789' });
    expect(page.shown()?.password).toBe('abcdefgh23456789');
    http.expectOne(r => r.url.endsWith('/users')).flush([]);
  });

  it('says to copy by hand when the browser has no clipboard, and forgets the password when the page is left', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.shown.set({ username: 'sam', password: 'abcdefgh23456789', created: true });
    const saved = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      page.copy('abcdefgh23456789');
      expect(page.copied()).toBe(false);
      expect(page.copyNote()).toBe('Select the password and copy it yourself');
    } finally {
      if (saved) Object.defineProperty(Navigator.prototype, 'clipboard', saved);
      delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
    fixture.destroy();
    expect(page.shown()).toBeNull();
    expect(page.copyNote()).toBe('');
  });

  it('says to copy by hand when the clipboard refuses', async () => {
    const page = setup().componentInstance;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    try {
      page.copy('abcdefgh23456789');
      await Promise.resolve(); await Promise.resolve();
      expect(page.copyNote()).toBe('Select the password and copy it yourself');
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
  });
});

// One standing button and a menu behind the hamburger, with a question before anything that takes access away
describe('UsersPage row actions', () => {
  let http: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<UsersPage>>;

  const me = { id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null } as AuthUser;
  const them = { id: 2, username: 'icy', role: 'normal', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null } as AuthUser;

  const el = () => fixture.nativeElement as HTMLElement;
  const row = () => el().querySelectorAll('tbody tr')[1] as HTMLElement;
  const items = () => [...el().querySelectorAll('.menu [role="menuitem"]')].map(b => b.textContent?.trim());

  function setup(list: AuthUser[] = [me, them]) {
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set(me);
    fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/users')).flush(list);
    fixture.detectChanges();
    return fixture;
  }

  const openMenu = () => {
    (row().querySelector('.menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('leaves one New password button, with the rest behind the hamburger', () => {
    setup();

    expect(row().querySelector('.menu')).toBeNull();
    expect(row().querySelector('.edit-btn')?.textContent).toContain('New password');
    expect(row().textContent).not.toContain('Make admin');
    expect(row().textContent).not.toContain('Turn off');
  });

  it('offers turn off, make admin and delete account in the menu', () => {
    setup();
    openMenu();

    expect(items()).toEqual(['Turn off', 'Make admin', 'Rename', 'Notes', 'Delete account']);
  });

  // Seen in a real browser: inside the table the menu was clipped by the table's own scroll box, so only a sliver showed
  it('puts the menu outside the table, and positions it against the button', () => {
    setup();
    openMenu();

    const menu = el().querySelector('.menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(el().querySelector('table .menu')).toBeNull();
    expect(menu.style.top).not.toBe('');
    expect(menu.style.right).not.toBe('');
  });

  it('warns before it makes someone an admin, and sends nothing until then', () => {
    setup();
    openMenu();
    ([...el().querySelectorAll('.menu [role="menuitem"]')].find(b => b.textContent?.includes('Make admin')) as HTMLButtonElement).click();
    fixture.detectChanges();

    const pop = el().querySelector('.confirm-pop');
    expect(pop?.getAttribute('role')).toBe('alertdialog');
    expect(pop?.textContent).toContain('Are you sure you want to make this user an admin?');
    expect(pop?.textContent).toContain('change rules, restore history and answer requests');
    http.expectNone(r => r.method === 'PUT');

    (pop?.querySelector('.add-btn') as HTMLButtonElement).click();
    const call = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/users/2'));
    expect(call.request.body).toEqual({ role: 'admin' });
    call.flush(them);
    http.expectOne(r => r.url.endsWith('/users')).flush([me, them]);
  });

  it('asks before deleting an account, then deletes it', () => {
    setup();
    openMenu();
    ([...el().querySelectorAll('.menu [role="menuitem"]')].find(b => b.textContent?.includes('Delete account')) as HTMLButtonElement).click();
    fixture.detectChanges();

    const pop = el().querySelector('.confirm-pop');
    expect(pop?.textContent).toContain("Are you sure you want to delete icy's account?");
    expect(pop?.textContent).toContain('Their name stays on what History already recorded');
    http.expectNone(r => r.method === 'DELETE');

    (pop?.querySelector('.remove-btn') as HTMLButtonElement).click();
    const call = http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/users/2'));
    call.flush({ deleted: 1, username: 'icy' });
    http.expectOne(r => r.url.endsWith('/users')).flush([me]);
  });

  const pick = (label: string) =>
    ([...el().querySelectorAll('.menu [role="menuitem"]')].find(b => b.textContent?.includes(label)) as HTMLButtonElement).click();

  it('renames someone from the menu, and says what History keeps', () => {
    setup();
    openMenu();
    pick('Rename');
    fixture.detectChanges();

    const pop = el().querySelector('.confirm-pop');
    expect(pop?.textContent).toContain('History already recorded');
    const box = pop?.querySelector('input') as HTMLInputElement;
    expect(box.value).toBe('icy');

    box.value = 'ice';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (pop?.querySelector('.add-btn') as HTMLButtonElement).click();

    const call = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/users/2'));
    expect(call.request.body).toEqual({ username: 'ice' });
    call.flush({ ...them, username: 'ice' });
    http.expectOne(r => r.url.endsWith('/users')).flush([me, { ...them, username: 'ice' }]);
  });

  it('marks the people who have a note, without showing what it says', () => {
    setup([me, { ...them, hasNotes: true }]);

    expect(el().querySelectorAll('tbody tr')[0].querySelector('.note-tag')).toBeNull();
    expect(row().querySelector('.note-tag')?.textContent).toContain('Note');
  });

  it('shows the notes an admin kept about someone, and adds another', () => {
    setup([me, { ...them, hasNotes: true }]);
    openMenu();
    pick('Notes');
    fixture.detectChanges();

    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/users/2/notes'))
      .flush([{ id: 5, text: 'Watch this one', createdBy: 'ada', createdAt: '2026-10-08T09:00:00Z' }]);
    fixture.detectChanges();

    const pop = el().querySelector('.notes-pop');
    expect(pop?.textContent).toContain('Watch this one');
    expect(pop?.textContent).toContain('ada');

    const box = pop?.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'Second note';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ([...pop!.querySelectorAll('button')].find(b => b.textContent?.includes('Add note')) as HTMLButtonElement).click();

    const post = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/users/2/notes'));
    expect(post.request.body).toEqual({ text: 'Second note' });
  });

  it('removes a note that should not have been written', () => {
    setup([me, { ...them, hasNotes: true }]);
    openMenu();
    pick('Notes');
    fixture.detectChanges();

    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/users/2/notes'))
      .flush([{ id: 5, text: 'Wrong person', createdBy: 'ada', createdAt: '2026-10-08T09:00:00Z' }]);
    fixture.detectChanges();

    (el().querySelector('.note-del') as HTMLButtonElement).click();
    http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/users/2/notes/5')).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/users/2/notes')).flush([]);
    fixture.detectChanges();

    expect(el().querySelector('.notes-pop')?.textContent).not.toContain('Wrong person');
  });
});
