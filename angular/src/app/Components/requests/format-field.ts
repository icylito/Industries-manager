import { Component, ElementRef, effect, input, model, output, signal, viewChild } from '@angular/core';
import { Mark, renderInto, serialize } from './format';

// A writing box where bold, italic and code show as what they are while typing, with the format buttons always in a row
// under it. A button wraps highlighted words, or with nothing highlighted turns the mark on for what is typed next.
// The text handed on stays plain, the marks are the characters around the words.
@Component({
  selector: 'app-format-field',
  templateUrl: './format-field.html',
  styleUrl: './format-field.css',
  host: { '(document:selectionchange)': 'sync()' },
})
export class FormatField {
  value = model('');
  rows = input(3);
  max = input(2000);
  placeholder = input('');
  label = input('');
  // Enter sends and Shift+Enter makes a new line, the way the reply box has always worked
  submitOnEnter = input(false);
  submitted = output<void>();

  private box = viewChild<ElementRef<HTMLDivElement>>('box');
  // The last text this box handed on, so only a change from outside (the box cleared after a send) redraws it
  private handedOn = '';
  pressed = signal<Mark[]>([]);
  // Where the cursor last was in the box, so a button reached with Tab still works on that spot
  private lastRange: Range | null = null;
  empty = signal(true);

  readonly buttons: { mark: Mark; label: string; keys: string }[] = [
    { mark: 'bold', label: 'Bold', keys: 'Ctrl+B' },
    { mark: 'italic', label: 'Italic', keys: 'Ctrl+I' },
    { mark: 'code', label: 'Code', keys: 'Ctrl+E' },
  ];

  constructor() {
    effect(() => {
      const el = this.box()?.nativeElement;
      const text = this.value();
      if (!el || text === this.handedOn) return;
      this.handedOn = text;
      renderInto(el, text);
      this.empty.set(!text);
    });
  }

  private el() {
    return this.box()!.nativeElement;
  }

  private emit() {
    const el = this.el();
    // A box that was emptied keeps a stray break behind, which would hide the placeholder
    if (!(el.textContent ?? '').length && el.querySelector('br') && el.children.length === el.querySelectorAll('br').length) {
      el.replaceChildren();
    }
    const text = serialize(el);
    this.handedOn = text;
    // A code mark waiting for its first letter counts as something, so the placeholder doesn't sit next to it
    this.empty.set(!text.trim() && !el.querySelector('code'));
    this.value.set(text);
  }

  onBeforeInput(e: InputEvent) {
    if (!e.inputType.startsWith('insert') || e.inputType === 'insertLineBreak') return;
    // Typing stops at the limit instead of cutting the text in half later
    if (serialize(this.el()).length + (e.data?.length ?? 1) > this.max()) e.preventDefault();
  }

  onPaste(e: ClipboardEvent) {
    // Pasted text comes in as plain words, so another page's fonts and colours don't follow it
    e.preventDefault();
    const room = this.max() - serialize(this.el()).length;
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n').slice(0, Math.max(0, room));
    if (text) document.execCommand('insertText', false, text);
  }

  onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const hit = this.buttons.find(b => b.keys.endsWith(e.key.toUpperCase()));
      if (hit) {
        e.preventDefault();
        this.apply(hit.mark);
        return;
      }
    }
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (this.submitOnEnter() && !e.shiftKey) this.submitted.emit();
      else document.execCommand('insertLineBreak');
    }
  }

  // The buttons show as pressed while the cursor or the highlight sits in a mark. Once the cursor is somewhere else
  // on the page they let go.
  sync() {
    const box = this.box()?.nativeElement;
    const sel = window.getSelection();
    if (!box || !sel || sel.rangeCount === 0 || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) {
      if (this.pressed().length && document.activeElement?.closest('.strip') === null) this.pressed.set([]);
      return;
    }
    this.lastRange = sel.getRangeAt(0).cloneRange();
    const on: Mark[] = [];
    if (document.queryCommandState('bold')) on.push('bold');
    if (document.queryCommandState('italic')) on.push('italic');
    if (this.codeAround(sel.anchorNode)) on.push('code');
    this.pressed.set(on);
  }

  private codeAround(node: Node | null): HTMLElement | null {
    const start = node && node.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
    const found = start?.closest('code') ?? null;
    return found && this.el().contains(found) ? found : null;
  }

  apply(mark: Mark) {
    const el = this.el();
    const sel = this.focusBox();
    if (!sel) return;
    const before = el.innerHTML;
    if (mark === 'code') {
      if (sel.isCollapsed) this.codeAtCursor(sel);
      else this.toggleCode(sel);
    } else {
      // With nothing highlighted the browser keeps the mark for the next letters typed, the same as Ctrl+B in any editor
      document.execCommand(mark === 'bold' ? 'bold' : 'italic');
    }
    // A mark that would push the text over the limit is taken straight back
    if (serialize(el).length > this.max()) {
      el.innerHTML = before;
    }
    this.emit();
    this.sync();
  }

  // Puts the cursor back in the box before a button acts: where it last was, or at the end when it never was there
  private focusBox(): Selection | null {
    const el = this.el();
    const sel = window.getSelection();
    if (!sel) return null;
    const inside = sel.rangeCount > 0 && el.contains(sel.anchorNode);
    // Setting the selection again would make the browser forget a mark just switched on or off for the next letters
    if (inside && document.activeElement === el) return sel;
    let range: Range;
    if (inside) range = sel.getRangeAt(0).cloneRange();
    else if (this.lastRange && el.contains(this.lastRange.startContainer)) range = this.lastRange;
    else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    if (document.activeElement !== el) el.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel;
  }

  // Code with nothing highlighted. Outside a code mark it opens an empty one with the cursor inside, inside one it steps
  // the cursor out past its end. The invisible space holding the spot is dropped when the text is read back.
  private codeAtCursor(sel: Selection) {
    const range = sel.getRangeAt(0);
    const existing = this.codeAround(sel.anchorNode);
    // Bold or italic that was switched off stays off: the new spot goes after the marked words, not inside them
    const off = new Set<string>();
    if (!document.queryCommandState('bold')) off.add('B').add('STRONG');
    if (!document.queryCommandState('italic')) off.add('I').add('EM');
    const spot = document.createTextNode('​');
    if (existing) {
      this.outOf(existing, off).after(spot);
    } else {
      const code = document.createElement('code');
      code.append(spot);
      const host = this.markEndingAt(range, off);
      if (host) host.after(code);
      else range.insertNode(code);
    }
    range.setStart(spot, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    // Bold or italic that was on before stays on for what comes next, moving the cursor would have dropped it
    if (!off.has('B') && !document.queryCommandState('bold')) document.execCommand('bold');
    if (!off.has('I') && !document.queryCommandState('italic')) document.execCommand('italic');
  }

  // The outermost switched off mark that ends right where the cursor is, if there is one
  private markEndingAt(range: Range, off: Set<string>): HTMLElement | null {
    let found: HTMLElement | null = null;
    let node: Node | null = range.startContainer;
    while (node && node !== this.el()) {
      if (node.nodeType === 1 && off.has((node as HTMLElement).tagName)) {
        const rest = document.createRange();
        rest.setStart(range.startContainer, range.startOffset);
        rest.setEndAfter(node);
        if (!rest.toString().replace(/​/g, '')) found = node as HTMLElement;
        else break;
      }
      node = node.parentNode;
    }
    return found;
  }

  // Climbs from a code mark out of the switched off marks it closes, so typing after it leaves those marks too
  private outOf(el: HTMLElement, off: Set<string>): HTMLElement {
    let at = el;
    while (at.parentElement && at.parentElement !== this.el() && off.has(at.parentElement.tagName) && at === at.parentElement.lastChild) {
      at = at.parentElement;
    }
    return at;
  }

  private toggleCode(sel: Selection) {
    const range = sel.getRangeAt(0);
    const existing = this.codeAround(sel.anchorNode);
    if (existing) {
      const text = document.createTextNode(existing.textContent ?? '');
      existing.replaceWith(text);
      range.selectNodeContents(text);
    } else {
      const text = range.toString();
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
      if (!m[2]) return;
      // The spaces around the words stay outside, so the code reads back as a mark
      const code = document.createElement('code');
      code.textContent = m[2];
      const frag = document.createDocumentFragment();
      if (m[1]) frag.append(m[1]);
      frag.append(code);
      if (m[3]) frag.append(m[3]);
      range.deleteContents();
      range.insertNode(frag);
      range.selectNodeContents(code);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
