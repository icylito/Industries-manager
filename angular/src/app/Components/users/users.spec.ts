import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersPage } from './users';

// E7: the add box, and the temporary password panel
describe('UsersPage', () => {
  let http: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/users')).flush([]);
    return fixture;
  }

  it('trims and lower cases the name before sending, and sends nothing for an empty one', () => {
    const page = setup().componentInstance;
    page.newName.set('   ');
    page.add();
    expect(page.addError()).toBe('Type a username');
    http.expectNone(r => r.method === 'POST');

    page.newName.set('  Sam.Lee ');
    page.add();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/users'));
    expect(call.request.body).toEqual({ username: 'sam.lee', role: 'normal' });
    call.flush({ user: { id: 2, username: 'sam.lee', role: 'normal', disabled: false, mustChangePassword: true, createdAt: '', lastLoginAt: null }, temporaryPassword: 'abcdefgh23456789' });
    expect(page.shown()?.password).toBe('abcdefgh23456789');
    http.expectOne(r => r.url.endsWith('/users')).flush([]);
  });

  it('says to copy by hand when the browser has no clipboard, and forgets the password when the page is left', () => {
    const fixture = setup();
    const page = fixture.componentInstance;
    page.shown.set({ username: 'sam', password: 'abcdefgh23456789', created: true });
    const saved = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      page.copy('abcdefgh23456789');
      expect(page.copied()).toBe(false);
      expect(page.copyNote()).toBe('Select the password and copy it yourself');
    } finally {
      if (saved) Object.defineProperty(Navigator.prototype, 'clipboard', saved);
      delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
    fixture.destroy();
    expect(page.shown()).toBeNull();
    expect(page.copyNote()).toBe('');
  });

  it('says to copy by hand when the clipboard refuses', async () => {
    const page = setup().componentInstance;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    try {
      page.copy('abcdefgh23456789');
      await Promise.resolve(); await Promise.resolve();
      expect(page.copyNote()).toBe('Select the password and copy it yourself');
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
  });
});
