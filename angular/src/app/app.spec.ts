import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { Auth } from './services/auth';
import { Theme } from './services/theme';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Industries');
  });
});

// Stands in for a page so the shell can be tested without the real, lazy, API-reading pages
@Component({ selector: 'app-stub-page', template: '<p>stub</p>' })
class StubPage {}

// The admin pages share the Overview's slim nav and its colours. The table, Sign in and Account keep the normal nav.
describe('App admin shell', () => {
  const adminPaths = ['overview', 'scratchpad', 'settings'];
  const isAdminRoute = (path: string) => routes.find(r => r.path === path)?.data?.['admin'] === true;

  afterEach(() => {
    document.documentElement.classList.remove('admin-layout');
    history.pushState({}, '', '/');
  });

  it('marks every admin page in the route table, and nothing else', () => {
    expect(adminPaths.map(isAdminRoute)).toEqual([true, true, true]);
    expect(isAdminRoute('')).toBe(false);
    expect(isAdminRoute('requests')).toBe(false);
    expect(isAdminRoute('history')).toBe(false);
    expect(isAdminRoute('fields')).toBe(false);
  });

  describe('on an admin page', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter([{ path: 'history', component: StubPage, data: { title: 'History', lede: '', admin: true } }]),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      }).compileComponents();
    });

    it('shows the slim nav with every admin tab, the bell, and the admin colours', async () => {
      const router = TestBed.inject(Router);
      const fixture = TestBed.createComponent(App);
      await router.navigateByUrl('/history');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('nav.nav')).toBeFalsy();
      expect([...el.querySelectorAll('nav.admin-nav .tabs a')].map(a => a.textContent?.trim()))
        .toEqual(['Overview', 'Scratchpad', 'Settings']);
      expect(el.querySelector('nav.admin-nav a[href="/requests"]')).toBeTruthy();
      expect(document.documentElement.classList.contains('admin-layout')).toBe(true);
    });

    // Opening an admin page straight from the address must not show the other nav first
    it('is already the admin shell on the first paint, before the router has settled', () => {
      history.pushState({}, '', '/overview');
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('nav.admin-nav')).toBeTruthy();
    });
  });

  describe('on the table', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter([{ path: '', component: StubPage, data: { title: 'Industries', lede: '' } }]),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      }).compileComponents();
    });

    it('keeps the normal nav and the normal colours', async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('nav.admin-nav')).toBeFalsy();
      expect(el.querySelector('nav.nav')).toBeTruthy();
      expect(document.documentElement.classList.contains('admin-layout')).toBe(false);
    });
  });

  // The admin tools live in Settings now, so the other nav keeps only what everyone uses
  describe('on the table, signed in as an admin', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter([{ path: '', component: StubPage, data: { title: 'Industries', lede: '' } }]),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      }).compileComponents();
    });

    it('keeps Overview and People out of the crowded nav, and sends the name item to Settings', () => {
      TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();

      const nav = fixture.nativeElement.querySelector('nav.nav') as HTMLElement;
      expect(nav.querySelector('a[href="/overview"]')).toBeFalsy();
      expect(nav.querySelector('a[href="/users"]')).toBeFalsy();
      expect(nav.querySelector('a[href="/settings"]')).toBeTruthy();
      expect(nav.querySelector('a[href="/history"]')).toBeTruthy();
      expect(nav.querySelector('a[href="/fields"]')).toBeTruthy();
    });

    // History and Fields sit on this nav, and they had a theme button before they moved here, so it has to stay on both navs
    it('keeps the theme button in this nav too, and it still switches the theme', () => {
      TestBed.inject(Auth).user.set({ id: 1, username: 'ada', role: 'admin', disabled: false, mustChangePassword: false, createdAt: '', lastLoginAt: null });
      const theme = TestBed.inject(Theme);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('nav.nav .theme-btn') as HTMLButtonElement;
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-label')).toBe('Switch to dark mode');

      button.click();
      fixture.detectChanges();
      expect(theme.isDark()).toBe(true);
      expect(button.getAttribute('aria-label')).toBe('Switch to light mode');
    });
  });
});
