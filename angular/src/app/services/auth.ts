import { Service, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { AuthUser, LoginResult } from '../models/industry';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'stock-listing-token';
// Only used when the browser won't keep the token, so it lasts for this visit
let memoryToken: string | null = null;

// Who is signed in. The token lives in this browser's storage and is sent with every call (see auth.interceptor.ts).
@Service()
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);

  user = signal<AuthUser | null>(null);
  isSignedIn = computed(() => this.user() !== null);
  isAdmin = computed(() => this.user()?.role === 'admin');
  // Set when the page sent someone to the sign in page because their sign in ran out
  expired = signal(false);

  // Storage can be blocked (private window, blocked site data), the page still works, you just sign in again each visit
  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  }

  private saveToken(token: string | null) {
    memoryToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Blocked storage, the token stays in memory for this visit only
    }
  }

  // Runs before the first page, so the nav and the guards know who is signed in
  async init(): Promise<void> {
    if (!this.token()) return;
    try {
      this.user.set(await firstValueFrom(this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`)));
    } catch {
      // A 401 already cleared the token in the interceptor. An API that is down just leaves the page as a guest view.
    }
  }

  login(username: string, password: string): Observable<LoginResult> {
    return this.http.post<LoginResult>(`${environment.apiUrl}/auth/login`, { username, password }).pipe(
      tap(result => {
        this.saveToken(result.token);
        this.expired.set(false);
        this.user.set(result.user);
      }),
    );
  }

  changePassword(current: string, next: string): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${environment.apiUrl}/auth/password`, { current, new: next }).pipe(
      tap(user => this.user.set(user)),
    );
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
    this.router.navigate(['/login'], { queryParams: { back: this.router.url.split('?')[0] } });
  }

  clear() {
    this.saveToken(null);
    this.user.set(null);
  }
}
