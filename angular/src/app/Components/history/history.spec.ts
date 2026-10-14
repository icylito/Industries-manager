import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HistoryPage } from './history';
import { BackupEntry, ImportPreview, Role, SettingsImportPreview, VersionSummary } from '../../models/industry';
import { Auth } from '../../services/auth';

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

  // An admin unless a test says otherwise: a manager only gets the Backups card, so nothing else is loaded for them
  function setup(role: Role = 'admin') {
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role, disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    http.match(r => r.url.endsWith('/history/versions')).forEach(r => r.flush([version(2, true), version(1)]));
    http.match(r => r.url.endsWith('/history/settings')).forEach(r => r.flush({ keepVersions: null, keepDays: null }));
    http.match(r => r.url.endsWith('/backups')).forEach(r => r.flush({ backups, status: null }));
    fixture.detectChanges();
    return fixture;
  }

  // The actions of a row live in a menu that opens from the row's button, drawn outside the table
  function menuItems(fixture: ComponentFixture<unknown>, row: Element): HTMLButtonElement[] {
    const root = fixture.nativeElement as HTMLElement;
    (row.querySelector('.menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.menu button[role="menuitem"]'));
    return items;
  }

  it('marks a damaged version and disables Restore and Bring back for it', () => {
    const fixture = setup();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('table.versions tbody tr');
    expect(rows[0].textContent).toContain('Damaged');
    const buttons = menuItems(fixture, rows[0]).filter(b => /Restore|Bring back/.test(b.textContent ?? ''));
    expect(buttons.length).toBe(2);
    expect(buttons.every(b => b.disabled)).toBe(true);
    const fine = menuItems(fixture, rows[1]).filter(b => /Restore|Bring back/.test(b.textContent ?? ''));
    expect(fine.length).toBe(2);
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
    page.setTab('backups');
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('section.card table.versions tbody tr');
    // One menu element is reused for every row, so each row's state is read while its own menu is open
    const restoreDisabled = Array.from(rows).map(r => menuItems(fixture, r).find(b => /Restore/.test(b.textContent ?? ''))!.disabled);
    expect(restoreDisabled).toEqual([false, true]);
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
    expect(page.settingsError()).toBe('"settings.json" is too big to be a settings file');
    pick('not json'); await settle();
    expect(page.settingsError()).toBe(`"settings.json" couldn't be read. Use a file made with Export settings`);
    pick('[1, 2]'); await settle();
    expect(page.settingsError()).toBe(`"settings.json" isn't a settings file from this app. Use a file made with Export settings`);
    pick('{"retention": {}}'); await settle();
    expect(page.settingsError()).toBe(`"settings.json" isn't a settings file from this app. Use a file made with Export settings`);
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

  // A note is a few words, so the box stops at the same limit the API enforces and counts toward it
  it('limits the note to what the API accepts and shows the count', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#version-panel') as HTMLElement;
    const box = panel.querySelector('input[placeholder="Why go back to this copy?"]') as HTMLInputElement;

    expect(HistoryPage.noteMax).toBe(300);
    expect(box.getAttribute('maxlength')).toBe('300');
    expect(panel.textContent).toContain('0/300');

    const note = 'swapping in the october rows';
    page.restoreNote.set(note);
    fixture.detectChanges();
    expect(panel.textContent).toContain(`${note.length}/300`);

    // A value that got past the box some other way is still never sent
    page.restoreNote.set('x'.repeat(301));
    expect(page.noteTooLong()).toBe(true);
    page.restore();
    http.expectNone(r => r.method === 'POST' && r.url.endsWith('/restore'));

    // Exactly the limit is fine
    page.restoreNote.set('x'.repeat(300));
    expect(page.noteTooLong()).toBe(false);
    page.restore();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/restore'));
    expect((call.request.body as { note: string }).note.length).toBe(300);
    call.flush({ restored: 3, skipped: 0, lostValues: 0, rulesRestored: 0, requestId: null });
  });

  // The API refuses an import that doesn't say what to do about rows already in the table, so the page must always say
  it('always tells the API whether to skip duplicates', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    const preview: ImportPreview = {
      versionId: 1, rulesDiffer: false, message: null, unmatchedColumns: [], total: 2, willImport: 2, skipped: [],
      alreadyImportedFromThisVersion: 0,
      rows: [
        { oldId: 1, name: 'A', values: {}, level: null, problems: [], similarTo: 7, similarInBatch: false, skip: null },
        { oldId: 2, name: 'B', values: {}, level: null, problems: [], similarTo: null, similarInBatch: false, skip: null },
      ],
    };

    page.panel.set({ kind: 'import', version: version(1), preview });
    page.runImport();
    let call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/history/versions/1/import'));
    expect(call.request.body).toEqual({ confirm: true, skipDuplicates: false });
    call.flush({ imported: 2, similar: 1, lostValues: 0, breakingRules: 0, skipped: [], leftOutDuplicates: 0, requestIds: [] });

    page.panel.set({ kind: 'import', version: version(1), preview });
    page.runImport(true);
    call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/history/versions/1/import'));
    expect(call.request.body).toEqual({ confirm: true, skipDuplicates: true });
    call.flush({ imported: 1, similar: 0, lostValues: 0, breakingRules: 0, skipped: [], leftOutDuplicates: 1, requestIds: [] });
  });

  // Bringing the same version back twice puts every row in twice, so the preview says it already happened
  it('warns when rows were already brought back from this version', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    const preview: ImportPreview = {
      versionId: 1, rulesDiffer: false, message: null, unmatchedColumns: [], total: 1, willImport: 1, skipped: [],
      alreadyImportedFromThisVersion: 5,
      rows: [{ oldId: 1, name: 'A', values: {}, level: null, problems: [], similarTo: null, similarInBatch: false, skip: null }],
    };

    page.panel.set({ kind: 'import', version: version(1), preview });
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#version-panel') as HTMLElement;
    expect(panel.textContent).toContain('5 rows were already brought back from this version');

    page.panel.set({ kind: 'import', version: version(1), preview: { ...preview, alreadyImportedFromThisVersion: 0 } });
    fixture.detectChanges();
    expect(panel.textContent).not.toContain('already brought back from this version');
  });

  // The stored reason now carries the note, and the page still reads it as words
  it('reads a saved note back off the reason', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    expect(page.describe('Before restoring version 2 — swapping in the october rows'))
      .toBe('Before restoring version #2 — swapping in the october rows');
  });

  // Restore is a question, so it opens as a pop up over the page and is gone again on close
  it('opens the restore question as a pop up', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#version-panel.restore-modal[role="dialog"]')).toBeTruthy();
    expect(el.querySelector('.modal-backdrop')).toBeTruthy();

    page.close();
    fixture.detectChanges();
    expect(el.querySelector('#version-panel')).toBeFalsy();
    expect(el.querySelector('.modal-backdrop')).toBeFalsy();
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
    page.setTab('backups');
    fixture.detectChanges();

    page.askRestoreBackup(backup('2026-10-07_020000_nightly'));
    http.expectOne(r => r.url.includes('/backups/')).flush({ rowCount: 300, currentRows: 3, rulesVersion: 1, historyReady: true });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#restore-backup')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#restore-backup')).toBeNull();
  });

  it('shows one part at a time and keeps the tab in the address', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    const html = fixture.nativeElement as HTMLElement;
    expect(page.tab()).toBe('versions');
    expect(html.querySelector('.drop-zone')).toBeNull();
    page.setTab('backups');
    fixture.detectChanges();
    expect(html.querySelector('.drop-zone')).not.toBeNull();
    page.setTab('settings');
    fixture.detectChanges();
    expect(html.querySelector('.drop-zone')).toBeNull();
  });

  it('shows ten saved versions a page and moves between pages', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.versions.set(Array.from({ length: 23 }, (_, i) => version(23 - i)));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const ids = () => Array.from(el.querySelectorAll('table.versions td.id')).map(td => td.textContent?.trim());
    expect(ids().length).toBe(10);
    expect(ids()[0]).toBe('#23');
    expect(el.textContent).toContain('Page 1 of 3');

    (el.querySelector('[aria-label="Next page of saved versions"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Next page of saved versions"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(ids()).toEqual(['#3', '#2', '#1']);
    expect(el.textContent).toContain('Showing 21 to 23 of 23');
    expect((el.querySelector('[aria-label="Next page of saved versions"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no pager while every version fits on one page', () => {
    const fixture = setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Next page of saved versions"]')).toBeNull();
  });

  it('asks in the row before deleting a version, then takes it off the list', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    page.confirmingVersion.set(1);
    fixture.detectChanges();
    http.expectNone(r => r.method === 'DELETE');
    expect(el.textContent).toContain('Are you sure?');

    (el.querySelector('app-confirm-popup .add-btn') as HTMLButtonElement).click();
    const del = http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/history/versions/1'));
    del.flush({ deleted: 1 });
    fixture.detectChanges();
    expect(page.versions().map(v => v.id)).toEqual([2]);
    expect(page.confirmingVersion()).toBeNull();
  });

  it('steps back a page when a delete empties the last one', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.versions.set(Array.from({ length: 11 }, (_, i) => version(11 - i)));
    page.goToVersionPage(2);
    page.deleteVersion(version(1));
    http.expectOne(r => r.method === 'DELETE').flush({ deleted: 1 });
    expect(page.versionPages()).toBe(1);
    expect(page.versionPage()).toBe(1);
  });

  it('cannot delete a pinned version', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.versions.set([{ ...version(5), pinned: true }]);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('table.versions tbody tr')!;
    const bin = menuItems(fixture, row).find(b => /Delete/.test(b.textContent ?? ''))!;
    expect(bin.disabled).toBe(true);
    expect(bin.title).toBe('Pinned, unpin it to delete');
    page.deleteVersion({ ...version(5), pinned: true });
    http.expectNone(r => r.method === 'DELETE');
  });

  it('says why a delete was refused and reloads the list', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.deleteVersion(version(1));
    http.expectOne(r => r.method === 'DELETE').flush('Version #1 is pinned. Unpin it first if you want to delete it',
      { status: 409, statusText: 'Conflict' });
    expect(page.notice()).toContain('pinned');
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/history/versions')).flush([{ ...version(1), pinned: true }]);
    expect(page.versions()[0].pinned).toBe(true);
  });

  it('writes big row counts with separators', () => {
    const fixture = setup();
    fixture.componentInstance.versions.set([{ ...version(1), rowCount: 50001 }]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('table.versions td.num-accent')?.textContent).toContain('50,001');
  });
});

