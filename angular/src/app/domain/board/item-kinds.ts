import { BoardItem, BoardItemType, FileItem, ItemOf, TextBlock } from '../models/board';
import { Size } from './geometry';

// Everything the board needs to know about one kind of thing, in one table, so adding a kind is one entry here
// and its card in the page, not a new branch in every function.
export interface ItemKind<T extends BoardItem> {
  // What it is called in plain words, for the bar and for screen readers
  label: string;
  // Which tools the context bar offers when one of these is picked
  bar: 'company' | 'paper' | 'file' | 'snap' | 'draw';
  // The size a new one starts at
  size(init: Partial<T>): Size;
  // Set when it can be resized with the grip in its corner, and how small it may get
  minSize: Size | null;
  // It takes a paper colour
  toned: boolean;
  // The fields a new one starts with, besides id, type, place and size
  defaults(): Omit<T, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'> | Partial<T>;
  // An item as it was saved, brought up to date, or null when it can't be read
  open(raw: T): T | null;
}

let seed = 0;
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  seed += 1;
  return 'i' + Date.now().toString(36) + seed.toString(36);
}

export function emptyBlocks(text = ''): TextBlock[] {
  return [{ id: newId(), list: 'none', runs: [{ text }] }];
}

// SVG can carry script, so it is never previewed, the same rule the API serves it by
export function isImage(contentType: string | undefined): boolean {
  return !!contentType && contentType.startsWith('image/') && !contentType.includes('svg');
}

// How a file card shows: a picture, a video that plays in place, or a plain card with its type
export function fileView(item: Pick<FileItem, 'contentType'>): 'image' | 'video' | 'file' {
  if (isImage(item.contentType)) return 'image';
  if (item.contentType?.startsWith('video/')) return 'video';
  return 'file';
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const placed = (raw: BoardItem) => finite(raw.x) && finite(raw.y) && finite(raw.w) && finite(raw.h);

const paper = (type: 'note' | 'text', size: Size): ItemKind<ItemOf<'note' | 'text'>> => ({
  label: type === 'note' ? 'Sticky note' : 'Text box',
  bar: 'paper',
  size: () => size,
  minSize: { w: 120, h: 60 },
  toned: true,
  defaults: () => ({
    blocks: emptyBlocks(),
    tone: 'white' as const,
    tilt: type === 'note' ? Math.round((Math.random() * 6 - 3) * 10) / 10 : 0,
  }),
  // A note saved before rich text has plain text, so it gets one block of one run
  open: (raw) =>
    Array.isArray(raw.blocks)
      ? raw
      : {
          ...raw,
          blocks: emptyBlocks(raw.text ?? ''),
          tone: raw.tone ?? 'white',
          tilt: raw.tilt ?? 0,
        },
});

export const KINDS: { [K in BoardItemType]: ItemKind<ItemOf<K>> } = {
  industry: {
    label: 'Company',
    bar: 'company',
    minSize: null,
    toned: false,
    size: () => ({ w: 236, h: 92 }),
    defaults: () => ({ rank: null }),
    open: (raw) => (finite(raw.industryId) ? raw : null),
  },
  note: paper('note', { w: 250, h: 150 }),
  text: paper('text', { w: 270, h: 110 }),
  file: {
    label: 'File',
    bar: 'file',
    minSize: null,
    toned: false,
    size: (init) => {
      const view = fileView({ contentType: init.contentType ?? '' });
      return view === 'image'
        ? { w: 240, h: 212 }
        : view === 'video'
          ? { w: 320, h: 232 }
          : { w: 270, h: 76 };
    },
    defaults: () => ({ fileId: null }),
    open: (raw) => raw,
  },
  snap: {
    label: 'Snapshot',
    bar: 'snap',
    minSize: null,
    toned: false,
    size: () => ({ w: 300, h: 236 }),
    defaults: () => ({}),
    open: (raw) => (raw.snap && Array.isArray(raw.snap.numbers) ? raw : null),
  },
  stroke: {
    label: 'Drawing',
    bar: 'draw',
    minSize: null,
    toned: false,
    size: () => ({ w: 1, h: 1 }),
    defaults: () => ({ kind: 'pen' as const, points: [] }),
    open: (raw) =>
      Array.isArray(raw.points) && raw.points.length >= 2 && raw.points.length % 2 === 0
        ? raw
        : null,
  },
  rect: {
    label: 'Box',
    bar: 'draw',
    minSize: { w: 24, h: 24 },
    toned: true,
    size: () => ({ w: 240, h: 150 }),
    defaults: () => ({ tone: 'white' as const }),
    open: (raw) => raw,
  },
};

export function kindOf<T extends BoardItem>(item: T): ItemKind<T> {
  return KINDS[item.type] as unknown as ItemKind<T>;
}

// An item from a saved board, or null when it is of a kind this page doesn't know or can't be read
export function openItem(raw: BoardItem): BoardItem | null {
  const kind = KINDS[raw?.type] as ItemKind<BoardItem> | undefined;
  if (!kind || !placed(raw)) return null;
  return kind.open(raw);
}
