import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HistoryPage } from './history';
import { SettingsImportPreview, VersionSummary } from '../../models/industry';

const version = (id: number, damaged = false): VersionSummary => ({
  id, createdAt: '2026-10-06T12:00:00Z', reason: 'Before rules version 2', createdBy: 'local',
  rowCount: 3, rulesVersion: 1, pinned: false, sameLayout: true, damaged,
});

describe('HistoryPage', () => {
  let http: HttpTestingController;

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
    http.match(r => r.url.endsWith('/backups')).forEach(r => r.flush({ backups: [], status: null }));
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
    page.keepVersions.set(5);
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
});
