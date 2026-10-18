import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Auth } from './application/auth';
import { authInterceptor } from './infrastructure/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // anchorScrolling makes the Browse and Add links jump to #browse and #add
    provideRouter(
      routes,
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    // The sign in token goes out with every call to the API, and a sign in that ran out sends the person to Sign in
    provideHttpClient(withInterceptors([authInterceptor])),
    // Who is signed in is known before the first page shows
    provideAppInitializer(() => inject(Auth).init()),
  ],
};
