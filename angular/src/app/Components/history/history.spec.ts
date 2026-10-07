import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HistoryPage } from './history';
import { BackupEntry, SettingsImportPreview, VersionSummary } from '../../models/industry';

const version = (id: number, damaged = false): VersionSummary => ({
  id, createdAt: '2026-10-06T12:00:00Z', reason: 'Before rules version 2', createdBy: 'local',
  rowCount: 3, rulesVersion: 1, pinned: false, sameLayout: true, damaged,
});

const backup = (id: string, sameLayout: boolean | null = true): BackupEntry => ({
  id, createdAt: '2026-10-07T02:00:00Z', kind: 'nightly', by: 'scheduled', mainSize: 20000, collectorSize: 30000,
  rulesVersion: 2, hasExcel: true, rowCount: 300, sameLayout,
});

describe('HistoryPage', () => {
  let http: HttpTestingController;
  let backups: BackupEntry[] = [];

  function setup() {
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    http.match(r => r.url.endsWith('/history/versions')).forEach(r => r.flush([version(2, true), version(1)]));
    http.match(r => r.url.endsWith('/history/settings')).forEach(r => r.flush({ keepVersions: null, keepDays: null }));
    http.match(r => r.url.endsWith('/backups')).forEach(r => r.flush({ backups, status: null }));
    fixture.detectChanges();
    return fixture;
  }

  it('marks a damaged version and disables Restore and Bring back for it', () => {
    const fixture = setup();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('table.versions tbody tr');
    expect(rows[0].textContent).toContain('Damaged');
    const buttons = Array.from(rows[0].querySelectorAll('button')).filter(b => /Restore|Bring back/.test(b.textContent ?? ''));
    expect(buttons.length).toBe(2);
    expect(buttons.every(b => b.disabled)).toBe(true);
    const fine = Array.from(rows[1].querySelectorAll('button')).filter(b => /Restore|Bring back/.test(b.textContent ?? ''));
    expect(fine.every(b => !b.disabled)).toBe(true);
  });

  it('asks before saving retention that would remove versions', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.keepVersionsText.set('5');
    page.saveRetention();
    http.expectOne(r => r.url.endsWith('/history/settings/preview')).flush({ willRemove: 37 });
    expect(page.retentionAsk()).toBe(37);
    http.expectNone(r => r.method === 'PUT' && r.url.endsWith('/history/settings'));

    page.confirmRetention();
    const save = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/history/settings'));
    expect(save.request.body).toEqual({ keepVersions: 5, keepDays: null });
    save.flush({ keepVersions: 5, keepDays: null, removed: 37 });
    expect(page.retentionMsg()).toContain('37 old versions removed');
  });

  it('saves retention straight away when nothing would be removed', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.saveRetention();
    http.expectOne(r => r.url.endsWith('/history/settings/preview')).flush({ willRemove: 0 });
    expect(page.retentionAsk()).toBeNull();
    http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/history/settings'))
      .flush({ keepVersions: null, keepDays: null, removed: 0 });
    expect(page.retentionMsg()).toBe('Saved.');
  });

  it('refuses retention that is not a whole number of 1 or more and sends nothing', () => {
    const page = setup().componentInstance;
    for (const bad of ['-5', '0', 'abc', '1e400']) {
      page.keepVersionsText.set(bad);
      page.saveRetention();
      expect(page.retentionError()).toBe('Use a whole number of 1 or more, or leave the box empty');
      http.expectNone(r => r.url.endsWith('/history/settings/preview'));
      http.expectNone(r => r.method === 'PUT' && r.url.endsWith('/history/settings'));
    }
    // 2.7 becomes 2, empty means no limit
    page.keepVersionsText.set('2.7');
    page.keepDaysText.set('');
    page.saveRetention();
    const preview = http.expectOne(r => r.url.endsWith('/history/settings/preview'));
    expect(preview.request.body).toEqual({ keepVersions: 2, keepDays: null });
  });

  it('offers Restore only for backups with the same table layout and asks for RESTORE first', () => {
    backups = [backup('2026-10-07_020000_nightly'), backup('2026-10-06_020000_nightly', false)];
    const fixture = setup();
    backups = [];
    const page = fixture.componentInstance;
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('section.card table.versions tbody tr');
    const restoreButtons = Array.from(rows).map(r => Array.from(r.querySelectorAll('button')).find(b => /Restore/.test(b.textContent ?? ''))!);
    expect(restoreButtons[0].disabled).toBe(false);
    expect(restoreButtons[1].disabled).toBe(true);
    expect(rows[1].textContent).toContain('Other table layout');

    page.askRestoreBackup(backups[0] ?? backup('2026-10-07_020000_nightly'));
    http.expectOne(r => r.url.endsWith('/backups/2026-10-07_020000_nightly/restore/preview'))
      .flush({ id: '2026-10-07_020000_nightly', createdAt: '2026-10-07T02:00:00Z', rulesVersion: 2, rowCount: 300, sameLayout: true, currentRows: 281, historyReady: true });
    expect(page.restoreAsk()).not.toBeNull();

    // Nothing is sent until the word is typed
    page.restoreBackup();
    http.expectNone(r => r.method === 'POST' && r.url.endsWith('/restore'));
    page.restoreBackupText.set('RESTORE');
    page.restoreBackup();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/backups/2026-10-07_020000_nightly/restore'));
    expect(call.request.body).toEqual({ confirm: 'RESTORE' });
    call.flush({ backup: '2026-10-07_020000_nightly', rowsBefore: 281, rows: 300, rulesVersion: 2, copyId: 9 });
    expect(page.restoreAsk()).toBeNull();
    expect(page.restoreBackupDone()?.rows).toBe(300);
    // The saved versions and the retention boxes are read again from the restored database
    http.expectOne(r => r.url.endsWith('/history/versions'));
    http.expectOne(r => r.url.endsWith('/history/settings'));
  });

  // E6: the settings file is checked on the page before anything goes to the API
  it('refuses a settings file that is too big, not JSON, a list, or from another app', async () => {
    const page = setup().componentInstance;
    const pick = (content: string, size?: number) => {
      const file = new File([content], 'settings.json', { type: 'application/json' });
      if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      page.chooseSettingsFile(input);
    };
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    pick('{}', 2 * 1024 * 1024); await settle();
    expect(page.settingsError()).toBe('That file is too big to be a settings file');
    pick('not json'); await settle();
    expect(page.settingsError()).toBe("That file couldn't be read. Use a file made with Export settings");
    pick('[1, 2]'); await settle();
    expect(page.settingsError()).toBe("That isn't a settings file from this app. Use a file made with Export settings");
    pick('{"retention": {}}'); await settle();
    expect(page.settingsError()).toBe("That isn't a settings file from this app. Use a file made with Export settings");
    http.expectNone(r => r.url.endsWith('/history/settings/import/preview'));

    pick('{"app": "stock-listing", "format": 1}'); await settle();
    http.expectOne(r => r.url.endsWith('/history/settings/import/preview'));
  });

  it('names the backup a version was saved before', () => {
    const page = setup().componentInstance;
    expect(page.describe('Before restoring backup 2026-10-07_020000_nightly')).toMatch(/^Before restoring the backup from Oct 7, 2026/);
  });

  it('says in plain words what a settings file would change', () => {
    const page = setup().componentInstance;
    const preview: SettingsImportPreview = {
      rulesChanged: true, retentionChanged: true, retention: { keepVersions: 20, keepDays: 30 },
      ignored: [], willRemove: 0,
    };
    expect(page.settingsSummary(preview)).toBe(
      'This changes the field labels and limits and how long old versions are kept (keep the last 20 versions, remove ones older than 30 days).');
    expect(page.settingsSummary({ ...preview, rulesChanged: false, retentionChanged: false }))
      .toContain('nothing would change');
  });

  // The word RESTORE is replaced by a note that says why, and the note is kept with the copy the restore saves
  it('asks for a note before restoring a saved version', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    // Scoped to the panel on purpose: the Backups card further down this same page keeps its own typed RESTORE,
    // so a whole-page assertion would fail for the wrong reason.
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#version-panel') as HTMLElement;
    expect(panel.textContent).not.toContain('Type RESTORE');
    expect(page.restoreNote()).toBe('');

    // Too short: nothing is sent
    page.restoreNote.set('too short');
    page.restore();
    http.expectNone(r => r.method === 'POST' && r.url.endsWith('/restore'));

    // Long enough: the note travels with it
    page.restoreNote.set('swapping in the october rows');
    page.restore();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/restore'));
    expect(call.request.body).toEqual({ note: 'swapping in the october rows' });
    call.flush({ restored: 3, skipped: 0, lostValues: 0, rulesRestored: 0, requestId: null });
  });

  // The stored reason now carries the note, and the page still reads it as words
  it('reads a saved note back off the reason', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    expect(page.describe('Before restoring version 2 — swapping in the october rows'))
      .toBe('Before restoring version #2 — swapping in the october rows');
  });

  // Orange flash on the way in, so the eye lands on the question. jsdom can't see the animation itself; Task 7 does.
  it('marks the restore panel so it can glow as it opens', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel.glow')).toBeTruthy();

    page.close();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel.glow')).toBeFalsy();
  });

  it('says how old each saved copy is', () => {
    const fixture = setup();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('table.versions tbody tr');
    expect(rows[0].textContent).toMatch(/less than an hour|hours|day/);
  });

  // A note can have a dash of its own. Splitting on every ' — ' used to drop everything after the second one,
  // so the row read as if the note ended early.
  it('keeps a whole note that has a dash in it', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    expect(page.describe('Before restoring version 6 — back to october — because the rules were wrong'))
      .toBe('Before restoring version #6 — back to october — because the rules were wrong');
    expect(page.describe('Before restoring version 6')).toBe('Before restoring version #6');
    expect(page.describe('Before restoring version 6 — ')).toBe('Before restoring version #6 — ');
  });

  // The button is grey until there is enough, so the page has to say how much is enough and how much is missing
  it('says the least length under the note box, and drops it once there is enough', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    const panel = (fixture.nativeElement as HTMLElement).querySelector('#version-panel') as HTMLElement;
    const box = panel.querySelector('input') as HTMLInputElement;
    expect(panel.textContent).toContain('at least 10 characters');
    expect(panel.textContent).toContain('so the next person knows why');
    expect(box.getAttribute('aria-describedby')).toBe('restore-note-hint');

    page.restoreNote.set('abc');
    fixture.detectChanges();
    expect(panel.textContent).toContain('3 of 10 characters');

    page.restoreNote.set('swapping in the october rows');
    fixture.detectChanges();
    expect(panel.textContent).not.toContain('of 10 characters');
    expect(box.getAttribute('aria-describedby')).toBeNull();
  });

  // Every other overlay here closes on Escape, and so does the Cancel button beside it
  it('closes the restore question on Escape', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel')).toBeNull();
    expect(page.restoreNote()).toBe('');
  });

  it('closes the backup restore question on Escape too', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestoreBackup(backup('2026-10-07_020000_nightly'));
    http.expectOne(r => r.url.includes('/backups/')).flush({ rowCount: 300, currentRows: 3, rulesVersion: 1, historyReady: true });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#restore-backup')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#restore-backup')).toBeNull();
  });
});
