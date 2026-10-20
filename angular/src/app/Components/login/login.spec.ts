import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LoginPage, safeBack } from './login';

describe('LoginPage', () => {
  afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });

  it('keeps the wait over a reload, worked out from when it ends', () => {
    vi.useFakeTimers();
    sessionStorage.setItem('signInWaitUntil', String(Date.now() + 20_000));
    TestBed.configureTestingModule({ imports: [LoginPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const page = TestBed.createComponent(LoginPage).componentInstance;
    expect(page.wait()).toBe(20);
    // A background tab may tick late, the number still follows the clock
    vi.setSystemTime(Date.now() + 15_000);
    vi.advanceTimersByTime(1000);
    expect(page.wait()).toBe(4);
  });

  it('counts down after too many tries and keeps Sign in off until the wait is over', () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
    const page = fixture.componentInstance;
    page.username.set('admin');
    page.password.set('wrong');
    page.submit(new Event('submit'));
    http.expectOne(r => r.url.endsWith('/auth/login')).flush({ detail: 'Too many tries. Try again in 3 seconds' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '3' } });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Try again in 3 seconds');
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

    page.password.set('again');
    page.submit(new Event('submit'));
    http.expectNone(r => r.url.endsWith('/auth/login'));

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(el.textContent).toContain('Try again in 2 seconds');
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(page.wait()).toBe(0);
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

// E1: the back link only ever points at a page of this app
describe('safeBack', () => {
  it('follows a page of this app', () => {
    expect(safeBack('/history')).toBe('/history');
    expect(safeBack('/requests?x=1')).toBe('/requests?x=1');
  });

  it('sends anything that could leave the site to the table', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/%0d%0a', '/a\r\nb', '/a:b', 'history', '', null]) {
      expect(safeBack(bad)).toBe('/');
    }
  });
});
