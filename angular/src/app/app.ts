import { Component, DestroyRef, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { IndustryApi } from './services/industry-api';

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

  // Page header text comes from the route's data in app.routes.ts
  protected page = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(() => {
      let route = this.router.routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      return route.data as PageInfo;
    }),
  ), { initialValue: { title: 'Industries', lede: 'Every change here saves to the database.' } });

  constructor() {
    // The bell count, checked on every page change and every 30 seconds
    this.api.refreshRequestCount();
    const navs = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.api.refreshRequestCount());
    const timer = setInterval(() => this.api.refreshRequestCount(), 30000);
    inject(DestroyRef).onDestroy(() => { navs.unsubscribe(); clearInterval(timer); });
  }
}
