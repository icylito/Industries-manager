import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Auth } from '../../services/auth';
import { errorText } from '../../services/industry-api';

@Component({
  selector: 'app-account',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', '../login/login.css'],
  templateUrl: './account.html',
})
export class AccountPage {
  protected auth = inject(Auth);
  private router = inject(Router);

  current = signal('');
  next = signal('');
  repeat = signal('');
  busy = signal(false);
  error = signal('');
  done = signal(false);

  submit(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    this.error.set('');
    this.done.set(false);
    if (this.next().length < 10) {
      this.error.set('The new password has to be at least 10 characters');
      return;
    }
    if (this.next() !== this.repeat()) {
      this.error.set("The two new passwords don't match");
      return;
    }
    const first = this.auth.user()?.mustChangePassword === true;
    this.busy.set(true);
    this.auth.changePassword(this.current(), this.next()).subscribe({
      next: () => {
        this.busy.set(false);
        this.current.set('');
        this.next.set('');
        this.repeat.set('');
        // A new account has been waiting for this, now it can go to the table
        if (first) this.router.navigateByUrl('/');
        else this.done.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(errorText(err, "Couldn't change the password. Try again in a moment"));
      },
    });
  }
}
