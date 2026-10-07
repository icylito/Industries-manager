import { Routes } from '@angular/router';
import { MyComponents } from './Components/my-components/my-components';
import { adminGuard, signedInGuard } from './guards';

// title and lede fill the page header in app.html. centered puts them over the middle of the page, for the one card pages
// The table loads with the app, the other pages load the first time someone opens them
export const routes: Routes = [
    { path: '', component: MyComponents, data: { title: 'Industries', lede: 'Every change here is saved right away.' } },
    { path: 'login', loadComponent: () => import('./Components/login/login').then(m => m.LoginPage), data: { title: 'Sign in', lede: 'Anyone can look at the table. An account is needed to change anything.', centered: true } },
    { path: 'account', canActivate: [signedInGuard], loadComponent: () => import('./Components/account/account').then(m => m.AccountPage), data: { title: 'Your account', lede: 'Change your password or sign out.', centered: true } },
    // The Overview is for admins only for now. Who may see it is the guard's one line, nothing on the page says "admin".
    { path: 'overview', canActivate: [adminGuard], loadComponent: () => import('./Components/overview/overview').then(m => m.OverviewPage), data: { title: 'Overview', lede: 'The table at a glance.', admin: true } },
    { path: 'users', canActivate: [adminGuard], loadComponent: () => import('./Components/users/users').then(m => m.UsersPage), data: { title: 'People', lede: 'Who can sign in. Admins make the accounts.' } },
    { path: 'history', canActivate: [adminGuard], loadComponent: () => import('./Components/history/history').then(m => m.HistoryPage), data: { title: 'History', lede: 'Every saved copy of the table. View, download, restore, or bring old rows back.' } },
    { path: 'fields', canActivate: [adminGuard], loadComponent: () => import('./Components/fields/fields').then(m => m.FieldsPage), data: { title: 'Fields', lede: 'What each column holds and its limits. Every save is a new version.' } },
    { path: 'requests', canActivate: [signedInGuard], loadComponent: () => import('./Components/requests/requests').then(m => m.RequestsPage), data: { title: 'Requests', lede: 'Things that need a developer, each with the steps written out for them.' } },
    { path: '**', redirectTo: '' },
];
