import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './services/auth';

// Pages for anyone with an account
export const signedInGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { back: state.url } });
  }
  // A new or reset account only gets the page to pick a password
  if (auth.user()?.mustChangePassword && !state.url.startsWith('/account')) {
    return router.createUrlTree(['/account']);
  }
  return true;
};

// History, Fields and Users are for admins. Everyone else lands on the table.
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { back: state.url } });
  }
  if (auth.user()?.mustChangePassword) return router.createUrlTree(['/account']);
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};
