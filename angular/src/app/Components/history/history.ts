import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  BackupEntry, BackupRestorePreview, BackupRestoreResult, BackupStatus, ImportPreview, ImportResult, RestoreResult, SettingsFile,
  SettingsImportPreview, VersionDetail, VersionSummary,
} from '../../models/industry';
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

  // Retention, empty means keep everything. The boxes keep their text so a bad value can be refused before anything is sent.
  keepVersionsText = signal('');
  keepDaysText = signal('');
  keepVersions = computed(() => this.toNumber(this.keepVersionsText()));
  keepDays = computed(() => this.toNumber(this.keepDaysText()));
  retentionMsg = signal('');
  retentionError = signal('');

  backups = signal<BackupEntry[]>([]);
  backupStatus = signal<BackupStatus | null>(null);
  backupsLoaded = signal(false);
  backingUp = signal(false);
  backupMsg = signal('');
  backupError = signal('');

  ngOnInit() {
    this.load();
    this.loadBackups();
    this.api.retention().subscribe({
      next: r => this.setRetention(r.keepVersions, r.keepDays),
      error: () => {},
    });
  }

  private setRetention(versions: number | null, days: number | null) {
    this.keepVersionsText.set(versions === null ? '' : String(versions));
    this.keepDaysText.set(days === null ? '' : String(days));
  }

  loadBackups() {
    this.api.backups().subscribe({
      next: body => { this.backups.set(body.backups); this.backupStatus.set(body.status); this.backupsLoaded.set(true); },
      error: (err: HttpErrorResponse) => this.backupError.set(errorText(err)),
    });
  }

  // "2:00 AM", same clock the rest of this page uses
  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  backupIntro(): string {
    const status = this.backupStatus();
    const days = status?.keepDays ?? 14;
    const time = status ? this.formatTime(status.nextNightly) : '2:00 AM';
    return `A full copy of the database every night at ${time}, kept for ${days} ${days === 1 ? 'day' : 'days'}.`;
  }

  kindLabel(kind: string): string {
    if (kind === 'nightly') return 'Nightly';
    if (kind === 'manual') return 'Manual';
    return kind;
  }

  // KB under 1 MB, MB from there. One decimal under 10, whole numbers above.
  kb(bytes: number): string {
    const mb = bytes >= 1024 * 1024;
    const n = bytes / (mb ? 1024 * 1024 : 1024);
    const text = n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1);
    return `${text} ${mb ? 'MB' : 'KB'}`;
  }

  backupNow() {
    this.backingUp.set(true);
    this.backupMsg.set('');
    this.backupError.set('');
    this.api.backupNow().subscribe({
      next: entry => {
        this.backingUp.set(false);
        this.backupMsg.set(`Backed up. Main ${this.kb(entry.mainSize)}, history ${this.kb(entry.collectorSize)}.`);
        this.loadBackups();
      },
      error: (err: HttpErrorResponse) => {
        this.backingUp.set(false);
        this.backupError.set(errorText(err));
        this.loadBackups();
      },
    });
  }

  downloadBackup(entry: BackupEntry, file: 'main' | 'collector' | 'excel') {
    this.api.downloadFile(this.api.backupDownloadUrl(entry.id, file), `backup-${entry.id}-${file}`).subscribe({
      error: (err: HttpErrorResponse) => this.backupError.set(errorText(err, "Couldn't download that file")),
    });
  }

  // Restore from a backup. The table, its rules, settings and requests go back to that night, accounts stay.
  restoreAsk = signal<{ entry: BackupEntry; preview: BackupRestorePreview } | null>(null);
  restoreBackupText = signal('');
  restoreBackupBusy = signal(false);
  restoreBackupDone = signal<BackupRestoreResult | null>(null);
  restoreBackupError = signal('');

  askRestoreBackup(entry: BackupEntry) {
    this.restoreBackupDone.set(null);
    this.restoreBackupError.set('');
    this.restoreBackupText.set('');
    this.restoreBackupBusy.set(true);
    this.api.backupRestorePreview(entry.id).subscribe({
      next: preview => { this.restoreBackupBusy.set(false); this.restoreAsk.set({ entry, preview }); },
      error: (err: HttpErrorResponse) => { this.restoreBackupBusy.set(false); this.restoreBackupError.set(errorText(err)); },
    });
  }

  closeRestoreBackup() {
    this.restoreAsk.set(null);
    this.restoreBackupText.set('');
  }

  restoreBackup() {
    const ask = this.restoreAsk();
    if (!ask || this.restoreBackupText() !== 'RESTORE' || this.restoreBackupBusy()) return;
    this.restoreBackupBusy.set(true);
    this.restoreBackupError.set('');
    this.api.restoreBackup(ask.entry.id, 'RESTORE').subscribe({
      next: result => {
        this.restoreBackupBusy.set(false);
        this.restoreAsk.set(null);
        this.restoreBackupDone.set(result);
        // The saved versions and the retention boxes come from the restored database now
        this.load();
        this.api.retention().subscribe({ next: r => this.setRetention(r.keepVersions, r.keepDays), error: () => {} });
        this.api.refreshRequestCount();
      },
      error: (err: HttpErrorResponse) => { this.restoreBackupBusy.set(false); this.restoreBackupError.set(errorText(err)); },
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
    if (reason.startsWith('Before restoring backup')) return `Before restoring the backup from ${this.backupDate(reason.slice('Before restoring backup '.length))}`;
    return reason;
  }

  // A backup id looks like 2026-10-07_020000_nightly, this turns it into the date and time people see in the Backups card
  backupDate(id: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(id);
    if (!m) return id;
    const [, y, mo, d, h, mi] = m;
    return this.formatDate(new Date(+y, +mo - 1, +d, +h, +mi).toISOString());
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
    this.api.downloadFile(this.api.downloadUrl(v.id), `version-${v.id}.csv`).subscribe({
      error: (err: HttpErrorResponse) => this.notice.set(errorText(err, "Couldn't download that file")),
    });
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

  // Rows the preview marked as already in the table, or twice in this import
  duplicateCount(rows: { similarTo: number | null; similarInBatch: boolean; skip: string | null }[]): number {
    return rows.filter(r => !r.skip && (r.similarTo !== null || r.similarInBatch)).length;
  }

  // Which import button is running, so only that one spins
  skippingDups = signal(false);

  runImport(skipDuplicates = false) {
    const p = this.panel();
    if (p?.kind !== 'import') return;
    this.skippingDups.set(skipDuplicates);
    this.busy.set(true);
    this.panelError.set('');
    this.api.importVersion(p.version.id, true, skipDuplicates).subscribe({
      next: result => { this.busy.set(false); this.importDone.set(result); this.load(); this.api.refreshRequestCount(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.panelError.set(errorText(err)); },
    });
  }

  // Settings file, Export settings and Import settings
  settingsAsk = signal<{ file: SettingsFile; preview: SettingsImportPreview } | null>(null);
  settingsBusy = signal(false);
  settingsMsg = signal('');
  settingsError = signal('');

  exportSettings() {
    this.api.downloadFile(this.api.settingsExportUrl(), 'settings.json').subscribe({
      error: (err: HttpErrorResponse) => this.settingsError.set(errorText(err, "Couldn't download that file")),
    });
  }

  // Reads the chosen file in the browser, then asks the API what it would change before anything is saved
  chooseSettingsFile(input: HTMLInputElement) {
    const chosen = input.files?.[0];
    input.value = '';
    this.settingsMsg.set('');
    this.settingsError.set('');
    this.settingsAsk.set(null);
    if (!chosen) return;
    chosen.text().then(text => {
      let file: SettingsFile;
      try {
        file = JSON.parse(text);
      } catch {
        this.settingsError.set("That file couldn't be read. Use a file made with Export settings");
        return;
      }
      this.settingsBusy.set(true);
      this.api.previewSettingsImport(file).subscribe({
        next: preview => { this.settingsBusy.set(false); this.settingsAsk.set({ file, preview }); },
        error: (err: HttpErrorResponse) => { this.settingsBusy.set(false); this.settingsError.set(errorText(err)); },
      });
    });
  }

  // One plain sentence about what the file would change
  settingsSummary(p: SettingsImportPreview): string {
    const parts: string[] = [];
    if (p.rulesChanged) parts.push('the field labels and limits');
    if (p.retentionChanged && p.retention) {
      const keep = p.retention.keepVersions ? `keep the last ${p.retention.keepVersions} versions` : 'keep every version';
      const days = p.retention.keepDays ? `, remove ones older than ${p.retention.keepDays} days` : '';
      parts.push(`how long old versions are kept (${keep}${days})`);
    }
    if (parts.length === 0) return 'Nothing in this file is different from today, so nothing would change.';
    return `This changes ${parts.join(' and ')}.`;
  }

  importSettings() {
    const ask = this.settingsAsk();
    if (!ask) return;
    this.settingsBusy.set(true);
    this.settingsError.set('');
    this.api.importSettings(ask.file).subscribe({
      next: r => {
        this.settingsBusy.set(false);
        this.settingsAsk.set(null);
        const removed = r.removed ? ` ${r.removed} old version${r.removed === 1 ? '' : 's'} removed.` : '';
        this.settingsMsg.set(`Settings imported.${removed}`);
        this.api.retention().subscribe({ next: x => this.setRetention(x.keepVersions, x.keepDays), error: () => {} });
        this.load();
      },
      error: (err: HttpErrorResponse) => { this.settingsBusy.set(false); this.settingsError.set(errorText(err)); },
    });
  }

  // Retention. Empty is null (no limit). Anything that isn't a whole number of 1 or more is NaN, which the save refuses.
  toNumber(value: string): number | null {
    if (value.trim() === '') return null;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : NaN;
  }

  static readonly RetentionProblem = 'Use a whole number of 1 or more, or leave the box empty';

  // How many versions the settings would remove, set while the page asks before saving
  retentionAsk = signal<number | null>(null);
  retentionBusy = signal(false);

  // Saving asks first when it would remove saved versions, because that can't be undone
  saveRetention() {
    this.retentionMsg.set('');
    this.retentionError.set('');
    this.retentionAsk.set(null);
    const body = { keepVersions: this.keepVersions(), keepDays: this.keepDays() };
    if (Number.isNaN(body.keepVersions) || Number.isNaN(body.keepDays)) {
      this.retentionError.set(HistoryPage.RetentionProblem);
      return;
    }
    this.retentionBusy.set(true);
    this.api.previewRetention(body).subscribe({
      next: p => {
        if (p.willRemove > 0) {
          this.retentionBusy.set(false);
          this.retentionAsk.set(p.willRemove);
        } else {
          this.sendRetention(body);
        }
      },
      error: (err: HttpErrorResponse) => { this.retentionBusy.set(false); this.retentionError.set(errorText(err)); },
    });
  }

  confirmRetention() {
    this.retentionAsk.set(null);
    this.retentionBusy.set(true);
    this.sendRetention({ keepVersions: this.keepVersions(), keepDays: this.keepDays() });
  }

  private sendRetention(body: { keepVersions: number | null; keepDays: number | null }) {
    this.api.saveRetention(body).subscribe({
      next: r => {
        this.retentionBusy.set(false);
        this.retentionMsg.set(r.removed ? `Saved. ${r.removed} old version${r.removed === 1 ? '' : 's'} removed.` : 'Saved.');
        if (r.removed) this.load();
      },
      error: (err: HttpErrorResponse) => { this.retentionBusy.set(false); this.retentionError.set(errorText(err)); },
    });
  }
}
