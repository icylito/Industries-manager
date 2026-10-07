import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ShortcutsPanel } from './shortcuts-panel';
import { Shortcuts } from '../../services/shortcuts';

// Reset puts every key back at once, so it asks first (the design's "are you sure" row, like Users and Fields use)
describe('ShortcutsPanel reset', () => {
  let fixture: ComponentFixture<ShortcutsPanel>;
  let keys: Shortcuts;
  const el = () => fixture.nativeElement as HTMLElement;
  const click = (selector: string) => (el().querySelector(selector) as HTMLButtonElement).click();

  // A command that starts with a real key, so "back to its default" means something
  const aCommand = () => keys.commands().find(c => c.def.length > 0)!;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ShortcutsPanel],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    keys = TestBed.inject(Shortcuts);
    fixture = TestBed.createComponent(ShortcutsPanel);
    keys.togglePanel(true);
    fixture.detectChanges();
  });

  afterEach(() => document.documentElement.classList.remove('shortcuts-open'));

  const changeAKey = () => {
    const cmd = aCommand();
    const before = keys.bound()[cmd.id];
    keys.assign(cmd.id, ['X']);
    fixture.detectChanges();
    expect(keys.bound()[cmd.id]).toEqual(['X']);
    return { cmd, before };
  };

  it('asks before it changes any key', () => {
    const { cmd } = changeAKey();

    click('.reset');
    fixture.detectChanges();

    expect(keys.bound()[cmd.id]).toEqual(['X']);
    expect(el().querySelector('.confirm-pop')?.textContent).toContain('Are you sure you want to reset every key back to its default?');
    expect(el().querySelector('.confirm-pop')?.getAttribute('role')).toBe('alertdialog');
  });

  it('puts every key back once the question is answered yes', () => {
    const { cmd, before } = changeAKey();

    click('.reset');
    fixture.detectChanges();
    click('.confirm-pop .take');
    fixture.detectChanges();

    expect(keys.bound()[cmd.id]).toEqual(before);
    expect(el().querySelector('.confirm-pop')).toBeNull();
  });

  it('leaves every key alone when the question is answered no', () => {
    const { cmd } = changeAKey();

    click('.reset');
    fixture.detectChanges();
    click('.confirm-pop .cancel');
    fixture.detectChanges();

    expect(keys.bound()[cmd.id]).toEqual(['X']);
    expect(el().querySelector('.confirm-pop')).toBeNull();
  });

  it('closes the question on Escape, and leaves the panel open', () => {
    changeAKey();

    click('.reset');
    fixture.detectChanges();
    expect(el().querySelector('.confirm-pop')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(el().querySelector('.confirm-pop')).toBeNull();
    expect(keys.panelOpen()).toBe(true);
  });
});
