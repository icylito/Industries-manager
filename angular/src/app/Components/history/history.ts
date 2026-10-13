import { ConfirmPopup } from '../confirm-popup/confirm-popup';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  BackupEntry, BackupRestorePreview, BackupRestoreResult, BackupStatus, ImportPreview, ImportResult, RestoreResult, SettingsFile,
  SettingsImportPreview, VersionDetail, VersionSummary,
} from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';
import { Auth } from '../../services/auth';
import { age } from './age';

type Panel =
  | { kind: 'view'; version: VersionDetail }
  | { kind: 'restore'; version: VersionSummary }
  | { kind: 'import'; version: VersionSummary; preview: ImportPreview };

@Component({
  imports: [RouterLink, ConfirmPopup],
  selector: 'app-history',
  styleUrls: ['../my-components/my-components.css', './history.css'],
  templateUrl: './history.html',
})
export class HistoryPage implements OnInit {
  private api = inject(IndustryApi);
  // Managers only get the Backups card here. Saved versions, retention and the settings file stay admin only.
  auth = inject(Auth);

  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // Which part of the page shows, kept in the address (?tab=) so a reload or a shared link lands on the same one.
  // A manager only has Backups.
  tab = signal<'versions' | 'backups' | 'settings'>(this.startTab());

  private startTab(): 'versions' | 'backups' | 'settings' {
    const asked = this.route.snapshot.queryParamMap.get('tab');
    if (!this.auth.isAdmin()) return 'backups';
    return asked === 'backups' || asked === 'settings' ? asked : 'versions';
  }

