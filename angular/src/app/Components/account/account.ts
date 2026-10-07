import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../services/auth';
import { errorText } from '../../services/industry-api';

type Box = 'current' | 'next' | 'repeat';

@Component({
  selector: 'app-account',
  imports: [],
  styleUrls: ['../my-components/my-components.css', '../history/history.css', '../login/login.css', './account.css'],
  templateUrl: './account.html',
})
export class AccountPage {
  protected auth = inject(Auth);
  private router = inject(Router);

  current = signal('');
  next = signal('');
  repeat = signal('');
  busy = signal(false);
  // A problem sits under the box it belongs to. Only an answer that belongs to no box goes in error().
  problem = signal<{ box: Box; text: string } | null>(null);
  error = signal('');
  done = signal(false);

  problemFor(box: Box): string | null {
    const p = this.problem();
    return p?.box === box ? p.text : null;
  }

  submit(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    this.error.set('');
    this.problem.set(null);
    this.done.set(false);
    if (this.next().length < 10) {
      this.problem.set({ box: 'next', text: 'The new password has to be at least 10 characters' });
      return;
    }
    if (this.next() !== this.repeat()) {
      this.problem.set({ box: 'repeat', text: "The two new passwords don't match" });
      return;
    }
    if (this.next() === this.current()) {
      this.problem.set({ box: 'next', text: "Pick a password you haven't used just now" });
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
        // The API answers per box too ("current" or "new"), so its words land under the right one
        const errors = err.error?.errors as Record<string, string[]> | undefined;
        if (errors?.['current']?.[0]) this.problem.set({ box: 'current', text: errors['current'][0] });
        else if (errors?.['new']?.[0]) this.problem.set({ box: 'next', text: errors['new'][0] });
        else this.error.set(errorText(err, "Couldn't change the password. Try again in a moment"));
      },
    });
  }
}
