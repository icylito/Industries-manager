import { Service, signal } from '@angular/core';

// One short line at the bottom of the page, for "Compare now uses X" and the like. It goes by itself after a moment.
@Service()
export class Toast {
  message = signal('');
  private timer?: ReturnType<typeof setTimeout>;

  // long: something the person must read and act on, kept on screen long enough to read
  say(text: string, stay: 'short' | 'long' = 'short') {
    this.message.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), stay === 'long' ? 12_000 : 2400);
  }
}
