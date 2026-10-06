import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { IndustryApi } from './industry-api';
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

  it('calls the API address from the environment file', () => {
    const http = TestBed.inject(HttpTestingController);
    service.previewRetention({ keepVersions: 5, keepDays: null }).subscribe();
    const req = http.expectOne(`${environment.apiUrl}/history/settings/preview`);
    expect(req.request.method).toBe('POST');
    req.flush({ willRemove: 0 });
  });
});
