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
import { provideInfrastructure } from './infrastructure/providers';

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
    // The ports the use cases and pages ask for, each answered by what talks to the API or the browser
    ...provideInfrastructure(),
    // Who is signed in is known before the first page shows
    provideAppInitializer(() => inject(Auth).init()),
  ],
};
