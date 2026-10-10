import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccountPage } from './account';
import { Auth } from '../../services/auth';
import { routes } from '../../app.routes';

// E8: the page stops a bad new password before any call is made
describe('AccountPage', () => {
  it('refuses a short password, two that differ, and one equal to the current one, without a request', () => {
    TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 1, username: 'sam', role: 'normal', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    const page = TestBed.createComponent(AccountPage).componentInstance;
    const submit = () => page.submit(new Event('submit'));

    // Each problem belongs to a box, so the page can show it there
    page.current.set('old password 1'); page.next.set('short'); page.repeat.set('short'); submit();
    expect(page.problem()).toEqual({ box: 'next', text: 'The new password has to be at least 10 characters' });

    page.next.set('a new password'); page.repeat.set('a new passwor'); submit();
    expect(page.problem()).toEqual({ box: 'repeat', text: "The two new passwords don't match" });

    page.next.set('old password 1'); page.repeat.set('old password 1'); submit();
    expect(page.problem()).toEqual({ box: 'next', text: "Pick a password you haven't used just now" });

    http.expectNone(r => r.url.endsWith('/auth/password'));

    page.next.set('a new password'); page.repeat.set('a new password'); submit();
    http.expectOne(r => r.url.endsWith('/auth/password'));
  });
});

// Parked 2026-10-08: the admin page links came off this page, the markup is commented out in account.html.
// History and Fields are still reachable from the nav on Browse. This test pins the current state, so
// bringing the links back is a deliberate change with a test to change, not a silent edit.
describe('AccountPage and the parked admin links', () => {
  const render = (role: 'admin' | 'normal') => {
    TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role, disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows no admin page links for now, not even to an admin', () => {
    const el = render('admin');
    expect(el.querySelector('.admin-links')).toBeFalsy();
  });
});

// The profile card: who the person is, with the password form only when asked for
describe('AccountPage as a profile card', () => {
  const render = (mustChangePassword: boolean) => {
    TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role: 'manager', disabled: false, mustChangePassword,
      createdAt: '2026-09-26T08:00:00Z', lastLoginAt: null });
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('shows who is signed in, and asks for no password until Change password is pressed', () => {
    const { fixture, el } = render(false);
    expect(el.querySelector('.profile-avatar')?.textContent?.trim()).toBe('A');
    expect(el.querySelector('.profile-name-text')?.textContent?.trim()).toBe('ada');
    expect(el.querySelector('.profile-role')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('@ada · Manager');
    expect(el.querySelector('.profile-facts')?.textContent).toContain('26 Sept 2026');
    expect(el.querySelector('input[type=password]')).toBeFalsy();

    const open = Array.from(el.querySelectorAll('.profile-btn')).find(b => b.textContent?.includes('Change password')) as HTMLButtonElement;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    open.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('input[type=password]').length).toBe(3);
    expect(open.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the form straight away for an account that has to pick its own password', () => {
    const { el } = render(true);
    expect(el.querySelectorAll('input[type=password]').length).toBe(3);
    expect(Array.from(el.querySelectorAll('.profile-btn')).some(b => b.textContent?.includes('Change password'))).toBe(false);
  });
});

// The picture and the name on the card
describe('AccountPage picture and name', () => {
  const render = (avatarAt: string | null) => {
    TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false,
      createdAt: '2026-09-26T08:00:00Z', lastLoginAt: null, displayName: null, avatarAt });
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
  };

  it('opens the file picker straight away when there is no picture yet', () => {
    const { el } = render(null);
    const picker = el.querySelector('input[type=file]') as HTMLInputElement;
    const opened = vi.spyOn(picker, 'click').mockImplementation(() => {});
    (el.querySelector('.profile-avatar') as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalled();
    expect(el.querySelector('.profile-menu')).toBeFalsy();
  });

  it('with a picture, offers to pick another or remove it, and removing asks the API', async () => {
    // jsdom has no blob addresses, the browser does
    URL.createObjectURL = vi.fn(() => 'blob:picture');
    URL.revokeObjectURL = vi.fn();
    const { fixture, el, http } = render('2026-10-10T08:00:00Z');
    http.expectOne(r => r.url.endsWith('/me/avatar') && r.method === 'GET').flush(new Blob(['x'], { type: 'image/png' }));
    await new Promise(done => setTimeout(done, 0));
    fixture.detectChanges();
    (el.querySelector('.profile-avatar') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(el.querySelectorAll('.profile-menu button')).map(b => b.textContent?.trim());
    expect(items).toEqual(['Pick a picture', 'Remove picture']);
    (el.querySelectorAll('.profile-menu button')[1] as HTMLButtonElement).click();
    http.expectOne(r => r.url.endsWith('/me/avatar') && r.method === 'DELETE')
      .flush({ id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null, displayName: null, avatarAt: null });
    await new Promise(done => setTimeout(done, 0));
    fixture.detectChanges();
    expect(el.querySelector('.profile-menu')).toBeFalsy();
    expect(el.querySelector('.profile-initial')?.textContent?.trim()).toBe('A');
  });

  it('changes the name shown, and the username stays under it', async () => {
    const { fixture, el, http } = render(null);
    (el.querySelector('.profile-name .profile-icon-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    const box = el.querySelector('.profile-name-box') as HTMLInputElement;
    box.value = 'Ada Lovelace';
    (el.querySelector('.profile-rename') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const put = http.expectOne(r => r.url.endsWith('/me/profile'));
    expect(put.request.body).toEqual({ displayName: 'Ada Lovelace' });
    put.flush({ id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null, displayName: 'Ada Lovelace', avatarAt: null });
    await new Promise(done => setTimeout(done, 0));
    fixture.detectChanges();
    expect(el.querySelector('.profile-name-text')?.textContent?.trim()).toBe('Ada Lovelace');
    expect(el.querySelector('.profile-role')?.textContent).toContain('@ada');
  });
});
