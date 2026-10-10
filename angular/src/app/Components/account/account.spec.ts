import { TestBed } from '@angular/core/testing';
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
    expect(el.querySelector('.profile-name')?.textContent?.trim()).toBe('ada');
    expect(el.querySelector('.profile-role')?.textContent?.trim()).toBe('Manager');
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
