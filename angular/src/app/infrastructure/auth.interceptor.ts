import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from '../application/auth';
import { environment } from '../../environments/environment';

// Adds the token to calls to our own API only, and handles being signed out
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const ours = req.url.startsWith(environment.apiUrl);
  const token = ours ? auth.token() : null;
  const sent = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(sent).pipe(
    catchError((err: unknown) => {
      if (ours && err instanceof HttpErrorResponse) {
        // A wrong password on the sign in page is a 401 too, that page shows its own message
        if (err.status === 401 && !req.url.endsWith('/auth/login')) auth.sessionEnded();
        // A new or reset account has to pick its own password before anything else
        if (err.status === 403 && err.error?.title === 'New password needed')
          router.navigateByUrl('/account');
      }
      return throwError(() => err);
    }),
  );
};
