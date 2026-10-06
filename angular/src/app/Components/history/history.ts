import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ImportPreview, ImportResult, RestoreResult, VersionDetail, VersionSummary } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';

type Panel =
  | { kind: 'view'; version: VersionDetail }
  | { kind: 'restore'; version: VersionSummary }
  | { kind: 'import'; version: VersionSummary; preview: ImportPreview };

@Component({
  imports: [RouterLink],
  selector: 'app-history',
  styleUrls: ['../my-components/my-components.css', './history.css'],
  templateUrl: './history.html',
})
export class HistoryPage implements OnInit {
  private api = inject(IndustryApi);

  versions = signal<VersionSummary[]>([]);
  loading = signal(true);
  error = signal('');
  busy = signal(false);
  panel = signal<Panel | null>(null);
  panelError = signal('');
  notice = signal('');
  restoreText = signal('');
  restoreDone = signal<RestoreResult | null>(null);
  importDone = signal<ImportResult | null>(null);

  // Retention, empty means keep everything
  keepVersions = signal<number | null>(null);
  keepDays = signal<number | null>(null);
  retentionMsg = signal('');
  retentionError = signal('');

  ngOnInit() {
    this.load();
    this.api.retention().subscribe({
      next: r => { this.keepVersions.set(r.keepVersions); this.keepDays.set(r.keepDays); },
      error: () => {},
    });
  }

  load() {
    this.api.versions().subscribe({
      next: v => { this.versions.set(v); this.loading.set(false); this.error.set(''); },
      error: (err: HttpErrorResponse) => { this.error.set(errorText(err, 'Could not load the saved versions')); this.loading.set(false); },
    });
  }

  // The reasons come from the API in a short form, this says them in plain words
  describe(reason: string): string {
    const m = reason.match(/(\d+)$/);
    if (reason.startsWith('Before database update')) return 'Before the table was updated';
    if (reason.startsWith('Before rules version')) return 'Before the rules changed';
    if (reason.startsWith('Before restoring version')) return `Before restoring version #${m?.[1]}`;
    if (reason.startsWith('Before importing from version')) return `Before bringing back rows from version #${m?.[1]}`;
    return reason;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private reset() {
    this.panelError.set('');
    this.notice.set('');
    this.restoreText.set('');
    this.restoreDone.set(null);
    this.importDone.set(null);
  }

  close() {
    this.panel.set(null);
    this.reset();
  }

  private show(panel: Panel) {
    this.reset();
    this.panel.set(panel);
    setTimeout(() => document.getElementById('version-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // View
  view(v: VersionSummary) {
    this.busy.set(true);
    this.api.version(v.id).subscribe({
      next: detail => { this.busy.set(false); this.viewPage.set(1); this.show({ kind: 'view', version: detail }); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.notice.set(errorText(err)); },
    });
  }

  viewPage = signal(1);
  readonly viewSize = 10;
  viewColumns = computed(() => {
    const p = this.panel();
    return p?.kind === 'view' ? p.version.columns.filter(c => !['DuplicateOf', 'ImportedFrom', 'LostFields'].includes(c)) : [];
  });
  viewRows = computed(() => {
    const p = this.panel();
    if (p?.kind !== 'view') return [];
    const start = (this.viewPage() - 1) * this.viewSize;
    return p.version.rows.slice(start, start + this.viewSize);
  });
  viewPages = computed(() => {
    const p = this.panel();
    return p?.kind === 'view' ? Math.max(1, Math.ceil(p.version.rows.length / this.viewSize)) : 1;
  });

  cellText(value: unknown): string {
    if (value === null || value === undefined || value === '') return '--';
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null);
      return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(', ') : '--';
    }
    return String(value);
  }

  download(v: VersionSummary) {
    window.location.href = this.api.downloadUrl(v.id);
  }

  // Pin
  togglePin(v: VersionSummary) {
    this.api.pin(v.id, !v.pinned).subscribe({
      next: () => this.versions.update(list => list.map(x => (x.id === v.id ? { ...x, pinned: !v.pinned } : x))),
      error: (err: HttpErrorResponse) => this.notice.set(errorText(err)),
    });
  }

  // Restore
  askRestore(v: VersionSummary) {
    this.show({ kind: 'restore', version: v });
  }

  restore() {
    const p = this.panel();
    if (p?.kind !== 'restore' || this.restoreText() !== 'RESTORE') return;
    this.busy.set(true);
    this.panelError.set('');
    this.api.restore(p.version.id, 'RESTORE').subscribe({
      next: result => { this.busy.set(false); this.restoreDone.set(result); this.load(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.panelError.set(errorText(err)); },
    });
  }

  // Import
  askImport(v: VersionSummary) {
    this.busy.set(true);
    this.api.importPreview(v.id).subscribe({
      next: preview => { this.busy.set(false); this.show({ kind: 'import', version: v, preview }); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.notice.set(errorText(err)); },
    });
  }

  runImport() {
    const p = this.panel();
    if (p?.kind !== 'import') return;
    this.busy.set(true);
    this.panelError.set('');
    this.api.importVersion(p.version.id, true).subscribe({
      next: result => { this.busy.set(false); this.importDone.set(result); this.load(); this.api.refreshRequestCount(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.panelError.set(errorText(err)); },
    });
  }

  // Retention
  toNumber(value: string): number | null {
    return value === '' ? null : Math.floor(Number(value));
  }

  saveRetention() {
    this.retentionMsg.set('');
    this.retentionError.set('');
    this.api.saveRetention({ keepVersions: this.keepVersions(), keepDays: this.keepDays() }).subscribe({
      next: r => {
        this.retentionMsg.set(r.removed ? `Saved. ${r.removed} old version${r.removed === 1 ? '' : 's'} removed.` : 'Saved.');
        if (r.removed) this.load();
      },
      error: (err: HttpErrorResponse) => this.retentionError.set(errorText(err)),
    });
  }
}
