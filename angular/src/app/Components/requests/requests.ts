import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DevRequest } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';

type Filter = 'open' | 'done' | 'dismissed' | 'all';

@Component({
  selector: 'app-requests',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './requests.css'],
  templateUrl: './requests.html',
})
export class RequestsPage implements OnInit {
  protected api = inject(IndustryApi);

  requests = signal<DevRequest[]>([]);
  filter = signal<Filter>('open');
  loading = signal(true);
  error = signal('');
  notice = signal('');
  copied = signal<number | null>(null);
  expanded = signal(new Set<number>());

  readonly filters: { value: Filter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'all', label: 'All' },
  ];

  // Plain words for what each request is about
  readonly kinds: Record<DevRequest['kind'], { label: string; icon: string }> = {
    column: { label: 'New column', icon: 'fa-solid fa-table-columns' },
    rename: { label: 'Old column', icon: 'fa-solid fa-right-left' },
    'field-type': { label: 'Field type', icon: 'fa-solid fa-shapes' },
    'restore-layout': { label: 'Old layout', icon: 'fa-solid fa-rotate-left' },
    other: { label: 'Other', icon: 'fa-solid fa-comment' },
  };

  ngOnInit() {
    this.load();
  }

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

  toggleCode(id: number) {
    this.expanded.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  copy(r: DevRequest) {
    if (!r.draftedCode) return;
    navigator.clipboard.writeText(r.draftedCode).then(
      () => { this.copied.set(r.id); setTimeout(() => this.copied.set(null), 2000); },
      () => this.notice.set('Could not copy, select the code and copy it by hand'),
    );
  }

  setStatus(r: DevRequest, status: DevRequest['status']) {
    this.api.setRequestStatus(r.id, status).subscribe({
      next: updated => {
        // Leave the list it no longer belongs in
        this.requests.update(list => this.filter() === 'all' || this.filter() === status
          ? list.map(x => (x.id === r.id ? updated : x))
          : list.filter(x => x.id !== r.id));
        this.api.refreshRequestCount();
      },
      error: (err: HttpErrorResponse) => this.notice.set(errorText(err)),
    });
  }

  // Asking for anything else
  title = signal('');
  details = signal('');
  sending = signal(false);
  sent = signal('');
  sendError = signal('');

  send() {
    this.sending.set(true);
    this.sent.set('');
    this.sendError.set('');
    this.api.askDeveloper(this.title().trim(), this.details().trim()).subscribe({
      next: res => {
        this.sending.set(false);
        this.sent.set(res.status === 200
          ? `This was already asked as request #${res.body?.id}. Your details were added to it.`
          : 'Sent. It shows in the list below and on the bell.');
        this.title.set('');
        this.details.set('');
        this.api.refreshRequestCount();
        if (this.filter() === 'open' || this.filter() === 'all') this.load();
      },
      error: (err: HttpErrorResponse) => { this.sending.set(false); this.sendError.set(errorText(err)); },
    });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
