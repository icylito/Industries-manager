import { Service, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { AuthUser, LoginResult } from '../domain/models/industry';
import { environment } from '../../environments/environment';
import { loadToken, saveToken } from '../infrastructure/token-store';

// Who is signed in. The token lives in this browser's storage and is sent with every call (see auth.interceptor.ts).
@Service()
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);

  user = signal<AuthUser | null>(null);
  isSignedIn = computed(() => this.user() !== null);
  isAdmin = computed(() => this.user()?.role === 'admin');
  // Managers and admins make and change tables on the Tables page and restore backups
  isManager = computed(() => this.user()?.role === 'admin' || this.user()?.role === 'manager');
  // Set when the page sent someone to the sign in page because their sign in ran out
  expired = signal(false);

  token(): string | null {
    return loadToken();
  }

  private storeToken(token: string | null) {
    saveToken(token);
  }

  // Set when there is a saved sign in but the API couldn't be asked whose it is (stopped, restarting, database down).
  // The person may well still be signed in, so they are not sent to Sign in: the page they asked for opens and says the server
  // can't be reached. The API still checks every call itself, and once it answers init() runs again (see recheck).
  unreachable = signal(false);

  // Runs before the first page, so the nav and the guards know who is signed in
  async init(): Promise<void> {
    if (!this.token()) return;
    try {
      this.user.set(await firstValueFrom(this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`)));
      this.unreachable.set(false);
    } catch (err) {
      // A 401 already cleared the token in the interceptor. An API that is down keeps the token and waits.
      this.unreachable.set(
        err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500),
      );
    }
  }

  // The page calls this when the API answers again after it couldn't be reached
  recheck() {
    if (this.unreachable()) void this.init();
  }

  login(username: string, password: string): Observable<LoginResult> {
    return this.http
      .post<LoginResult>(`${environment.apiUrl}/auth/login`, { username, password })
      .pipe(
        tap((result) => {
          this.storeToken(result.token);
          this.expired.set(false);
          this.user.set(result.user);
        }),
      );
  }

  changePassword(current: string, next: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>(`${environment.apiUrl}/auth/password`, { current, new: next })
      .pipe(tap((user) => this.user.set(user)));
  }

  logout() {
    this.http.post(`${environment.apiUrl}/auth/logout`, {}).subscribe({ error: () => {} });
    this.clear();
    this.router.navigateByUrl('/');
  }

  // The sign in ran out or was turned off, back to the sign in page and then back to where they were
  sessionEnded() {
    const wasSignedIn = this.isSignedIn() || !!this.token();
    this.clear();
    this.expired.set(wasSignedIn);
    // During the first load the router hasn't settled and says "/", so the address bar is the better answer
    const here =
      this.router.url === '/' && location.pathname !== '/'
        ? location.pathname
        : this.router.url.split('?')[0];
    this.router.navigate(['/login'], { queryParams: { back: here } });
  }

  clear() {
    this.storeToken(null);
    this.user.set(null);
    this.unreachable.set(false);
  }
}
