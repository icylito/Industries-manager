import { BoardDocument, BoardItem, BoardItemType, ItemOf } from '../models/board';
import { Point } from './geometry';
import { Op } from './ops';

// A change being made over time: a drag, a typing burst, a nudge. Ops applied to it show at once; commit makes
// all of them one undo step, cancel puts the board back as it was. A newer change commits this one first.
export interface Tx {
  readonly open: boolean;
  apply(op: Op): void;
  commit(): void;
  cancel(): void;
}

// Where a new thing goes: the nearest free spot on screen, or centred on a point (where something was dropped)
export type Placement = 'auto' | { center: Point };

// What the tools need from a board to do their work: read it, change it in steps, and move the selection. The
// board engine in application/ is the one that does it; the tools only know this, so they stay pure and testable
// with a plain object.
export interface BoardEditor {
  readonly doc: () => BoardDocument;
  readonly selectedIds: () => string[];
  apply(op: Op): void;
  begin(): Tx;
  place<T extends BoardItemType>(
    type: T,
    placement: Placement,
    init: Partial<ItemOf<T>>,
    options?: { back?: boolean },
  ): string | null;
  duplicate(ids: string[], offset: Point, tx?: Tx): Map<string, string>;
  pick(id: string): void;
  togglePick(id: string): void;
  setSelection(ids: string[]): void;
  clearSelection(): void;
  isPicked(id: string): boolean;
  pickGroup(id: string): void;
  pickLine(id: string): void;
  groupMembers(groupId: string | null): BoardItem[];
}
