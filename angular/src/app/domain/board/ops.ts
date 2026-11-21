import { BoardDocument, BoardGroup, BoardItem, BoardLine } from '../models/board';
import { openItem } from './item-kinds';

// Every change to a board is one of these. applyOp is the only code that changes a board document: it never
// edits the one it is given, it hands back a new one that shares every untouched part with the old one, so
// undo history can keep whole boards without copying them. Nothing changed means the same document back.

export interface Position {
  id: string;
  x: number;
  y: number;
}
// What can change on things already on the board: data, or a function for changes that depend on the thing
export type ItemPatch = Partial<Omit<BoardItem, 'id' | 'type'>> & Record<string, unknown>;

export type Op =
  // New things go in front of everything, or behind everything with back (a box drawn to frame an area)
  | { op: 'add'; items: BoardItem[]; lines?: BoardLine[]; groups?: BoardGroup[]; back?: boolean }
  // Takes the things away, with every line glued to them and any group left with fewer than two
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; positions: Position[] }
  | { op: 'resize'; id: string; w: number; h: number }
  | { op: 'patch'; ids: string[]; patch: ItemPatch | ((item: BoardItem) => BoardItem) }
  // Behind everything else, or in front. The order of items is the order they are drawn.
  | { op: 'order'; ids: string[]; to: 'back' | 'front' }
  // A thing is in at most one group, so grouping it takes it out of its old one
  | { op: 'group'; id: string; ids: string[]; name: string }
  | { op: 'ungroup'; groupId: string }
  | { op: 'renameGroup'; groupId: string; name: string }
  | { op: 'addLine'; line: BoardLine }
  | { op: 'patchLine'; id: string; patch: Partial<Omit<BoardLine, 'id' | 'from' | 'to'>> }
  | { op: 'removeLine'; id: string };

export function emptyDocument(): BoardDocument {
  return { version: 1, items: [], lines: [], groups: [] };
}

// A board as it was saved, made safe to work on: things this page can't read are left out, and lines and
// groups that point at them go too, so one broken thing never stops the board opening
export function openDocument(raw: BoardDocument | null | undefined): BoardDocument {
  const items = (raw?.items ?? [])
    .map((item) => openItem(item))
    .filter((item): item is BoardItem => !!item);
  return tidy({ version: 1, items, lines: raw?.lines ?? [], groups: raw?.groups ?? [] });
}

export function applyOp(doc: BoardDocument, op: Op): BoardDocument {
  switch (op.op) {
    case 'add':
      if (op.items.length === 0 && !op.lines?.length && !op.groups?.length) return doc;
      return tidy({
        ...doc,
        items: op.back ? [...op.items, ...doc.items] : [...doc.items, ...op.items],
        lines: op.lines?.length ? [...doc.lines, ...op.lines] : doc.lines,
        groups: op.groups?.length
          ? [
              ...ungrouped(
                doc.groups,
                op.groups.flatMap((g) => g.itemIds),
              ),
              ...op.groups,
            ]
          : doc.groups,
      });
    case 'remove': {
      const gone = new Set(op.ids);
      if (!doc.items.some((item) => gone.has(item.id))) return doc;
      return tidy({ ...doc, items: doc.items.filter((item) => !gone.has(item.id)) });
    }
    case 'move': {
      const to = new Map(op.positions.map((p) => [p.id, p]));
      return mapItems(doc, (item) => {
        const p = to.get(item.id);
        return p && (p.x !== item.x || p.y !== item.y) ? { ...item, x: p.x, y: p.y } : item;
      });
    }
    case 'resize':
      return mapItems(doc, (item) =>
        item.id === op.id && (item.w !== op.w || item.h !== op.h)
          ? { ...item, w: op.w, h: op.h }
          : item,
      );
    case 'patch': {
      const ids = new Set(op.ids);
      const change = op.patch;
      return mapItems(doc, (item) => {
        if (!ids.has(item.id)) return item;
        if (typeof change === 'function') return change(item);
        const keys = Object.keys(change) as (keyof typeof change)[];
        if (keys.every((key) => (item as unknown as Record<string, unknown>)[key] === change[key]))
          return item;
        return { ...item, ...change } as BoardItem;
      });
    }
    case 'order': {
      const ids = new Set(op.ids);
      const moving = doc.items.filter((item) => ids.has(item.id));
      if (moving.length === 0) return doc;
      const rest = doc.items.filter((item) => !ids.has(item.id));
      const items = op.to === 'back' ? [...moving, ...rest] : [...rest, ...moving];
      return items.every((item, i) => item === doc.items[i]) ? doc : { ...doc, items };
    }
    case 'group': {
      const present = new Set(doc.items.map((item) => item.id));
      const ids = [...new Set(op.ids)].filter((id) => present.has(id));
      if (ids.length < 2) return doc;
      return {
        ...doc,
        groups: [...ungrouped(doc.groups, ids), { id: op.id, name: op.name, itemIds: ids }],
      };
    }
    case 'ungroup':
      return doc.groups.some((g) => g.id === op.groupId)
        ? { ...doc, groups: doc.groups.filter((g) => g.id !== op.groupId) }
        : doc;
    case 'renameGroup':
      return {
        ...doc,
        groups: replaceWhere(
          doc.groups,
          (g) => g.id === op.groupId && g.name !== op.name,
          (g) => ({ ...g, name: op.name }),
        ),
      };
    case 'addLine': {
      const { from, to } = op.line;
      const present = new Set(doc.items.map((item) => item.id));
      if (from === to || !present.has(from) || !present.has(to)) return doc;
      if (doc.lines.some((line) => line.from === from && line.to === to)) return doc;
      return { ...doc, lines: [...doc.lines, op.line] };
    }
    case 'patchLine': {
      const patch = op.patch as Record<string, unknown>;
      return {
        ...doc,
        lines: replaceWhere(
          doc.lines,
          (line) =>
            line.id === op.id &&
            Object.keys(patch).some(
              (key) => (line as unknown as Record<string, unknown>)[key] !== patch[key],
            ),
          (line) => ({ ...line, ...op.patch }),
        ),
      };
    }
    case 'removeLine':
      return doc.lines.some((line) => line.id === op.id)
        ? { ...doc, lines: doc.lines.filter((line) => line.id !== op.id) }
        : doc;
  }
}

