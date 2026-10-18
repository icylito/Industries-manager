import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsPage } from './settings';
import { Auth } from '../../../application/auth';
import { routes } from '../../../app.routes';

// One place for an admin: their own account, and everyone who can sign in
describe('SettingsPage', () => {
  const render = async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(Auth).user.set({
      id: 1,
      username: 'ada',
      role: 'admin',
      disabled: false,
      mustChangePassword: false,
      createdAt: '',
      lastLoginAt: null,
    });
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('holds your own account and the people list on one page', async () => {
    const el = await render();
    expect(el.querySelector('app-account')).toBeTruthy();
    expect(el.querySelector('app-users')).toBeTruthy();
  });

  it('names the page in plain words', async () => {
    const el = await render();
    expect(el.querySelector('.panel-title h2')?.textContent).toContain('Settings');
  });
});
