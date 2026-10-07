import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../services/auth';
import { errorText } from '../../services/industry-api';

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
  if (/[\\:\r\n]|[\u0000-\u001f]/.test(back) || /[\\:\r\n]|[\u0000-\u001f]/.test(decoded)) return '/';
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

  submit(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    if (!this.username().trim() || !this.password()) {
      this.error.set('Type your username and password');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.auth.login(this.username(), this.password()).subscribe({
      next: result => {
        this.busy.set(false);
        const safe = safeBack(this.route.snapshot.queryParamMap.get('back'));
        this.router.navigateByUrl(result.user.mustChangePassword ? '/account' : safe);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.password.set('');
        this.error.set(errorText(err, "Couldn't sign in. Try again in a moment"));
      },
    });
  }
}
