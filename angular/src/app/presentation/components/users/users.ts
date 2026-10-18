import { ConfirmPopup } from '../confirm-popup/confirm-popup';
import { Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { sameName } from '../../../domain/name-key';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthUser } from '../../../domain/models/industry';
import { Auth } from '../../../application/auth';
import { UserNote } from '../../../domain/models/industry';
import { IndustryApi, errorText } from '../../../infrastructure/industry-api';

// Everything the menu can do to someone. Turning an account back on takes nothing away, so it is the one that does not ask.
type RowAction = 'reset' | 'off' | 'admin' | 'manager' | 'normal' | 'delete' | 'rename';
type Pending = { user: AuthUser; action: RowAction };

@Component({
  selector: 'app-users',
  styleUrls: [
    '../my-components/my-components.css',
    '../history/history.css',
    '../login/login.css',
    './users.css',
  ],
  templateUrl: './users.html',
  imports: [ConfirmPopup],
})
export class UsersPage implements OnInit {
  private api = inject(IndustryApi);
  protected auth = inject(Auth);

  users = signal<AuthUser[]>([]);
  loading = signal(true);
  error = signal('');
  busy = signal(false);

  newName = signal('');
  newRole = signal<'normal' | 'manager' | 'admin'>('normal');
  addError = signal('');

