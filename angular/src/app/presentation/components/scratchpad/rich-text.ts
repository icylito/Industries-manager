import { BoardList, TextBlock, TextRun, TextSize } from '../../../domain/models/board';

// Rich text for a note or a text box. Runs are stretches of text plus how they look, so one word can be
// bold, highlighted, or a different font and size from the words beside it. Formatted with the browser's
// own editing commands on a small schema, then read back into runs. See OVERVIEW_HANDOFF.md item d.

export interface FontGroup {
  label: string;
  fonts: string[];
}

// 48 Google fonts: the 28 the handoff lists and 20 more (docs/2026-10-10-overnight.md), Cairo and Tajawal for Arabic
// as well. Only the ones actually used are loaded on the page, see ensureFont; a font list that shows every name in
// its own face loads them when it opens, see ensureFonts. The API keeps the same list (Scratchpad/BoardRules.cs).
export const FONT_GROUPS: FontGroup[] = [
  {
    label: 'Sans serif',
    fonts: [
      'Inter',
      'Poppins',
      'Montserrat',
      'Work Sans',
      'DM Sans',
      'Nunito',
      'Lato',
      'Open Sans',
      'Raleway',
      'Roboto',
      'Rubik',
      'Manrope',
      'Cairo',
      'Tajawal',
    ],
  },
  {
    label: 'Serif',
    fonts: [
      'Playfair Display',
      'Merriweather',
      'Lora',
      'Libre Baskerville',
      'Cormorant Garamond',
      'Source Serif 4',
      'EB Garamond',
      'Crimson Pro',
      'Bitter',
      'Noto Serif',
    ],
  },
  {
    label: 'Monospace',
    fonts: [
      'JetBrains Mono',
      'IBM Plex Mono',
      'Space Mono',
      'Fira Code',
      'Roboto Mono',
      'Source Code Pro',
    ],
  },
  {
    label: 'Display',
    fonts: [
      'Oswald',
      'Bebas Neue',
      'Abril Fatface',
      'Lobster',
      'Anton',
      'Alfa Slab One',
      'Archivo Black',
      'Righteous',
    ],
  },
  {
    label: 'Handwriting',
    fonts: [
      'Caveat',
      'Pacifico',
      'Shadows Into Light',
      'Permanent Marker',
      'Dancing Script',
      'Indie Flower',
      'Kalam',
      'Patrick Hand',
      'Gloria Hallelujah',
      'Satisfy',
    ],
  },
];

// Only the fonts the list offers are kept. Words pasted in from elsewhere keep their own font's look out, so a
// note never carries a font this page can't show, and the API (Scratchpad/BoardRules.cs) refuses any other.
const KNOWN_FONTS = new Map(
  FONT_GROUPS.flatMap((group) => group.fonts).map((font) => [font.toLowerCase(), font]),
);
export function knownFont(name: string): string | undefined {
  return KNOWN_FONTS.get(name.toLowerCase());
}

export function ensureFonts(): void {
  for (const group of FONT_GROUPS) for (const font of group.fonts) ensureFont(font);
}

export interface SizeStep {
  key: TextSize;
  label: string;
  px: string;
  exec: string;
}
export const SIZE_STEPS: SizeStep[] = [
  { key: 'sm', label: 'Small', px: '0.85em', exec: '2' },
  { key: 'base', label: 'Normal', px: '1em', exec: '3' },
  { key: 'lg', label: 'Large', px: '1.4em', exec: '5' },
  { key: 'xl', label: 'Huge', px: '2em', exec: '7' },
];

const loaded = new Set<string>();
// Families that come in one weight only
const ONE_WEIGHT = new Set([
  'Bebas Neue',
  'Abril Fatface',
  'Lobster',
  'Pacifico',
  'Shadows Into Light',
  'Permanent Marker',
  'Indie Flower',
  'Anton',
  'Alfa Slab One',
  'Archivo Black',
  'Righteous',
  'Patrick Hand',
  'Gloria Hallelujah',
  'Satisfy',
]);

// Google Fonts loads a family the first time it is used, not all 48 on every page
export function ensureFont(family: string): void {
  if (!family || family === 'Inter' || loaded.has(family)) return;
  loaded.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // Google Fonts refuses the whole request when it asks for a weight the family doesn't have
  const weights = ONE_WEIGHT.has(family) ? '' : ':wght@400;700';
  link.href =
    'https://fonts.googleapis.com/css2?family=' +
    family.replace(/ /g, '+') +
    weights +
    '&display=swap';
  document.head.appendChild(link);
}

export function fontCss(family: string | undefined): string {
  return family ? "'" + family + "', sans-serif" : 'inherit';
}

