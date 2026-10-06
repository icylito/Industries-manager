import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MyComponents } from './my-components';

describe('MyComponents', () => {
  let component: MyComponents;
  let fixture: ComponentFixture<MyComponents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponents],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponents);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deletes only after the row asks, and never uses the browser popup', () => {
    const http = TestBed.inject(HttpTestingController);
    const confirmSpy = vi.spyOn(window, 'confirm');
    component.industries.set([
      { id: 1, name: 'Alpha', sector: 'Public Sector', price: 1, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null },
      { id: 2, name: 'Beta', sector: 'Public Sector', price: 2, release: null, duplicateOf: null, importedFrom: null, lostFields: null, extra: null },
    ]);

    component.confirmingId.set(1);
    http.expectNone(r => r.method === 'DELETE');

    component.remove(1);
    expect(component.deletingId()).toBe(1);
    http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/industries/1')).flush('The row has been deleted');

    expect(component.industries().map(i => i.id)).toEqual([2]);
    expect(component.confirmingId()).toBeNull();
    expect(component.deletingId()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
