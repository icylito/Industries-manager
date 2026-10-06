import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../services/auth';
import { errorText } from '../../services/industry-api';

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
        // Only go back to a page of this app
        const back = this.route.snapshot.queryParamMap.get('back') ?? '/';
        const safe = back.startsWith('/') && !back.startsWith('//') ? back : '/';
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
