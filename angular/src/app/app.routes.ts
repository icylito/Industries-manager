import { Routes } from '@angular/router';
import { MyComponents } from './presentation/components/my-components/my-components';
import { adminGuard, managerGuard, signedInGuard } from './application/guards';

// title and lede fill the page header in app.html. centered puts them over the middle of the page, for the one card pages
// admin gives a page the slim nav and the admin colours, and drops the page header so the page draws its own title
// The table loads with the app, the other pages load the first time someone opens them
export const routes: Routes = [
  {
    path: '',
    component: MyComponents,
    data: { title: 'Industries', lede: 'Every change here is saved right away.' },
  },
  {
    path: 'login',
    loadComponent: () => import('./presentation/components/login/login').then((m) => m.LoginPage),
    data: { title: 'Sign in', lede: 'Welcome Back.', centered: true },
  },
  {
    path: 'account',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./presentation/components/account/account').then((m) => m.AccountPage),
    data: { title: 'Your account', lede: 'Change your password or sign out.', centered: true },
  },
  // The Overview is for admins only for now. Who may see it is the guard's one line, nothing on the page says "admin".
  {
    path: 'overview',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./presentation/components/overview/overview').then((m) => m.OverviewPage),
    data: { title: 'Overview', lede: 'The table at a glance.', admin: true },
  },
  // Settings holds the people list and your own account, see app.html (the admin nav's second tab)
  {
    path: 'settings',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./presentation/components/settings/settings').then((m) => m.SettingsPage),
    data: { title: 'Settings', lede: 'Your account, and the people who can sign in.', admin: true },
  },
  // The Scratchpad is the board for thinking with the industries. A wider page, see app.css (.app.wide)
  {
    path: 'scratchpad',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./presentation/components/scratchpad/scratchpad').then((m) => m.ScratchpadPage),
    data: {
      title: 'Scratchpad',
      lede: 'A board to think with your industries.',
      admin: true,
      wide: true,
    },
  },
  // The People page moved inside Settings, so an old link still lands somewhere useful
  { path: 'users', redirectTo: 'settings' },
  // Managers get only the Backups card on History, admins the whole page
  {
    path: 'history',
    canActivate: [managerGuard],
    loadComponent: () =>
      import('./presentation/components/history/history').then((m) => m.HistoryPage),
    data: {
      title: 'History',
      lede: 'Every saved copy of the table. View, download, restore, or bring old rows back.',
    },
  },
  {
    path: 'fields',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./presentation/components/fields/fields').then((m) => m.FieldsPage),
    data: {
      title: 'Fields',
      lede: 'What each column holds and its limits. Every save is a new version.',
    },
  },
  // Tables people make themselves. Everyone signed in can look; managers and admins change them (the API checks too)
  {
    path: 'tables',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./presentation/components/tables/tables').then((m) => m.TablesPage),
    data: { title: 'Tables', lede: 'Create custom tables, experiment with it.' },
  },
  {
    path: 'tables/:id',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./presentation/components/tables/tables').then((m) => m.TablesPage),
    data: { title: 'Tables', lede: 'Create custom tables, experiment with it.' },
  },
  {
    path: 'requests',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./presentation/components/requests/requests').then((m) => m.RequestsPage),
    data: {
      title: 'Requests',
      lede: 'Things that need a developer, each with the steps written out for them.',
    },
  },
  {
    path: 'requests/:id',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./presentation/components/requests/requests').then((m) => m.RequestsPage),
    data: { title: 'Ticket', lede: 'The conversation with the developers about one request.' },
  },
  { path: '**', redirectTo: '' },
];
