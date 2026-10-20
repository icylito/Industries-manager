import { Component, computed, input } from '@angular/core';
import { parseMarks } from './format';

// Shows ticket text with its bold, italic and code marks. The pieces are text nodes, never markup.
@Component({
  selector: 'app-rich-text',
  template: `@for (p of pieces(); track $index) {@if (p.code) {<code [class.b]="p.bold" [class.i]="p.italic">{{ p.text }}</code>} @else if (p.bold || p.italic) {<span [class.b]="p.bold" [class.i]="p.italic">{{ p.text }}</span>} @else {{{ p.text }}}}`,
  styles: `
    :host{ white-space: pre-wrap; overflow-wrap: anywhere; }
    .b{ font-weight: 700; }
    .i{ font-style: italic; }
    code{ padding: 0.05rem 0.3rem; border-radius: 5px; background: var(--surface-2); color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
  `,
})
export class RichText {
  text = input('');
  pieces = computed(() => parseMarks(this.text()));
}