  // The question before anything that takes access away
  pending = signal<Pending | null>(null);
  // The open hamburger menu, and where it sits. It is drawn outside the table on purpose: inside it the table's
  // own scrolling box clipped the menu so only a sliver of it showed.
  menuFor = signal<AuthUser | null>(null);
  menuAt = signal({ top: 0, right: 0 });
  // What the rename box holds while the question is up
  renameTo = signal('');
  // The notes dialog: who it is about, what has been written, and what is being typed
  notesFor = signal<AuthUser | null>(null);
  notes = signal<UserNote[]>([]);
  notesLoading = signal(false);
  notesBusy = signal(false);
  // The note the delete pop up is asking about
  confirmingNote = signal<UserNote | null>(null);
  noteText = signal('');
  // A temporary password is shown once, here, and gone when the page is left
  shown = signal<{ username: string; password: string; created: boolean } | null>(null);
  copied = signal(false);
  // When the browser won't copy (no clipboard on plain http from another PC, or it refused), say so instead of nothing
  copyNote = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.shown.set(null);
      this.copied.set(false);
      this.copyNote.set('');
    });
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.api.users().subscribe({
      next: (list) => {
        this.users.set(list);
        this.loading.set(false);
        this.error.set('');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(errorText(err, 'Could not load the people'));
      },
    });
  }

  formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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
      next: (r) => {
        this.busy.set(false);
        this.newName.set('');
        this.shown.set({ username: r.user.username, password: r.temporaryPassword, created: true });
        this.copied.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.addError.set(errorText(err));
      },
    });
  }

  // Turning an account back on takes nothing away, so it happens straight away
  turnOn(user: AuthUser) {
    this.menuFor.set(null);
    this.change(user, { disabled: false });
  }

  toggleMenu(user: AuthUser, event: MouseEvent) {
    if (this.menuFor()?.id === user.id) {
      this.menuFor.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Near the bottom of the window the menu opens upward so none of it is cut off
    const room = 310;
    const top =
      rect.bottom + 4 + room > window.innerHeight
        ? Math.max(8, rect.top - 4 - room)
        : rect.bottom + 4;
    this.menuAt.set({ top: Math.round(top), right: Math.round(window.innerWidth - rect.right) });
    this.menuFor.set(user);
  }

  // A click outside the menu closes it, and so does Escape
  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.menuFor()) return;
    if (!(e.target as HTMLElement | null)?.closest?.('.menu-wrap, .menu')) this.menuFor.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuFor.set(null);
    this.notesFor.set(null);
  }

  // The up and down keys walk the menu items, the way the menu key is meant to work
  onMenuKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    all[(next + all.length) % all.length]?.focus();
  }

  ask(user: AuthUser, action: RowAction) {
    this.menuFor.set(null);
    this.error.set('');
    // Renaming starts from the name they have now
    if (action === 'rename') this.renameTo.set(user.username);
    this.pending.set({ user, action });
  }

  openNotes(user: AuthUser) {
    this.menuFor.set(null);
    this.error.set('');
    this.notesFor.set(user);
    this.notes.set([]);
    this.noteText.set('');
    this.loadNotes(user.id);
  }

  closeNotes() {
    this.notesFor.set(null);
  }

  private loadNotes(id: number) {
    this.notesLoading.set(true);
    this.api.userNotes(id).subscribe({
      next: (list) => {
        this.notes.set(list);
        this.notesLoading.set(false);
        this.markNotes(id, list.length > 0);
      },
      error: (err: HttpErrorResponse) => {
        this.notesLoading.set(false);
        this.error.set(errorText(err, 'Could not load the notes'));
      },
    });
  }

  // Keeps the little "note" tag right without reloading the whole list
  private markNotes(id: number, has: boolean) {
    this.users.update((list) => list.map((u) => (u.id === id ? { ...u, hasNotes: has } : u)));
  }

  addNote() {
    const user = this.notesFor();
    if (!user || this.notesBusy()) return;
    const text = this.noteText().trim();
    if (!text) return;
    this.notesBusy.set(true);
    this.error.set('');
    this.api.addUserNote(user.id, text).subscribe({
      next: () => {
        this.notesBusy.set(false);
        this.noteText.set('');
        this.loadNotes(user.id);
      },
      error: (err: HttpErrorResponse) => {
        this.notesBusy.set(false);
        this.error.set(errorText(err));
      },
    });
  }

  removeNote(note: UserNote) {
    const user = this.notesFor();
    if (!user || this.notesBusy()) return;
    this.notesBusy.set(true);
    this.error.set('');
    this.api.deleteUserNote(user.id, note.id).subscribe({
      next: () => {
        this.notesBusy.set(false);
        this.confirmingNote.set(null);
        this.loadNotes(user.id);
      },
      error: (err: HttpErrorResponse) => {
        this.notesBusy.set(false);
        this.confirmingNote.set(null);
        this.error.set(errorText(err));
      },
    });
  }

  formatNote(iso: string): string {
    return this.formatDate(iso);
  }

  // The question for whatever is waiting to be confirmed
  question(): string {
    const p = this.pending();
    if (!p) return '';
    const who = p.user.username;
    switch (p.action) {
      // Each says, in one short line, what happens to the person: these change who can do what
      case 'reset':
        return `Give ${who} a new password? They're signed out everywhere and pick a new one next time.`;
      case 'off':
        return `Turn ${who}'s account off? They're signed out until you turn it back on.`;
      case 'admin':
        return `Make ${who} an admin? They can change rules, restore History and answer requests.`;
      case 'manager':
        return p.user.role === 'admin'
          ? `Make ${who} a manager? They lose rules, History and Settings, and keep tables and backups.`
          : `Make ${who} a manager? They can make, change and delete tables, and restore backups.`;
      case 'normal':
        return `Make ${who} a plain user? They can still add and edit rows, but not tables or backups.`;
      case 'delete':
        return `Delete ${who}'s account? They're signed out at once and can't sign in again.`;
      case 'rename':
        return `Rename ${who}? They sign in with the new name from now on.`;
    }
  }

  confirmLabel(): string {
    const p = this.pending();
    if (!p) return '';
    if (p.action === 'reset') return 'New password';
    if (p.action === 'off') return 'Turn off';
    if (p.action === 'admin') return 'Make admin';
    if (p.action === 'manager') return 'Make manager';
    if (p.action === 'normal') return 'Make user';
    if (p.action === 'rename') return 'Rename';
    return 'Delete account';
  }

  // The actions that take something away get the red button, the rest the filled one
  confirmIsRemoval(): boolean {
    const action = this.pending()?.action;
    return (
      action === 'off' ||
      action === 'normal' ||
      action === 'delete' ||
      (action === 'manager' && this.pending()?.user.role === 'admin')
    );
  }

  confirm() {
    const p = this.pending();
    if (!p || this.busy()) return;
    if (p.action === 'delete') {
      this.busy.set(true);
      this.error.set('');
      this.api.deleteUser(p.user.id).subscribe({
        next: () => {
          this.busy.set(false);
          this.pending.set(null);
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.pending.set(null);
          this.error.set(errorText(err));
        },
      });
      return;
    }
    if (p.action === 'off') {
      this.change(p.user, { disabled: true });
      return;
    }
    if (p.action === 'admin' || p.action === 'manager' || p.action === 'normal') {
      this.change(p.user, { role: p.action });
      return;
    }
    if (p.action === 'rename') {
      const name = this.renameTo().trim().toLowerCase();
      if (!name) {
        this.error.set('Type a username');
        return;
      }
      this.change(p.user, { username: name });
      return;
    }
    this.busy.set(true);
    this.api.resetPassword(p.user.id).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.pending.set(null);
        this.shown.set({
          username: r.user.username,
          password: r.temporaryPassword,
          created: false,
        });
        this.copied.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.pending.set(null);
        this.error.set(errorText(err));
      },
    });
  }

  private change(user: AuthUser, body: { username?: string; role?: string; disabled?: boolean }) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.updateUser(user.id, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.pending.set(null);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.pending.set(null);
        this.error.set(errorText(err));
      },
    });
  }

  // The older account a flagged one clashes with, by the one name rule
  clashesWith(user: AuthUser): string {
    return (
      this.users().find((other) => other.id < user.id && sameName(other.username, user.username))
        ?.username ?? 'another account'
    );
  }

  roleName(role: string): string {
    return role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'User';
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
