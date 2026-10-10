import { Component, DestroyRef, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { IndustryApi } from './services/industry-api';
import { Auth } from './services/auth';
import { IdleTop } from './services/idle-top';
import { Theme } from './services/theme';
import { Toast } from './services/toast';
import { ShortcutsPanel } from './Components/shortcuts-panel/shortcuts-panel';
import { CarryTray } from './Components/carry-tray/carry-tray';
import { routes } from './app.routes';

// admin is the admin layout: the slim nav and no page header, the page draws its own title
interface PageInfo { title: string; lede: string; centered?: boolean; admin?: boolean; wide?: boolean; }

// The pages that use the admin shell, read from the route table so marking a route there is the only place to change
const adminPaths = routes.filter(r => r.data?.['admin'] === true).map(r => `/${r.path}`);

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ShortcutsPanel, CarryTray],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  protected api = inject(IndustryApi);
  protected auth = inject(Auth);
  protected theme = inject(Theme);
  protected toast = inject(Toast);
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
  // The first page is known from the address, so opening an admin page directly doesn't flash the other nav before the router is done
  ), { initialValue: { title: 'Industries', lede: 'Every change here is saved right away.', admin: adminPaths.some(path => location.pathname.startsWith(path)) } as PageInfo });

  constructor() {
    // The bell count, checked on every page change and every 30 seconds. Only people who are signed in see requests.
    // The admin pages have their own dark colors, see styles.css (admin-layout)
    effect(() => document.documentElement.classList.toggle('admin-layout', !!this.page().admin));
    const refresh = () => { if (this.auth.isSignedIn()) this.api.refreshRequestCount(); };
    effect(refresh);
    const navs = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(refresh);
    const timer = setInterval(refresh, 30000);
    inject(DestroyRef).onDestroy(() => { navs.unsubscribe(); clearInterval(timer); });
  }
}
