import {
  Component,
  ElementRef,
  OnInit,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  Hsv,
  hexToRgb,
  hsvToRgb,
  parseHex,
  rgbToHex,
  rgbToHsv,
} from '../../../domain/board/colour';

const WIDTH = 250;
const HEIGHT = 340;

// The colour picker that opens when a paper colour is double clicked: a hue ring around a square for how bright and
// how strong the colour is, then the hex and the red, green and blue numbers. Dragging only changes what the
// picker shows. The colour is handed over (picked) when the pointer is let go or a number is confirmed, so one
// choice is one undo step and one save, never a stream of them.
@Component({
  selector: 'app-color-picker',
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.css',
  host: {
    role: 'dialog',
    'aria-label': 'Colour picker',
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class ColorPicker implements OnInit {
  // The colour it starts from, '#rrggbb'
  value = input.required<string>();
  // The swatch it was opened from, so the card sits beside it and stays on screen
  anchor = input<DOMRect | null>(null);
  // Every change while it is being made, so the board can follow live. picked is the one that is kept.
  previewed = output<string>();
  picked = output<string>();
  closed = output<void>();

  protected hsv = signal<Hsv>({ h: 0, s: 0, v: 1 });
  // What is in the hex box while it is being typed in, so a half typed colour is not rewritten under the cursor
  protected typing = signal<string | null>(null);
  protected rgb = computed(() => hsvToRgb(this.hsv()));
  protected hex = computed(() => rgbToHex(this.rgb()));
  protected hueColour = computed(() => 'hsl(' + this.hsv().h + ' 100% 50%)');
  protected readonly canDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  // Where the hue handle sits on the ring: the middle of the band, measured from the top, clockwise
  protected hueHandle = computed(() => {
    const radians = (this.hsv().h * Math.PI) / 180;
    return { x: 50 + 39.5 * Math.sin(radians), y: 50 - 39.5 * Math.cos(radians) };
  });
  protected place = signal({ left: 0, top: 0 });

  private ring = viewChild.required<ElementRef<HTMLElement>>('ring');
  private square = viewChild.required<ElementRef<HTMLElement>>('square');

  ngOnInit(): void {
    this.hsv.set(rgbToHsv(hexToRgb(this.value())));
    const at = this.anchor();
    if (at) {
      const left = Math.min(
        Math.max(at.left + at.width / 2 - WIDTH / 2, 8),
        Math.max(8, window.innerWidth - WIDTH - 8),
      );
      const below = at.bottom + 8;
      const top = below + HEIGHT > window.innerHeight ? Math.max(8, at.top - HEIGHT - 8) : below;
      this.place.set({ left, top });
    } else {
      this.place.set({ left: Math.max(8, (window.innerWidth - WIDTH) / 2), top: 96 });
    }
  }

  // ---- the ring ----

  protected ringDown(event: PointerEvent): void {
    const box = this.ring().nativeElement.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    // The hole in the middle belongs to the square
    if (Math.hypot(dx, dy) < box.width * 0.29) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.moveHue(event);
  }

  protected ringMove(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
      this.moveHue(event);
  }

  private moveHue(event: PointerEvent): void {
    const box = this.ring().nativeElement.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    this.hsv.update((c) => ({ ...c, h: Math.round((degrees + 360) % 360) }));
    this.typing.set(null);
    this.previewed.emit(this.hex());
  }

  // ---- the square ----

  protected squareDown(event: PointerEvent): void {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.moveSquare(event);
  }

  protected squareMove(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
      this.moveSquare(event);
  }

  private moveSquare(event: PointerEvent): void {
    const box = this.square().nativeElement.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const v = 1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    this.hsv.update((c) => ({ ...c, s, v }));
    this.typing.set(null);
    this.previewed.emit(this.hex());
  }

  // The pointer was let go: that is the choice
  protected release(): void {
    this.picked.emit(this.hex());
  }

  // ---- the numbers ----

  protected typeHex(text: string): void {
    this.typing.set(text);
    const hex = parseHex(text);
    if (hex) this.setFromRgb(hexToRgb(hex));
  }

  protected confirmHex(): void {
    this.typing.set(null);
    this.picked.emit(this.hex());
  }

  protected typeChannel(which: 'r' | 'g' | 'b', text: string): void {
    const value = Math.min(255, Math.max(0, Math.round(Number(text))));
    if (text.trim() === '' || Number.isNaN(value)) return;
    this.typing.set(null);
    this.setFromRgb({ ...this.rgb(), [which]: value });
  }

  // A grey or a black has no hue of its own, so the ring keeps where it was instead of jumping to red
  private setFromRgb(rgb: { r: number; g: number; b: number }): void {
    const next = rgbToHsv(rgb);
    this.hsv.update((c) => ({
      h: next.s === 0 || next.v === 0 ? c.h : next.h,
      s: next.s,
      v: next.v,
    }));
    this.previewed.emit(this.hex());
  }

  protected async dropper(): Promise<void> {
    const EyeDropper = (
      window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const hex = parseHex(sRGBHex);
      if (!hex) return;
      this.typing.set(null);
      this.setFromRgb(hexToRgb(hex));
      this.picked.emit(hex);
    } catch {
      // Cancelled with Esc: nothing changes
    }
  }
}
