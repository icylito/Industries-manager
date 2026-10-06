import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Auth } from './auth';
import { authInterceptor } from './auth.interceptor';
import { adminGuard, signedInGuard } from '../guards';
import { AuthUser } from '../models/industry';
import { environment } from '../../environments/environment';

const user = (role: 'admin' | 'normal', mustChangePassword = false): AuthUser => ({
  id: 1, username: 'sam', role, disabled: false, mustChangePassword, createdAt: '2026-10-06T12:00:00Z', lastLoginAt: null,
});

describe('Auth', () => {
  let auth: Auth;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  it('keeps the token after signing in and sends it only to our own API', () => {
    auth.login('sam', 'a long password').subscribe();
    http.expectOne(`${environment.apiUrl}/auth/login`).flush({ token: 'abc', expiresAt: '2026-10-07T00:00:00Z', user: user('normal') });
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.isAdmin()).toBe(false);
    expect(auth.token()).toBe('abc');

    TestBed.inject(HttpClient).get(`${environment.apiUrl}/industries`).subscribe();
    expect(http.expectOne(`${environment.apiUrl}/industries`).request.headers.get('Authorization')).toBe('Bearer abc');

    TestBed.inject(HttpClient).get('https://example.com/other').subscribe();
    expect(http.expectOne('https://example.com/other').request.headers.has('Authorization')).toBe(false);
  });

  it('forgets everyone and goes to Sign in when the API says the sign in ran out', () => {
    auth.login('sam', 'a long password').subscribe();
    http.expectOne(`${environment.apiUrl}/auth/login`).flush({ token: 'abc', expiresAt: '', user: user('admin') });
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.inject(HttpClient).get(`${environment.apiUrl}/history/versions`).subscribe({ error: () => {} });
    http.expectOne(`${environment.apiUrl}/history/versions`).flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(auth.isSignedIn()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(auth.expired()).toBe(true);
    expect(go).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('shows a wrong password on the sign in page instead of redirecting', () => {
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    auth.login('sam', 'wrong').subscribe({ error: () => {} });
    http.expectOne(`${environment.apiUrl}/auth/login`).flush({ detail: 'No' }, { status: 401, statusText: 'Unauthorized' });
    expect(go).not.toHaveBeenCalled();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('lets guards through by role', () => {
    const run = (guard: typeof adminGuard, url: string) =>
      TestBed.runInInjectionContext(() => guard({} as never, { url } as never));

    // Nobody signed in goes to Sign in and comes back afterwards
    expect(String(run(adminGuard, '/history'))).toContain('/login?back=%2Fhistory');

    auth.user.set(user('normal'));
    expect(String(run(adminGuard, '/history'))).toBe('/');
    expect(run(signedInGuard, '/requests')).toBe(true);

    auth.user.set(user('admin'));
    expect(run(adminGuard, '/history')).toBe(true);

    // A new account only gets the page to pick a password
    auth.user.set(user('admin', true));
    expect(String(run(adminGuard, '/history'))).toBe('/account');
    expect(String(run(signedInGuard, '/requests'))).toBe('/account');
  });
});
