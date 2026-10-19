// Colour maths for the paper colour picker. Colours are kept as '#rrggbb' text, the one shape the board stores
// (api_v2/Scratchpad/BoardRules.cs checks the same shape).

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

// What someone typed or pasted: 'abc', '#abc', 'AABBCC' and '#aabbcc' all work. Null when it is not a colour.
export function parseHex(text: string): string | null {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t))
    t = t
      .split('')
      .map((c) => c + c)
      .join('');
  return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((c) => channel(c).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: channel((r + m) * 255), g: channel((g + m) * 255), b: channel((b + m) * 255) };
}

// Perceived brightness, 0 to 1, so text can be put on a paper in a readable colour
export function brightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function isDark(hex: string): boolean {
  return brightness(hex) < 0.5;
}

// The paper's folded corner: the same colour, a little darker on a light paper and lighter on a dark one
export function fold(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const to = isDark(hex) ? 255 : 0;
  const mix = (c: number) => c + (to - c) * 0.18;
  return rgbToHex({ r: mix(r), g: mix(g), b: mix(b) });
}

// Whatever CSS colour the browser computed ('rgb(1, 2, 3)' or 'rgba(...)'), as '#rrggbb'
export function cssToHex(css: string): string | null {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(css);
  return m ? rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }) : null;
}