describe('HistoryPage for a manager', () => {
  let http: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).user.set({ id: 2, username: 'max', role: 'manager', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/backups')).flush({ backups: [backup('2026-10-07_020000_nightly')], status: null });
    fixture.detectChanges();
    return fixture;
  }

  it('shows only the Backups card and never asks for saved versions or retention', () => {
    const fixture = setup();
    http.expectNone(r => r.url.includes('/history/'));
    const headings = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('h2')).map(h => h.textContent?.trim());
    expect(headings).toEqual(['Backups']);
    expect((fixture.nativeElement as HTMLElement).querySelector('.drop-zone')).toBeTruthy();
  });

  it('sends a dropped zip as a file and says it joined the list', () => {
    const page = setup().componentInstance;
    page.uploadBackup(new File(['zip'], 'backup-2026-10-07_020000_nightly.zip', { type: 'application/zip' }));
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/backups/upload'));
    expect(call.request.body instanceof FormData).toBe(true);
    call.flush({ ...backup('2026-10-09_101500_uploaded'), kind: 'uploaded' });
    http.expectOne(r => r.url.endsWith('/backups')).flush({ backups: [], status: null });
    expect(page.uploadMsg()).toContain('Press Restore');
  });

  it('turns away a file that is not a zip without sending it', () => {
    const page = setup().componentInstance;
    page.uploadBackup(new File(['x'], 'notes.txt'));
    http.expectNone(r => r.url.endsWith('/backups/upload'));
    expect(page.uploadError()).toContain('.zip');
  });

  it('shows the plain refusal the API gives for a file it did not make', () => {
    const page = setup().componentInstance;
    page.uploadBackup(new File(['zip'], 'other.zip'));
    http.expectOne(r => r.url.endsWith('/backups/upload'))
      .flush({ detail: "That file isn't a backup made by this app, so it can't be used. Nothing was changed" }, { status: 400, statusText: 'Bad Request' });
    expect(page.uploadError()).toContain("isn't a backup made by this app");
  });
});