export function sizeCss(size: TextSize | undefined): string {
  return SIZE_STEPS.find((step) => step.key === size)?.px ?? '1em';
}

export function sizeToExec(size: TextSize | undefined): string {
  return SIZE_STEPS.find((step) => step.key === size)?.exec ?? '3';
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runHtml(run: TextRun): string {
  const styles: string[] = [];
  if (run.bold) styles.push('font-weight:700');
  if (run.highlight) styles.push('background-color:var(--mark)');
  if (run.font) styles.push('font-family:' + fontCss(run.font).replace(/"/g, ''));
  if (run.size) styles.push('font-size:' + sizeCss(run.size));
  const text = escapeHtml(run.text).replace(/\n/g, '<br>');
  if (styles.length === 0) return text;
  return '<span style="' + styles.join(';') + '">' + text + '</span>';
}

export function renderBlocks(blocks: TextBlock[]): string {
  if (blocks.length === 0) return '<div class="blk" data-list="none"><br></div>';
  return blocks
    .map(
      (block) =>
        '<div class="blk" data-list="' +
        block.list +
        '">' +
        // An empty line keeps a <br>, or it folds to nothing and the first key typed lands outside it as a new line
        // A line ending in a break needs one more, as the browser shows a line's last <br> as nothing
        (block.runs.some((run) => run.text)
          ? block.runs.map(runHtml).join('') +
            (block.runs.at(-1)?.text.endsWith('\n') ? '<br>' : '')
          : '<br>') +
        '</div>',
    )
    .join('');
}

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'b' + Math.random().toString(36).slice(2);
}

interface Look {
  bold?: boolean;
  highlight?: boolean;
  font?: string;
  size?: TextSize;
}

function sizeFromExec(value: string): TextSize {
  const n = Number(value);
  if (n <= 2) return 'sm';
  if (n <= 4) return 'base';
  if (n <= 5) return 'lg';
  return 'xl';
}

function sizeFromCss(value: string): TextSize | undefined {
  return SIZE_STEPS.find((step) => step.px === value)?.key;
}

function lookOf(el: HTMLElement, inherited: Look): Look {
  const look: Look = { ...inherited };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') look.bold = true;
  const style = el.style;
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) look.bold = true;
  if (
    style.backgroundColor &&
    style.backgroundColor !== 'transparent' &&
    style.backgroundColor !== 'rgba(0, 0, 0, 0)'
  )
    look.highlight = true;
  if (style.fontFamily)
    look.font = knownFont(style.fontFamily.replace(/["']/g, '').split(',')[0].trim()) ?? look.font;
  if (style.fontSize) look.size = sizeFromCss(style.fontSize) ?? look.size;
  if (tag === 'FONT') {
    const face = el.getAttribute('face');
    if (face) look.font = knownFont(face.replace(/["']/g, '').split(',')[0].trim()) ?? look.font;
    const size = el.getAttribute('size');
    if (size) look.size = sizeFromExec(size);
  }
  return look;
}

function collectRuns(node: Node, look: Look, out: TextRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) out.push({ text, ...look });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  if (el.tagName === 'BR') {
    out.push({ text: '\n', ...look });
    return;
  }
  const next = lookOf(el, look);
  for (const child of Array.from(el.childNodes)) collectRuns(child, next, out);
}

function listOf(el: HTMLElement): BoardList {
  const named = el.getAttribute('data-list');
  if (named === 'bullet' || named === 'number') return named;
  if (el.tagName === 'LI') {
    const parent = el.parentElement?.tagName;
    return parent === 'OL' ? 'number' : 'bullet';
  }
  return 'none';
}

// The blocks in the editor, in order. A list becomes one block for each of its items.
export function serializeBlocks(root: HTMLElement): TextBlock[] {
  const out: TextBlock[] = [];
  const push = (el: HTMLElement, list: BoardList) => {
    const runs: TextRun[] = [];
    collectRuns(el, {}, runs);
    // A line's last <br> is the browser's way of holding an empty line open, not a line of its own
    if (runs.length && runs[runs.length - 1].text === '\n') runs.pop();
    out.push({ id: newBlockId(), list, runs: runs.length ? runs : [{ text: '' }] });
  };
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim()) out.push({ id: newBlockId(), list: 'none', runs: [{ text }] });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      const list: BoardList = el.tagName === 'OL' ? 'number' : 'bullet';
      for (const li of Array.from(el.children)) if (li instanceof HTMLElement) push(li, list);
      continue;
    }
    push(el, listOf(el));
  }
  if (out.length === 0) out.push({ id: newBlockId(), list: 'none', runs: [{ text: '' }] });
  return out;
}

export function plainText(blocks: TextBlock[]): string {
  return blocks.map((block) => block.runs.map((run) => run.text).join('')).join('\n');
}
