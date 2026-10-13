import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DevRequest, RequestMessage } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';
import { Auth } from '../../services/auth';

type Filter = 'open' | 'in-progress' | 'done' | 'dismissed' | 'all';

@Component({
  selector: 'app-requests',
  imports: [RouterLink],
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './requests.css'],
  templateUrl: './requests.html',
  host: { '(document:click)': 'menuId.set(null)', '(window:scroll)': 'menuId.set(null)', '(window:resize)': 'menuId.set(null)' },
})
export class RequestsPage implements OnInit {
  protected api = inject(IndustryApi);
  protected auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  requests = signal<DevRequest[]>([]);
  filter = signal<Filter>('open');
  loading = signal(true);
  error = signal('');
  notice = signal('');
  // The ticket that is open, from the address /requests/:id. Null shows the list.
  ticketId = signal<number | null>(null);
  // Which row has its menu open
  menuId = signal<number | null>(null);

  readonly filters: { value: Filter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'done', label: 'Done' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'all', label: 'All' },
  ];

  readonly statusLabel: Record<string, string> = {
    open: 'Open',
    'in-progress': 'In progress',
    done: 'Done',
    dismissed: 'Dismissed',
  };

  // Plain words for what each request is about
  readonly kinds: Record<DevRequest['kind'], { label: string; icon: string }> = {
    column: { label: 'New column', icon: 'fa-solid fa-table-columns' },
    rename: { label: 'Old column', icon: 'fa-solid fa-right-left' },
    'field-type': { label: 'Field type', icon: 'fa-solid fa-shapes' },
    'restore-layout': { label: 'Old layout', icon: 'fa-solid fa-rotate-left' },
    other: { label: 'Other', icon: 'fa-solid fa-comment' },
  };

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = Number(params.get('id'));
      if (Number.isInteger(id) && id > 0) {
        this.ticketId.set(id);
        this.openTicket(id);
      } else {
        this.ticketId.set(null);
        this.stopPolling();
        this.load();
      }
    });
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  // The list

  setFilter(f: Filter) {
    this.filter.set(f);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.requests(this.filter()).subscribe({
      next: list => { this.requests.set(list); this.loading.set(false); this.error.set(''); },
      error: (err: HttpErrorResponse) => { this.error.set(errorText(err, 'Could not load the requests')); this.loading.set(false); },
    });
  }

  // The open menu is fixed to the window, the table's scrolling box would cut it off
  menuAt = signal({ top: 0, right: 0 });

  toggleMenu(id: number, e: Event) {
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const room = 190;
    const top = box.bottom + 4 + room > window.innerHeight ? Math.max(8, box.top - 4 - room) : box.bottom + 4;
    this.menuAt.set({ top, right: window.innerWidth - box.right });
    this.menuId.update(current => (current === id ? null : id));
  }

  open(r: DevRequest) {
    this.menuId.set(null);
    this.router.navigate(['/requests', r.id]);
  }

  setStatus(r: DevRequest, status: DevRequest['status']) {
    this.menuId.set(null);
    this.api.setRequestStatus(r.id, status).subscribe({
      next: updated => {
        // Leave the list it no longer belongs in
        this.requests.update(list => this.filter() === 'all' || this.filter() === status
          ? list.map(x => (x.id === r.id ? { ...x, ...updated } : x))
          : list.filter(x => x.id !== r.id));
        if (this.thread()?.id === r.id) this.thread.set({ ...this.thread()!, ...updated });
        this.api.refreshRequestCount();
      },
      error: (err: HttpErrorResponse) => this.notice.set(errorText(err)),
    });
  }

  // Asking for something

  asking = signal(false);
  title = signal('');
  details = signal('');
  // Code the person drafted for it, shown in the ticket under "Show the drafted code"
  code = signal('');
  sending = signal(false);
  sent = signal('');
  sendError = signal('');

  send() {
    this.sending.set(true);
    this.sent.set('');
    this.sendError.set('');
    this.api.askDeveloper(this.title().trim(), this.details().trim(), this.code()).subscribe({
      next: res => {
        this.sending.set(false);
        this.sent.set(res.status === 200
          ? `This was already asked as request #${res.body?.id}. Your details were added to it.`
          : 'Sent! The ticket is in the list.');
        this.title.set('');
        this.details.set('');
        this.code.set('');
        this.api.refreshRequestCount();
        if (this.filter() === 'open' || this.filter() === 'all') this.load();
      },
      error: (err: HttpErrorResponse) => { this.sending.set(false); this.sendError.set(errorText(err)); },
    });
  }

  // One ticket and its conversation

  thread = signal<DevRequest | null>(null);
  messages = signal<RequestMessage[]>([]);
  threadLoading = signal(false);
  threadError = signal('');
  reply = signal('');
  replying = signal(false);
  replyError = signal('');
  codeShown = signal(false);
  copied = signal(false);
  private poll: ReturnType<typeof setInterval> | null = null;

  readonly replyMax = 2000;
  canReply = computed(() => {
    const t = this.thread();
    return !!t && (this.auth.isAdmin() || t.createdBy === this.auth.user()?.username);
  });

  openTicket(id: number) {
    this.threadLoading.set(this.thread()?.id !== id);
    this.threadError.set('');
    this.fetchThread(id);
    this.stopPolling();
    // Refreshed while the page is open and looked at, so an answer shows up without a reload
    this.poll = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.replying()) this.fetchThread(id);
    }, 15000);
  }

  private fetchThread(id: number) {
    this.api.requestThread(id).subscribe({
      next: res => {
        this.thread.set(res.request);
        // Only swapped when something arrived, so the scroll stays where it is
        if (res.messages.length !== this.messages().length || this.messages()[0]?.requestId !== id) {
          this.messages.set(res.messages);
          setTimeout(() => this.scrollChat(), 0);
        }
        this.threadLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.threadLoading.set(false);
        this.threadError.set(errorText(err, 'Could not open that ticket'));
      },
    });
  }

  private stopPolling() {
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }

  private scrollChat() {
    const box = document.getElementById('chat-log');
    if (box) box.scrollTop = box.scrollHeight;
  }

  sendReply() {
    const id = this.ticketId();
    const body = this.reply().trim();
    if (id === null || !body || this.replying()) return;
    this.replying.set(true);
    this.replyError.set('');
    this.api.replyToRequest(id, body).subscribe({
      next: res => {
        this.replying.set(false);
        this.reply.set('');
        this.messages.update(list => [...list, res.message]);
        this.thread.update(t => (t ? { ...t, status: res.status } : t));
        this.api.refreshRequestCount();
        setTimeout(() => this.scrollChat(), 0);
      },
      error: (err: HttpErrorResponse) => { this.replying.set(false); this.replyError.set(errorText(err)); },
    });
  }

  onReplyKey(e: KeyboardEvent) {
    // Enter sends, Shift+Enter makes a new line
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.sendReply();
    }
  }

  copyCode() {
    const code = this.thread()?.draftedCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => { this.copied.set(true); setTimeout(() => this.copied.set(false), 2000); },
      () => this.threadError.set('Could not copy, select the code and copy it by hand'),
    );
  }

  // The short form for the list: no year unless it isn't this one
  formatShort(iso: string): string {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
