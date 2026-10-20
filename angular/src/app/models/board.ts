// The Scratchpad's boards. A person keeps several, each one endless canvas saved as a single JSON document.
// The API checks the same shapes in api_v2/Scratchpad/BoardRules.cs; change both together.

export type NoteTone = 'white' | 'gray' | 'ink' | 'amber';
export type TextAlign = 'left' | 'center' | 'right';

// Rich text, stored as runs (a stretch of text plus how it looks), so a single word can be bold,
// highlighted, or a different font and size from the words beside it. See OVERVIEW_HANDOFF.md item d.
export type BoardList = 'none' | 'bullet' | 'number';
export type TextSize = 'sm' | 'base' | 'lg' | 'xl';
export interface TextRun { text: string; bold?: boolean; highlight?: boolean; font?: string; size?: TextSize; }
export interface TextBlock { id: string; list: BoardList; runs: TextRun[]; }

// Every thing on the board has a place and a size in board units
interface ItemBase { id: string; x: number; y: number; w: number; h: number; }

// A company card keeps what it showed, refreshed from the table when the board opens. rank is its place in the
// rail's "most expensive" list when it was added from there.
export interface IndustryItem extends ItemBase { type: 'industry'; industryId: number; name: string; sector: string | null; price: number | null; rank: number | null; }
// A sticky note or a text box. text is the plain form kept by boards saved before rich text.
// color is a paper colour of the person's own, '#rrggbb', picked with the colour picker. It wins over tone, which stays
// as the fallback for pages and boards that don't know it.
export interface PaperItem extends ItemBase { type: 'note' | 'text'; blocks: TextBlock[]; text?: string; tone: NoteTone; color?: string; tilt: number; align?: TextAlign; }
// A file or picture. fileId is null until the upload is done, or when it never finished. name is the original
// file name, shown on the card and never used as a path.
export interface FileItem extends ItemBase { type: 'file'; fileId: number | null; name: string; contentType: string; sizeBytes: number; }
// A snapshot from the carry tray, frozen as it was carried
export interface SnapItem extends ItemBase { type: 'snap'; snap: Snapshot; }
// A pen or marker stroke. points is one flat list, x then y, measured from the stroke's own corner (x, y).
export interface StrokeItem extends ItemBase { type: 'stroke'; kind: 'pen' | 'marker'; points: number[]; }
// A drawn box with a paper colour, for framing an area of the board
export interface RectItem extends ItemBase { type: 'rect'; tone: NoteTone; color?: string; }

export type BoardItem = IndustryItem | PaperItem | FileItem | SnapItem | StrokeItem | RectItem;
export type BoardItemType = BoardItem['type'];
// One kind of thing by its type. Notes and text boxes share one shape, so both name PaperItem.
export type ItemOf<T extends BoardItemType> = T extends 'note' | 'text' ? PaperItem : Extract<BoardItem, { type: T }>;

// A line glued to two things on the board, with a label, arrowheads and a gentle curve (item f)
export type LineHead = 'none' | 'end' | 'both';
export interface BoardLine { id: string; from: string; to: string; head: LineHead; bend: number; label: string; }
// A group is only a name and the ids it holds. The outline is drawn from the real boxes.
export interface BoardGroup { id: string; name: string; itemIds: string[]; }

// A frozen picture of something on the Overview: the title the person would read and the numbers as they were,
// never recalculated. split and pick let "Open in Overview" come back to the same slice.
export interface Snapshot {
    id: string;
    kind: 'circle' | 'list';
    title: string;
    takenAt: string;
    numbers: { label: string; value: string; share?: number }[];
    split?: string;
    pick?: string | null;
}

// Where the person left a board. Kept apart from the board, so moving around is never an undo step.
export interface BoardView { x: number; y: number; zoom: number; }

export interface BoardDocument {
    version: 1;
    items: BoardItem[];
    lines: BoardLine[];
    groups: BoardGroup[];
}

// One row of the History tab, and one board as the API gives it
export interface BoardSummary { id: number; name: string; pinned: boolean; createdAt: string; updatedAt: string; things: number; }
export interface BoardAnswer { id: number; name: string; pinned: boolean; document: BoardDocument; view: BoardView | null; createdAt: string; updatedAt: string; }

// What POST /scratchpad/files answers. The card keeps the id, never a browser address.
export interface ScratchFileInfo { id: number; name: string; contentType: string; sizeBytes: number; }
