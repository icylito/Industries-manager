import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { IndustryApi, fileNameFrom } from './industry-api';
import { environment } from '../../environments/environment';

describe('IndustryApi', () => {
  let service: IndustryApi;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(IndustryApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // E4: the file name out of Content-Disposition, every shape the API and browsers send
  it('reads the file name from Content-Disposition', () => {
    expect(fileNameFrom(`attachment; filename=settings-2026-10-06.json; filename*=UTF-8''settings-2026-10-06.json`, 'x')).toBe('settings-2026-10-06.json');
    expect(fileNameFrom('attachment; filename="my file.csv"', 'x')).toBe('my file.csv');
    expect(fileNameFrom(`attachment; filename="???.csv"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.csv`, 'x')).toBe('日本.csv');
    expect(fileNameFrom(null, 'fallback.csv')).toBe('fallback.csv');
    expect(fileNameFrom('attachment', 'fallback.csv')).toBe('fallback.csv');
    expect(fileNameFrom(`attachment; filename*=UTF-8''%E6%97%A5%ZZ.csv`, 'fallback.csv')).toBe('fallback.csv');
    expect(fileNameFrom('attachment; filename="../../evil.csv"', 'x')).toBe('.._.._evil.csv');
  });

  it('hands an error to the caller and downloads nothing', () => {
    const http = TestBed.inject(HttpTestingController);
    const create = vi.spyOn(document, 'createElement');
    let failed: unknown = null;
    service.downloadFile(`${environment.apiUrl}/backups/x/main`, 'main.dump').subscribe({ error: e => failed = e });
    http.expectOne(`${environment.apiUrl}/backups/x/main`).error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    expect(failed).not.toBeNull();
    expect(create).not.toHaveBeenCalledWith('a');
  });

  it('calls the API address from the environment file', () => {
    const http = TestBed.inject(HttpTestingController);
    service.previewRetention({ keepVersions: 5, keepDays: null }).subscribe();
    const req = http.expectOne(`${environment.apiUrl}/history/settings/preview`);
    expect(req.request.method).toBe('POST');
    req.flush({ willRemove: 0 });
  });
});
