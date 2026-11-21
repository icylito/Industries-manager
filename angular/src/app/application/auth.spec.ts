import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Auth } from './auth';
import { Toast } from './toast';
import { authInterceptor } from '../infrastructure/auth.interceptor';
import { adminGuard, signedInGuard } from './guards';
import { AuthUser } from '../domain/models/industry';
import { environment } from '../../environments/environment';
import { provideInfrastructure } from '../infrastructure/providers';

const user = (role: 'admin' | 'normal', mustChangePassword = false): AuthUser => ({
  id: 1,
  username: 'sam',
  role,
  disabled: false,
  mustChangePassword,
  createdAt: '2026-10-06T12:00:00Z',
  lastLoginAt: null,
});

describe('Auth', () => {
  let auth: Auth;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ...provideInfrastructure(),
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  it('keeps the token after signing in and sends it only to our own API', () => {
    auth.login('sam', 'a long password').subscribe();
    http
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({ token: 'abc', expiresAt: '2026-10-07T00:00:00Z', user: user('normal') });
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.isAdmin()).toBe(false);
    expect(auth.token()).toBe('abc');

    TestBed.inject(HttpClient).get(`${environment.apiUrl}/industries`).subscribe();
    expect(
      http.expectOne(`${environment.apiUrl}/industries`).request.headers.get('Authorization'),
    ).toBe('Bearer abc');

    TestBed.inject(HttpClient).get('https://example.com/other').subscribe();
    expect(http.expectOne('https://example.com/other').request.headers.has('Authorization')).toBe(
      false,
    );
  });

  it('forgets everyone and goes to Sign in when the API says the sign in ran out', () => {
    auth.login('sam', 'a long password').subscribe();
    http
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({ token: 'abc', expiresAt: '', user: user('admin') });
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.inject(HttpClient)
      .get(`${environment.apiUrl}/history/versions`)
      .subscribe({ error: () => {} });
    http
      .expectOne(`${environment.apiUrl}/history/versions`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(auth.isSignedIn()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(auth.expired()).toBe(true);
    expect(go).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('shows a wrong password on the sign in page instead of redirecting', () => {
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    auth.login('sam', 'wrong').subscribe({ error: () => {} });
    http
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({ detail: 'No' }, { status: 401, statusText: 'Unauthorized' });
    expect(go).not.toHaveBeenCalled();
    expect(auth.isSignedIn()).toBe(false);
  });

  // E2: a private window or blocked site data makes localStorage throw, the sign in still works for this visit
  it('keeps the token in memory when storage is blocked, and sign out clears it', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(broken.getItem);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(broken.setItem);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(broken.removeItem);
    try {
      auth.login('sam', 'a long password').subscribe();
      http
        .expectOne(`${environment.apiUrl}/auth/login`)
        .flush({ token: 'mem', expiresAt: '', user: user('normal') });
      expect(auth.token()).toBe('mem');
      TestBed.inject(HttpClient).get(`${environment.apiUrl}/industries`).subscribe();
      expect(
        http.expectOne(`${environment.apiUrl}/industries`).request.headers.get('Authorization'),
      ).toBe('Bearer mem');
      auth.clear();
      expect(auth.token()).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
      remove.mockRestore();
    }
  });

  // E3: what the interceptor does with a 401 and a 403
  it('sends a 401 to Sign in with the page to come back to, but not for the sign in call or another site', () => {
    auth.login('sam', 'a long password').subscribe();
    http
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({ token: 'abc', expiresAt: '', user: user('admin') });
    vi.spyOn(router, 'url', 'get').mockReturnValue('/fields?x=1');
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.inject(HttpClient)
      .get('https://example.com/other')
      .subscribe({ error: () => {} });
    http
      .expectOne('https://example.com/other')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(go).not.toHaveBeenCalled();
    expect(auth.isSignedIn()).toBe(true);

    TestBed.inject(HttpClient)
      .get(`${environment.apiUrl}/schema/versions`)
      .subscribe({ error: () => {} });
    http
      .expectOne(`${environment.apiUrl}/schema/versions`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.isSignedIn()).toBe(false);
    expect(go).toHaveBeenCalledWith(['/login'], { queryParams: { back: '/fields' } });
  });

  it('sends a 403 about a new password to the account page and leaves any other 403 alone', () => {
    const byUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(HttpClient)
      .post(`${environment.apiUrl}/industries`, {})
      .subscribe({ error: () => {} });
    http
      .expectOne(`${environment.apiUrl}/industries`)
      .flush({ title: 'Not allowed' }, { status: 403, statusText: 'Forbidden' });
    expect(byUrl).not.toHaveBeenCalled();

    TestBed.inject(HttpClient)
      .post(`${environment.apiUrl}/industries`, {})
      .subscribe({ error: () => {} });
    http
      .expectOne(`${environment.apiUrl}/industries`)
      .flush({ title: 'New password needed' }, { status: 403, statusText: 'Forbidden' });
    expect(byUrl).toHaveBeenCalledWith('/account');
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

    // E10: a new account only gets the page to pick a password, from every guarded route, and can open that page
    auth.user.set(user('admin', true));
    expect(String(run(adminGuard, '/history'))).toBe('/account');
    expect(String(run(adminGuard, '/fields'))).toBe('/account');
    expect(String(run(adminGuard, '/users'))).toBe('/account');
    expect(String(run(signedInGuard, '/requests'))).toBe('/account');
    expect(run(signedInGuard, '/account')).toBe(true);
    auth.user.set(user('normal', true));
    expect(String(run(signedInGuard, '/requests'))).toBe('/account');
    expect(run(signedInGuard, '/account')).toBe(true);
  });

  // The API is down when the page is reloaded: nobody is sent to Sign in for that
  it('keeps the sign in when the API cannot be reached, opens the guarded page, and asks again later', async () => {
    localStorage.setItem('stock-listing-token', 'abc');
    const first = auth.init();
    http
      .expectOne(`${environment.apiUrl}/auth/me`)
      .error(new ProgressEvent('error'), { status: 0 });
    await first;
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.unreachable()).toBe(true);
    expect(auth.token()).toBe('abc');
    const run = (guard: typeof adminGuard, url: string) =>
      TestBed.runInInjectionContext(() => guard({} as never, { url } as never));
    expect(run(adminGuard, '/overview')).toBe(true);
    expect(run(signedInGuard, '/requests')).toBe(true);

    // The API is back: asking again says who it is
    auth.recheck();
    http.expectOne(`${environment.apiUrl}/auth/me`).flush(user('admin'));
    await new Promise((r) => setTimeout(r));
    expect(auth.isAdmin()).toBe(true);
    expect(auth.unreachable()).toBe(false);
  });

  it('still sends a guest, and a saved sign in the API says is over, to Sign in', async () => {
    // No saved sign in: a guest, even if the API is down
    expect(
      String(
        TestBed.runInInjectionContext(() => adminGuard({} as never, { url: '/overview' } as never)),
      ),
    ).toContain('/login');
    // A 401 is not "can't reach it", the interceptor ends the sign in
    localStorage.setItem('stock-listing-token', 'old');
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const first = auth.init();
    http
      .expectOne(`${environment.apiUrl}/auth/me`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await first;
    expect(auth.unreachable()).toBe(false);
    expect(auth.token()).toBeNull();
  });

  it('tells someone with an account but no admin rights why they landed on the table', () => {
    auth.user.set(user('normal'));
    const toast = TestBed.inject(Toast);
    const result = TestBed.runInInjectionContext(() =>
      adminGuard({} as never, { url: '/overview' } as never),
    );
    expect(String(result)).toBe('/');
    expect(toast.message()).toBe('That page is for admins.');
  });
});
