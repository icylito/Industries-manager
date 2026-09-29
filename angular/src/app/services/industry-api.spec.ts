import { TestBed } from '@angular/core/testing';
import { IndustryApi } from './industry-api';

describe('IndustryApi', () => {
  let service: IndustryApi;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IndustryApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
