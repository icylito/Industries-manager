import { Routes } from '@angular/router';
import { MyComponents } from './Components/my-components/my-components';
import { HistoryPage } from './Components/history/history';
import { FieldsPage } from './Components/fields/fields';
import { RequestsPage } from './Components/requests/requests';

// title and lede fill the page header in app.html
export const routes: Routes = [
    { path: '', component: MyComponents, data: { title: 'Industries', lede: 'Every change here saves to the database.' } },
    { path: 'history', component: HistoryPage, data: { title: 'History', lede: 'Every saved copy of the table. View, download, restore, or bring old rows back.' } },
    { path: 'fields', component: FieldsPage, data: { title: 'Fields', lede: 'What each column holds and its limits. Every save is a new version.' } },
    { path: 'requests', component: RequestsPage, data: { title: 'Requests', lede: 'Things that need a developer. Each one comes with the code drafted.' } },
    { path: '**', redirectTo: '' },
];
