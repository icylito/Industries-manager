import { Component, OnInit, input, signal } from '@angular/core';

const OPEN_KEY = 'stock-listing-explorer';

// Which sections this browser had open or closed, by key. A convenience only: blocked storage opens them as they start.
function readOpen(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function writeOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [key]: open }));
  } catch {
    // Blocked storage: the section opens as it starts next time
  }
}

// One part of the Scratchpad's sidebar, like a section of an editor's Explorer: a heading that opens and closes
// what is under it, with room for a small button at the right of the heading. Open or closed is remembered.
@Component({
  selector: 'app-explorer-section',
  templateUrl: './explorer-section.html',
  styleUrl: './explorer-section.css',
  host: { '[class.open]': 'open()' },
})
export class ExplorerSection implements OnInit {
  key = input.required<string>();
  heading = input.required<string>();
  startOpen = input(true);
  open = signal(true);

  ngOnInit(): void {
    this.open.set(readOpen()[this.key()] ?? this.startOpen());
  }

  toggle(): void {
    this.open.update((open) => !open);
    writeOpen(this.key(), this.open());
  }

  show(): void {
    if (this.open()) return;
    this.open.set(true);
    writeOpen(this.key(), true);
  }
}
