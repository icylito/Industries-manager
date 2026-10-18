import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../../application/auth';
import { errorText } from '../../../application/http-text';

// Only a page of this app. A value with a backslash, a colon or a line break could be read by a browser as another site
// ("/\\evil.com" becomes "//evil.com"), so anything like that goes to the table instead.
export function safeBack(back: string | null): string {
  if (!back || !back.startsWith('/') || back.startsWith('//')) return '/';
  let decoded = back;
  try {
    decoded = decodeURIComponent(back);
  } catch {
    return '/';
  }
  // Checked decoded too, so an encoded line break or backslash can't slip through
  if (/[\\:\r\n]|[\u0000-\u001f]/.test(back) || /[\\:\r\n]|[\u0000-\u001f]/.test(decoded))
    return '/';
  return back;
}

@Component({
  selector: 'app-login',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './login.css'],
  templateUrl: './login.html',
})
export class LoginPage {
  protected auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  username = signal('');
  password = signal('');
  busy = signal(false);
  error = signal('');
  // Seconds left after too many tries. Sign in stays off and the line under the boxes counts down.
  // Worked out from the end time on every tick, so a tab the browser slows down in the background still shows the
  // right number, and the end time is kept for this tab so a reload doesn't turn Sign in back on early.
  wait = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly waitKey = 'signInWaitUntil';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
    let until = 0;
    try {
      until = Number(sessionStorage.getItem(LoginPage.waitKey)) || 0;
    } catch {
      /* no storage, no carry-over */
    }
    if (until > Date.now()) this.runUntil(until);
  }

  private startWait(seconds: number) {
    const until = Date.now() + seconds * 1000;
    try {
      sessionStorage.setItem(LoginPage.waitKey, String(until));
    } catch {
      /* the countdown still runs */
    }
    this.runUntil(until);
  }

  private runUntil(until: number) {
    this.stopTimer();
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      this.wait.set(Math.max(0, left));
      if (left <= 0) {
        this.stopTimer();
        this.error.set('');
        try {
          sessionStorage.removeItem(LoginPage.waitKey);
        } catch {
          /* nothing kept */
        }
      }
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  waitText(): string {
    const s = this.wait();
    return s < 90
      ? `Too many tries. Try again in ${s} second${s === 1 ? '' : 's'}`
      : `Too many tries. Try again in ${Math.ceil(s / 60)} minutes`;
  }

  submit(event: Event) {
    event.preventDefault();
    if (this.busy() || this.wait() > 0) return;
    if (!this.username().trim() || !this.password()) {
      this.error.set('Type your username and password');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.auth.login(this.username(), this.password()).subscribe({
      next: (result) => {
        this.busy.set(false);
        const safe = safeBack(this.route.snapshot.queryParamMap.get('back'));
        this.router.navigateByUrl(result.user.mustChangePassword ? '/account' : safe);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.password.set('');
        if (err.status === 429) {
          const seconds = Number(err.headers?.get('Retry-After'));
          this.startWait(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60);
          return;
        }
        this.error.set(errorText(err, "Couldn't sign in. Try again in a moment"));
      },
    });
  }
}
