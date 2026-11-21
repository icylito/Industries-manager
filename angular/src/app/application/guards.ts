import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';
import { Toast } from './toast';

// A saved sign in that the API couldn't be asked about (it is down): the page opens and shows its own failure, see Auth.unreachable
const waitingForApi = (auth: Auth) => !auth.isSignedIn() && auth.unreachable() && !!auth.token();

// Pages for anyone with an account
export const signedInGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (waitingForApi(auth)) return true;
  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { back: state.url } });
  }
  // A new or reset account only gets the page to pick a password
  if (auth.user()?.mustChangePassword && !state.url.startsWith('/account')) {
    return router.createUrlTree(['/account']);
  }
  return true;
};

// Managers and admins. History shows a manager only its Backups card, see history.html.
export const managerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (waitingForApi(auth)) return true;
  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { back: state.url } });
  }
  if (auth.user()?.mustChangePassword) return router.createUrlTree(['/account']);
  if (auth.isManager()) return true;
  inject(Toast).say('That page is for managers and admins.');
  return router.createUrlTree(['/']);
};

// History, Fields and Users are for admins. Everyone else lands on the table.
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (waitingForApi(auth)) return true;
  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { back: state.url } });
  }
  if (auth.user()?.mustChangePassword) return router.createUrlTree(['/account']);
  if (auth.isAdmin()) return true;
  // Someone with an account but no admin rights lands on the table, and is told why
  inject(Toast).say('That page is for admins.');
  return router.createUrlTree(['/']);
};
