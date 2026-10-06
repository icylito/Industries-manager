import { Routes } from '@angular/router';
import { MyComponents } from './Components/my-components/my-components';

// title and lede fill the page header in app.html
// The table loads with the app, the other pages load the first time someone opens them
export const routes: Routes = [
    { path: '', component: MyComponents, data: { title: 'Industries', lede: 'Every change here saves to the database.' } },
    { path: 'history', loadComponent: () => import('./Components/history/history').then(m => m.HistoryPage), data: { title: 'History', lede: 'Every saved copy of the table. View, download, restore, or bring old rows back.' } },
    { path: 'fields', loadComponent: () => import('./Components/fields/fields').then(m => m.FieldsPage), data: { title: 'Fields', lede: 'What each column holds and its limits. Every save is a new version.' } },
    { path: 'requests', loadComponent: () => import('./Components/requests/requests').then(m => m.RequestsPage), data: { title: 'Requests', lede: 'Things that need a developer. Each one comes with the code drafted.' } },
    { path: '**', redirectTo: '' },
];
