import { Service, signal } from '@angular/core';

// One short line at the bottom of the page, for "Compare now uses X" and the like. It goes by itself after a moment.
@Service()
export class Toast {
  message = signal('');
  private timer?: ReturnType<typeof setTimeout>;

  say(text: string) {
    this.message.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), 2400);
  }
}
