import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScratchpadPage } from './scratchpad';
import { Scratchpad } from '../../services/scratchpad';
import { environment } from '../../../environments/environment';

const url = environment.apiUrl + '/scratchpad';

describe('Scratchpad page', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScratchpadPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('opens an empty board', async () => {
    const fixture = TestBed.createComponent(ScratchpadPage);
    fixture.detectChanges();
    http.expectOne(url).flush({ document: { version: 1, view: { x: 0, y: 0, zoom: 1 }, items: [] }, updatedAt: null });
    http.expectOne(environment.apiUrl + '/industries').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.canvas')).toBeTruthy();
    expect(el.querySelectorAll('.item').length).toBe(0);
    expect(el.textContent).toContain('Drag a company from the list');
  });

  it('adds a note and undo takes it away again', async () => {
    const fixture = TestBed.createComponent(ScratchpadPage);
    fixture.detectChanges();
    http.expectOne(url).flush({ document: { version: 1, view: { x: 0, y: 0, zoom: 1 }, items: [] }, updatedAt: null });
    http.expectOne(environment.apiUrl + '/industries').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.addNote();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.item').length).toBe(1);

    TestBed.inject(Scratchpad).undo();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.item').length).toBe(0);
  });
});