// Copies of these things beside them: new ids, the lines between two copied things copied too, and a group
// copied when all of it was. Answers the new things and the old id each one came from.
export function copiesOf(
  doc: BoardDocument,
  ids: readonly string[],
  offset: { x: number; y: number },
  makeId: () => string,
): { op: Op & { op: 'add' }; idFor: Map<string, string> } {
  const picked = new Set(ids);
  const idFor = new Map<string, string>();
  const items: BoardItem[] = [];
  for (const item of doc.items) {
    if (!picked.has(item.id)) continue;
    const id = makeId();
    idFor.set(item.id, id);
    items.push({ ...structuredClone(item), id, x: item.x + offset.x, y: item.y + offset.y });
  }
  const lines = doc.lines
    .filter((line) => idFor.has(line.from) && idFor.has(line.to))
    .map((line) => ({
      ...line,
      id: makeId(),
      from: idFor.get(line.from)!,
      to: idFor.get(line.to)!,
    }));
  const groups = doc.groups
    .filter((group) => group.itemIds.every((id) => idFor.has(id)))
    .map((group) => ({
      ...group,
      id: makeId(),
      itemIds: group.itemIds.map((id) => idFor.get(id)!),
    }));
  return { op: { op: 'add', items, lines, groups }, idFor };
}

// Lines and groups only ever point at things on the board
function tidy(doc: BoardDocument): BoardDocument {
  const present = new Set(doc.items.map((item) => item.id));
  const lines = doc.lines.filter((line) => present.has(line.from) && present.has(line.to));
  const groups = doc.groups
    .map((group) =>
      group.itemIds.every((id) => present.has(id))
        ? group
        : { ...group, itemIds: group.itemIds.filter((id) => present.has(id)) },
    )
    .filter((group) => group.itemIds.length >= 2);
  const sameLines = lines.length === doc.lines.length;
  const sameGroups =
    groups.length === doc.groups.length && groups.every((g, i) => g === doc.groups[i]);
  return sameLines && sameGroups
    ? doc
    : { ...doc, lines: sameLines ? doc.lines : lines, groups: sameGroups ? doc.groups : groups };
}

function ungrouped(groups: BoardGroup[], ids: readonly string[]): BoardGroup[] {
  const taken = new Set(ids);
  return groups
    .map((group) =>
      group.itemIds.some((id) => taken.has(id))
        ? { ...group, itemIds: group.itemIds.filter((id) => !taken.has(id)) }
        : group,
    )
    .filter((group) => group.itemIds.length >= 2);
}

function mapItems(doc: BoardDocument, change: (item: BoardItem) => BoardItem): BoardDocument {
  let changed = false;
  const items = doc.items.map((item) => {
    const next = change(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...doc, items } : doc;
}

function replaceWhere<T>(list: T[], when: (one: T) => boolean, change: (one: T) => T): T[] {
  let changed = false;
  const next = list.map((one) => {
    if (!when(one)) return one;
    changed = true;
    return change(one);
  });
  return changed ? next : list;
}
