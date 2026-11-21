import { Component } from '@angular/core';
import { AccountPage } from '../account/account';
import { UsersPage } from '../users/users';

// One page for an admin: their own account, and the people who can sign in.
// It hosts the two existing pages rather than copying them, so there is one place to change either.
@Component({
  selector: 'app-settings',
  imports: [AccountPage, UsersPage],
  styleUrls: ['../my-components/my-components.css', '../history/history.css', '../login/login.css'],
  templateUrl: './settings.html',
})
export class SettingsPage {}
