import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DevRequest, RequestMessage } from '../../../domain/models/industry';
import { IndustryApi } from '../../../infrastructure/industry-api';
import { errorText } from '../../../application/http-text';
import { Auth } from '../../../application/auth';
import { FormatField } from './format-field';
import { RichText } from './rich-text';

type Filter = 'open' | 'in-progress' | 'done' | 'dismissed' | 'all';

@Component({
  selector: 'app-requests',
  imports: [RouterLink, FormatField, RichText],
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './requests.css'],
  templateUrl: './requests.html',
  host: {
    '(document:click)': 'menuId.set(null)',
    '(window:scroll)': 'menuId.set(null)',
    '(window:resize)': 'menuId.set(null)',
  },
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

  // The formal name of each request type
  readonly kinds: Record<DevRequest['kind'], { label: string; icon: string }> = {
    column: { label: 'Column addition', icon: 'fa-solid fa-table-columns' },
    rename: { label: 'Column restoration', icon: 'fa-solid fa-right-left' },
    'field-type': { label: 'Field type change', icon: 'fa-solid fa-shapes' },
    'restore-layout': { label: 'Layout restoration', icon: 'fa-solid fa-rotate-left' },
    other: { label: 'General request', icon: 'fa-solid fa-comment' },
  };

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
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

  // The filter is one pill with a list rather than five tabs, so it fits a phone and the head stays quiet
  filterMenu = signal(false);
  filterLabel = computed(() => this.filters.find((f) => f.value === this.filter())!.label);

  setFilter(f: Filter) {
    this.filterMenu.set(false);
    this.filter.set(f);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.requests(this.filter()).subscribe({
      next: (list) => {
        this.requests.set(list);
        this.loading.set(false);
        this.error.set('');
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(errorText(err, 'Could not load the requests'));
        this.loading.set(false);
      },
    });
  }

  // The open menu is fixed to the window, the table's scrolling box would cut it off
  menuAt = signal({ top: 0, right: 0 });

  toggleMenu(id: number, e: Event) {
    e.stopPropagation();
    // The click stops here, so the document never hears it and the filter list has to be closed by hand
    this.filterMenu.set(false);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // One item, Open ticket
    const room = 50;
    const top =
      box.bottom + 4 + room > window.innerHeight ? Math.max(8, box.top - 4 - room) : box.bottom + 4;
    this.menuAt.set({ top, right: window.innerWidth - box.right });
    this.menuId.update((current) => (current === id ? null : id));
  }

  open(r: DevRequest) {
    this.menuId.set(null);
    this.router.navigate(['/requests', r.id]);
  }

  // Who may change a ticket's status. Admins today, a permission from the roles panel later, and this is the one
  // place that changes when it comes. The API checks it again.
  canSetStatus = computed(() => this.auth.isAdmin());

  readonly statusOptions: DevRequest['status'][] = ['open', 'in-progress', 'done', 'dismissed'];

  // The status menu of the open ticket, the only place a status changes. A native select can't centre its list, so
  // this one is drawn with buttons.
  statusMenu = signal<number | null>(null);

  toggleStatusMenu(id: number) {
    this.statusMenu.update((open) => (open === id ? null : id));
  }

  pickStatus(r: DevRequest, status: DevRequest['status']) {
    this.statusMenu.set(null);
    this.setStatus(r, status);
  }

  // A click anywhere outside the menu closes it
  @HostListener('document:click', ['$event'])
  closeStatusMenu(event: Event) {
    const target = event.target as HTMLElement;
    if (this.statusMenu() !== null && !target.closest('.status-menu')) this.statusMenu.set(null);
    if (this.filterMenu() && !target.closest('.filter-menu')) this.filterMenu.set(false);
  }

  setStatus(r: DevRequest, status: DevRequest['status']) {
    this.menuId.set(null);
    this.api.setRequestStatus(r.id, status).subscribe({
      next: (updated) => {
        // Leave the list it no longer belongs in
        this.requests.update((list) =>
          this.filter() === 'all' || this.filter() === status
            ? list.map((x) => (x.id === r.id ? { ...x, ...updated } : x))
            : list.filter((x) => x.id !== r.id),
        );
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

  private askBox = viewChild<ElementRef<HTMLElement>>('askBox');
  private askTitle = viewChild<ElementRef<HTMLInputElement>>('askTitle');
  private newTicketBtn = viewChild<ElementRef<HTMLButtonElement>>('newTicketBtn');

  constructor() {
    // The list behind the pop up stays still while it is open
    effect(() => {
      document.body.style.overflow = this.asking() ? 'hidden' : '';
    });
    this.destroyRef.onDestroy(() => {
      document.body.style.overflow = '';
    });
  }

  openAsk() {
    this.sent.set('');
    this.asking.set(true);
    setTimeout(() => this.askTitle()?.nativeElement.focus());
  }

  // Closing keeps what was typed, so a stray click on the backdrop loses nothing. Not while it is sending.
  closeAsk() {
    if (this.sending()) return;
    this.asking.set(false);
    setTimeout(() => this.newTicketBtn()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.asking()) this.closeAsk();
  }

  // Tab and Shift+Tab go round the pop up instead of wandering onto the page behind it
  trapFocus(e: KeyboardEvent) {
    const box = this.askBox()?.nativeElement;
    if (e.key !== 'Tab' || !box) return;
    const items = [
      ...box.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, [contenteditable="true"]',
      ),
    ].filter((el) => el.tabIndex >= 0);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  send() {
    if (this.sending()) return;
    this.sending.set(true);
    this.sent.set('');
    this.sendError.set('');
    this.api.askDeveloper(this.title().trim(), this.details().trim(), this.code()).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.sent.set(
          res.status === 200
            ? `This was already asked as request #${res.body?.id}. Your details were added to it.`
            : 'Sent! The ticket is in the list.',
        );
        this.title.set('');
        this.details.set('');
        this.code.set('');
        this.closeAsk();
        this.api.refreshRequestCount();
        if (this.filter() === 'open' || this.filter() === 'all') this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.sendError.set(errorText(err));
      },
    });
  }

  // One ticket and its conversation

  thread = signal<DevRequest | null>(null);
  messages = signal<RequestMessage[]>([]);
  // Shown in the ticket's facts, so a glance says whether anyone has answered lately
  lastReply = computed(() => this.messages().at(-1) ?? null);
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
      next: (res) => {
        this.thread.set(res.request);
        // Only swapped when something arrived, so the scroll stays where it is
        if (
          res.messages.length !== this.messages().length ||
          this.messages()[0]?.requestId !== id
        ) {
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
      next: (res) => {
        this.replying.set(false);
        this.reply.set('');
        this.messages.update((list) => [...list, res.message]);
        this.thread.update((t) => (t ? { ...t, status: res.status } : t));
        this.api.refreshRequestCount();
        setTimeout(() => this.scrollChat(), 0);
      },
      error: (err: HttpErrorResponse) => {
        this.replying.set(false);
        this.replyError.set(errorText(err));
      },
    });
  }

  copyCode() {
    const code = this.thread()?.draftedCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      },
      () => this.threadError.set('Could not copy, select the code and copy it by hand'),
    );
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