  setTab(tab: 'versions' | 'backups' | 'settings') {
    this.tab.set(tab);
    this.router.navigate([], { queryParams: { tab: tab === 'versions' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  versions = signal<VersionSummary[]>([]);
  loading = signal(true);
  error = signal('');
  busy = signal(false);
  panel = signal<Panel | null>(null);
  panelError = signal('');
  notice = signal('');
  restoreNote = signal('');
  // The least a note can be, shared by the button, the hint under it and restore(), so the rule lives in one place
  static readonly noteMin = 10;
  // The API refuses a longer note, see HistoryEndpoints.NoteMax. Change both together.
  static readonly noteMax = 300;
  readonly noteMax = HistoryPage.noteMax;
  noteChars = computed(() => this.restoreNote().trim().length);
  noteTooShort = computed(() => this.noteChars() < HistoryPage.noteMin);
  // The box stops typing at noteMax, so this only guards a value set some other way
  noteTooLong = computed(() => this.noteChars() > HistoryPage.noteMax);
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
    this.loadBackups();
    if (!this.auth.isAdmin()) return;
    this.load();
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
    if (kind === 'before-restore') return 'Taken just before a restore';
    if (kind === 'uploaded') return 'Dropped in from a file';
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

  // The whole backup as one zip, to keep somewhere else and drop back in on this page later
  downloadZip(entry: BackupEntry) {
    this.api.downloadFile(this.api.backupZipUrl(entry.id), `backup-${entry.id}.zip`).subscribe({
      error: (err: HttpErrorResponse) => this.backupError.set(errorText(err, "Couldn't download that backup")),
    });
  }

  // Dropping a backup zip in. It is checked by the API and added to the list; restoring it is still the Restore button.
  dropOver = signal(false);
  uploading = signal(false);
  uploadMsg = signal('');
  uploadError = signal('');
  justAdded = signal<string | null>(null);

  onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this.dropOver.set(true);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dropOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.uploadBackup(file);
  }

  chooseBackupFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.uploadBackup(file);
  }

  uploadBackup(file: File) {
    if (this.uploading()) return;
    this.uploadMsg.set('');
    this.uploadError.set('');
    if (!/\.zip$/i.test(file.name)) {
      this.uploadError.set('That file type is not supported. Use the .zip that Download gave you.');
      return;
    }
    this.uploading.set(true);
    this.api.uploadBackup(file).subscribe({
      next: entry => {
        this.uploading.set(false);
        this.uploadMsg.set(`Added to the list as the backup from ${this.formatDate(entry.createdAt)}, marked below. Press Restore on it to use it.`);
        // It sits at the date it was made, which can be far down the list, so it is marked and brought into view
        this.justAdded.set(entry.id);
        this.loadBackups();
        setTimeout(() => document.getElementById('backup-' + entry.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 400);
      },
      error: (err: HttpErrorResponse) => { this.uploading.set(false); this.uploadError.set(errorText(err, "Couldn't use that file")); },
    });
  }

  downloadBackup(entry: BackupEntry, file: 'main' | 'collector' | 'excel') {
    this.api.downloadFile(this.api.backupDownloadUrl(entry.id, file), `backup-${entry.id}-${file}`).subscribe({
      error: (err: HttpErrorResponse) => this.backupError.set(errorText(err, "Couldn't download that file")),
    });
  }

  // Restore from a backup. The data (the table, its rules, the Tables page) goes back to that night; everything else stays.
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

  // Escape closes whichever question is open, the same way every other overlay in the app closes, and the same way
  // Cancel does. While a restore is running neither the Cancel button nor Escape does anything, so a half-done
  // restore can't be dismissed out from under itself.
  @HostListener('document:keydown.escape')
  onEscape() {
    this.menu.set(null);
    if (this.panel() && !this.busy()) this.close();
    if (this.restoreAsk() && !this.restoreBackupBusy()) this.closeRestoreBackup();
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
        // The restore took a full backup first, so the list has a new one
        this.loadBackups();
        this.api.refreshRequestCount();
        if (!this.auth.isAdmin()) return;
        // The saved versions and the retention boxes come from the restored database now
        this.load();
        this.api.retention().subscribe({ next: r => this.setRetention(r.keepVersions, r.keepDays), error: () => {} });
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
    if (reason.startsWith('Before restoring version')) {
      // The id sits before the note, so it cannot come from the trailing-digits match above: with a note appended
      // there are no trailing digits at all, and that match returns null.
      const rest = reason.slice('Before restoring version '.length);
      const cut = rest.indexOf(' — ');
      if (cut === -1) return `Before restoring version #${rest}`;
      // Split once and keep everything after it. split(' — ') used to drop the tail of any note that had a dash in it.
      return `Before restoring version #${rest.slice(0, cut)} — ${rest.slice(cut + 3)}`;
    }
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

  // The template can only call members, so the helper is handed to it under the name the row uses
  readonly howOld = age;

  // 50,001 rather than 50001, the same as Browse
  readonly count = (n: number): string => n.toLocaleString('en-US');

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private reset() {
    this.panelError.set('');
    this.notice.set('');
    this.restoreNote.set('');
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
    // Restore is a pop up, the others are panels under the list
    if (panel.kind !== 'restore') setTimeout(() => document.getElementById('version-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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

  // Ten saved versions a page, newest first. A delete that empties the last page steps back one.
  versionPage = signal(1);
  readonly versionSize = 10;
  versionPages = computed(() => Math.max(1, Math.ceil(this.versions().length / this.versionSize)));
  pagedVersions = computed(() => {
    const page = Math.min(this.versionPage(), this.versionPages());
    const start = (page - 1) * this.versionSize;
    return this.versions().slice(start, start + this.versionSize);
  });
  shownPage = computed(() => Math.min(this.versionPage(), this.versionPages()));

  goToVersionPage(page: number) {
    this.versionPage.set(Math.max(1, Math.min(page, this.versionPages())));
    this.confirmingVersion.set(null);
  }

  // The open hamburger menu of a saved version or a backup, and where it sits. It is drawn outside the tables because
  // their scrolling box would clip it.
  menu = signal<{ version: VersionSummary } | { backup: BackupEntry } | null>(null);
  menuAt = signal({ top: 0, right: 0 });
  menuVersion = computed(() => { const m = this.menu(); return m && 'version' in m ? m.version : null; });
  menuBackup = computed(() => { const m = this.menu(); return m && 'backup' in m ? m.backup : null; });

  toggleMenu(target: { version: VersionSummary } | { backup: BackupEntry }, event: MouseEvent) {
    const open = this.menu();
    const same = open && (('version' in target && 'version' in open && open.version.id === target.version.id)
      || ('backup' in target && 'backup' in open && open.backup.id === target.backup.id));
    if (same) {
      this.menu.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Near the bottom of the window the menu opens upward so none of it is cut off
    const room = 250;
    const top = rect.bottom + 4 + room > window.innerHeight ? Math.max(8, rect.top - 4 - room) : rect.bottom + 4;
    this.menuAt.set({ top: Math.round(top), right: Math.round(window.innerWidth - rect.right) });
    this.menu.set(target);
  }

  // A click outside the menu closes it, a click on an item closes it too through the item's own handler
  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.menu()) return;
    if (!(e.target as HTMLElement | null)?.closest?.('.menu-btn, .menu')) this.menu.set(null);
  }

  // The up and down keys walk the menu items
  onMenuKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    all[(next + all.length) % all.length]?.focus();
  }

  // Delete asks in the row first, the same way Browse does, because a deleted version can't come back
  confirmingVersion = signal<number | null>(null);
  deletingVersion = signal<number | null>(null);

  deleteVersionById(id: number) {
    const v = this.versions().find(x => x.id === id);
    if (v) this.deleteVersion(v);
  }

  confirmingBackup = signal<string | null>(null);
  deletingBackup = signal(false);

  deleteBackupById(id: string) {
    if (this.deletingBackup()) return;
    this.deletingBackup.set(true);
    this.backupError.set('');
    this.api.deleteBackup(id).subscribe({
      next: () => { this.deletingBackup.set(false); this.confirmingBackup.set(null); this.loadBackups(); },
      error: (err: HttpErrorResponse) => {
        this.deletingBackup.set(false);
        this.confirmingBackup.set(null);
        this.backupError.set(errorText(err, "Couldn't delete that backup"));
        this.loadBackups();
      },
    });
  }

  deleteVersion(v: VersionSummary) {
    if (v.pinned || this.deletingVersion() !== null) return;
    this.deletingVersion.set(v.id);
    this.notice.set('');
    this.api.deleteVersion(v.id).subscribe({
      next: () => {
        this.deletingVersion.set(null);
        this.confirmingVersion.set(null);
        this.versions.update(list => list.filter(x => x.id !== v.id));
        this.versionPage.set(this.shownPage());
        if (this.panel()?.version.id === v.id) this.close();
      },
      error: (err: HttpErrorResponse) => {
        this.deletingVersion.set(null);
        this.confirmingVersion.set(null);
        this.notice.set(errorText(err, "Couldn't delete that version"));
        // Pinned by someone else, or already gone: the list shows how things are now
        if (err.status === 404 || err.status === 409) this.load();
      },
    });
  }

  // Restore
  askRestore(v: VersionSummary) {
    this.show({ kind: 'restore', version: v });
  }

  restore() {
    const p = this.panel();
    const note = this.restoreNote().trim();
    if (p?.kind !== 'restore' || this.noteTooShort() || this.noteTooLong()) return;
    this.busy.set(true);
    this.panelError.set('');
    this.api.restore(p.version.id, note).subscribe({
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

  // A settings file is a few KB. Anything near a megabyte is some other file picked by mistake.
  static readonly SettingsFileMax = 1024 * 1024;

  // Reads the chosen file in the browser, then asks the API what it would change before anything is saved
  chooseSettingsFile(input: HTMLInputElement) {
    const chosen = input.files?.[0];
    input.value = '';
    this.settingsMsg.set('');
    this.settingsError.set('');
    this.settingsAsk.set(null);
    if (!chosen) return;
    if (chosen.size > HistoryPage.SettingsFileMax) {
      this.settingsError.set('That file is too big to be a settings file');
      return;
    }
    chosen.text().then(text => {
      let file: SettingsFile;
      try {
        file = JSON.parse(text);
      } catch {
        this.settingsError.set("That file couldn't be read. Use a file made with Export settings");
        return;
      }
      // A list, a number or a file from another app gets the same answer the API would give, without the call
      if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.app !== 'string') {
        this.settingsError.set("That isn't a settings file from this app. Use a file made with Export settings");
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
