import { Snapshot } from '../../../domain/models/board';

// How a frozen snapshot from the Overview looks, on the carry tray and as a card on the board

// A snapshot dragged off the carry tray onto a board, and an Overview card dragged onto the tray
export const SNAP_DRAG = 'application/x-scratchpad-snap';
export const CARD_DRAG = 'application/x-overview-card';

// "7 Oct, 14:02", when it was carried
export function snapWhen(iso: string | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  return (
    at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ', ' +
    at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

// The circle as it was: the ink steps lighter slice by slice, the picked slice is the signal colour, the same
// logic as the Overview's circle, so both read alike
export function snapShade(snap: Snapshot, index: number): string {
  if (snap.pick && snap.numbers[index]?.label === snap.pick) return 'var(--signal)';
  const n = Math.max(snap.numbers.length, 1);
  const pct = Math.round(92 - (index * 70) / n);
  return `color-mix(in srgb, var(--text) ${pct}%, var(--surface))`;
}

export function snapCircle(snap: Snapshot): string {
  const total = snap.numbers.reduce((sum, one) => sum + (one.share ?? 0), 0);
  if (!total) return 'var(--track)';
  let from = 0;
  const parts = snap.numbers.map((one, i) => {
    const to = from + ((one.share ?? 0) / total) * 100;
    const part = `${snapShade(snap, i)} ${from}% ${to}%`;
    from = to;
    return part;
  });
  return `conic-gradient(${parts.join(', ')})`;
}
