import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Auth } from '../../services/auth';
import { Profile } from '../../services/profile';
import { errorText } from '../../services/industry-api';

type Box = 'current' | 'next' | 'repeat';

// The signed in person's profile card: who they are, at a glance. The name they show changes in place, the picture
// changes from the picture itself, and the panel behind it takes the picture's colours. Changing the password opens
// under it only when asked for, or straight away for an account that has to pick its own password first.
@Component({
  selector: 'app-account',
  imports: [],
  styleUrls: ['../my-components/my-components.css', '../history/history.css', '../login/login.css', './account.css'],
  templateUrl: './account.html',
  host: { '(document:click)': 'clickedAnywhere($event)' },
})
export class AccountPage {
  protected auth = inject(Auth);
  protected profile = inject(Profile);
  private host = inject(ElementRef<HTMLElement>);
  private router = inject(Router);

  current = signal('');
  next = signal('');
  repeat = signal('');
  busy = signal(false);
  // A problem sits under the box it belongs to. Only an answer that belongs to no box goes in error().
  problem = signal<{ box: Box; text: string } | null>(null);
  error = signal('');
  done = signal(false);
  editing = signal(false);
  showForm = computed(() => this.editing() || this.auth.user()?.mustChangePassword === true);

  initial = computed(() => { const user = this.auth.user(); return ((user?.displayName || user?.username) ?? '?').charAt(0).toUpperCase(); });
  // The picture's two colours, or nothing, and the stylesheet's own panel stays
  artBackground = computed(() => { const c = this.profile.colors(); return c ? `linear-gradient(160deg, ${c[0]}, ${c[1]})` : null; });

  menuOpen = signal(false);
  naming = signal(false);
  profileProblem = signal('');

  avatarClicked(picker: HTMLInputElement): void {
    this.profileProblem.set('');
    if (this.profile.picture()) this.menuOpen.update(open => !open);
    else picker.click();
  }

  async pickPicture(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    this.profileProblem.set((await this.profile.setPicture(file)) ?? '');
  }

  async removePicture(): Promise<void> {
    this.menuOpen.set(false);
    this.profileProblem.set((await this.profile.removePicture()) ?? '');
  }

  startNaming(): void {
    this.profileProblem.set('');
    this.naming.set(true);
    setTimeout(() => {
      const box = this.host.nativeElement.querySelector('.profile-name-box') as HTMLInputElement | null;
      box?.focus();
      box?.select();
    }, 0);
  }

  async saveName(event: Event, name: string): Promise<void> {
    event.preventDefault();
    const problem = await this.profile.saveName(name);
    this.profileProblem.set(problem ?? '');
    if (!problem) this.naming.set(false);
  }

  // The picture's menu closes on a click anywhere outside it
  clickedAnywhere(event: MouseEvent): void {
    if (this.menuOpen() && !(event.target as HTMLElement | null)?.closest('.profile-art')) this.menuOpen.set(false);
  }
  roleLabel = computed(() => ({ admin: 'Admin', manager: 'Manager', normal: 'Can edit rows' })[this.auth.user()?.role ?? 'normal']);

  toggle(): void {
    this.editing.update(open => !open);
    this.done.set(false);
    this.problem.set(null);
    this.error.set('');
    if (!this.editing()) {
      this.current.set('');
      this.next.set('');
      this.repeat.set('');
    }
  }

  day(iso: string | null | undefined): string {
    const at = iso ? new Date(iso) : null;
    if (!at || isNaN(at.getTime())) return '--';
    return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  when(iso: string): string {
    const at = new Date(iso);
    if (isNaN(at.getTime())) return '--';
    const today = at.toDateString() === new Date().toDateString();
    return (today ? 'Today' : this.day(iso)) + ', ' + at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  problemFor(box: Box): string | null {
    const p = this.problem();
    return p?.box === box ? p.text : null;
  }

  submit(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    this.error.set('');
    this.problem.set(null);
    this.done.set(false);
    if (this.next().length < 10) {
      this.problem.set({ box: 'next', text: 'The new password has to be at least 10 characters' });
      return;
    }
    if (this.next() !== this.repeat()) {
      this.problem.set({ box: 'repeat', text: "The two new passwords don't match" });
      return;
    }
    if (this.next() === this.current()) {
      this.problem.set({ box: 'next', text: "Pick a password you haven't used just now" });
      return;
    }
    const first = this.auth.user()?.mustChangePassword === true;
    this.busy.set(true);
    this.auth.changePassword(this.current(), this.next()).subscribe({
      next: () => {
        this.busy.set(false);
        this.current.set('');
        this.next.set('');
        this.repeat.set('');
        // A new account has been waiting for this, now it can go to the table
        if (first) this.router.navigateByUrl('/');
        else {
          this.done.set(true);
          this.editing.set(false);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        // The API answers per box too ("current" or "new"), so its words land under the right one
        const errors = err.error?.errors as Record<string, string[]> | undefined;
        if (errors?.['current']?.[0]) this.problem.set({ box: 'current', text: errors['current'][0] });
        else if (errors?.['new']?.[0]) this.problem.set({ box: 'next', text: errors['new'][0] });
        else this.error.set(errorText(err, "Couldn't change the password. Try again in a moment"));
      },
    });
  }
}
