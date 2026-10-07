import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthUser } from '../../models/industry';
import { Auth } from '../../services/auth';
import { IndustryApi, errorText } from '../../services/industry-api';

type Pending = { user: AuthUser; action: 'reset' | 'off' };

@Component({
  selector: 'app-users',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', '../login/login.css', './users.css'],
  templateUrl: './users.html',
})
export class UsersPage implements OnInit {
  private api = inject(IndustryApi);
  protected auth = inject(Auth);

  users = signal<AuthUser[]>([]);
  loading = signal(true);
  error = signal('');
  busy = signal(false);

  newName = signal('');
  newRole = signal<'normal' | 'admin'>('normal');
  addError = signal('');

  // The question before turning someone off or giving them a new password
  pending = signal<Pending | null>(null);
  // A temporary password is shown once, here, and gone when the page is left
  shown = signal<{ username: string; password: string; created: boolean } | null>(null);
  copied = signal(false);
  // When the browser won't copy (no clipboard on plain http from another PC, or it refused), say so instead of nothing
  copyNote = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.shown.set(null); this.copied.set(false); this.copyNote.set(''); });
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.users().subscribe({
      next: list => { this.users.set(list); this.loading.set(false); this.error.set(''); },
      error: (err: HttpErrorResponse) => { this.loading.set(false); this.error.set(errorText(err, 'Could not load the people')); },
    });
  }

  formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  add() {
    if (this.busy()) return;
    this.addError.set('');
    // Usernames are saved trimmed and lowercase, so send them that way and the person sees what gets saved
    const username = this.newName().trim().toLowerCase();
    if (!username) {
      this.addError.set('Type a username');
      return;
    }
    this.busy.set(true);
    this.api.createUser(username, this.newRole()).subscribe({
      next: r => {
        this.busy.set(false);
        this.newName.set('');
        this.shown.set({ username: r.user.username, password: r.temporaryPassword, created: true });
        this.copied.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.addError.set(errorText(err)); },
    });
  }

  setRole(user: AuthUser, role: 'admin' | 'normal') {
    this.change(user, { role });
  }

  turnOn(user: AuthUser) {
    this.change(user, { disabled: false });
  }

  ask(user: AuthUser, action: Pending['action']) {
    this.error.set('');
    this.pending.set({ user, action });
  }

  confirm() {
    const p = this.pending();
    if (!p || this.busy()) return;
    if (p.action === 'off') {
      this.change(p.user, { disabled: true });
      return;
    }
    this.busy.set(true);
    this.api.resetPassword(p.user.id).subscribe({
      next: r => {
        this.busy.set(false);
        this.pending.set(null);
        this.shown.set({ username: r.user.username, password: r.temporaryPassword, created: false });
        this.copied.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.pending.set(null); this.error.set(errorText(err)); },
    });
  }

  private change(user: AuthUser, body: { role?: string; disabled?: boolean }) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.updateUser(user.id, body).subscribe({
      next: () => { this.busy.set(false); this.pending.set(null); this.load(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.pending.set(null); this.error.set(errorText(err)); },
    });
  }

  copy(text: string) {
    this.copyNote.set('');
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      this.copyNote.set('Select the password and copy it yourself');
      return;
    }
    clipboard.writeText(text).then(
      () => this.copied.set(true),
      () => this.copyNote.set('Select the password and copy it yourself'),
    );
  }
}
