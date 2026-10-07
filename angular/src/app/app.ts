import { Component, DestroyRef, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { IndustryApi } from './services/industry-api';
import { Auth } from './services/auth';
import { IdleTop } from './services/idle-top';

interface PageInfo { title: string; lede: string; }

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  protected api = inject(IndustryApi);
  protected auth = inject(Auth);
  // A page left alone for a while starts from the top when the person comes back, see services/idle-top.ts
  private idleTop = inject(IdleTop);

  // Page header text comes from the route's data in app.routes.ts
  protected page = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(() => {
      let route = this.router.routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      return route.data as PageInfo;
    }),
  ), { initialValue: { title: 'Industries', lede: 'Every change here is saved right away.' } });

  constructor() {
    // The bell count, checked on every page change and every 30 seconds. Only people who are signed in see requests.
    const refresh = () => { if (this.auth.isSignedIn()) this.api.refreshRequestCount(); };
    effect(refresh);
    const navs = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(refresh);
    const timer = setInterval(refresh, 30000);
    inject(DestroyRef).onDestroy(() => { navs.unsubscribe(); clearInterval(timer); });
  }
}
