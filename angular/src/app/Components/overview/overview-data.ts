import { FieldRule, Industry } from '../../models/industry';

// Everything the Overview shows is worked out here from the loaded rows, with no page or hover state in it.
// One selection (Selection below) drives every number, so the circle, the bars, the list and the "Open in Browse" link always agree.
// The board in design/C-Signal-Light.dc.html is the sketch for this, OVERVIEW_HANDOFF.md says where it differs.

// A custom field can be named constructor or toString. A plain obj[key] would return a built in function.
function own(obj: object | null | undefined, key: string): unknown {
  if (obj == null || !Object.hasOwn(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

export interface Row {
  id: number;
  name: string;
  sector: string | null;
  price: number | null;
  // Release date as the API sends it, YYYY-MM-DD
  release: string | null;
  year: number | null;
  dup: boolean;
  lost: boolean;
  extra: Record<string, string | number | null> | null;
}

export function toRow(item: Industry): Row {
  const year = item.release ? Number(item.release.slice(0, 4)) : NaN;
  return {
    id: item.id,
    name: item.name,
    sector: item.sector && item.sector.trim() ? item.sector : null,
    price: item.price,
    release: item.release,
    year: Number.isFinite(year) ? year : null,
    dup: item.duplicateOf !== null,
    lost: (item.lostFields?.length ?? 0) > 0,
    extra: item.extra,
  };
}

// The "Needs attention" chips. flag is the word Browse reads in ?flags= (see my-components.ts)
export type AttnKey = 'dup' | 'lost' | 'nop' | 'nod';
export const ATTENTION: { key: AttnKey; label: string; flag: string; has: (r: Row) => boolean }[] = [
  { key: 'dup', label: 'Similar row', flag: 'duplicate', has: r => r.dup },
  { key: 'lost', label: 'Lost fields', flag: 'lost', has: r => r.lost },
  { key: 'nop', label: 'No price', flag: 'noprice', has: r => r.price === null },
  { key: 'nod', label: 'No release date', flag: 'nodate', has: r => r.release === null },
];
const attention = (key: AttnKey) => ATTENTION.find(a => a.key === key)!;

// What Browse can be asked to show, one entry per filter it understands
export interface BrowseFilters {
  sector?: string;
  minPrice?: number;
  maxPrice?: number;
  releaseFrom?: string;
  releaseTo?: string;
  flags?: string[];
}

// ---------- Slice by ----------

// The circle draws at most this many slices, anything past that is grouped into "Other"
export const MAX_SLICES = 4;
export const OTHER = 'Other';

export interface Dim {
  id: string;
  label: string;
  custom: boolean;
  keys: string[];
  // The slice a row falls in, or null when it has no value for this split
  of: (r: Row) => string | null;
  // The Browse filters that show exactly this slice, or null when Browse can't show it
  browse: (key: string) => BrowseFilters | null;
}

// Prices are cut into four equal bands between the price rule's min and max (0 to 10 unless the rules say otherwise).
// The edges are rounded to 4 decimals, the most the API allows, so a band edge is never a number a price can miss.
export function bandEdges(rule?: FieldRule | null): number[] {
  const min = rule?.min ?? 0;
  const max = rule?.max ?? 10;
  if (!(max > min)) return [0, 2.5, 5, 7.5, 10];
  return [0, 1, 2, 3, 4].map(i => round4(min + ((max - min) * i) / 4));
}

const round4 = (n: number) => Number(n.toFixed(4));
// Plain numbers on the page, 2.5 not 2.5000
export const plain = (n: number) => String(round4(n));
export const usd = (n: number, decimals: number) => '$' + n.toFixed(decimals);
// 30,001 not 30001
export const thousands = (n: number) => Math.round(n).toLocaleString('en-US');

// A price of exactly 2.5 sits in the band 2.5 to 5. The first band takes anything below its top, the last takes
// everything from its bottom up, so no price is ever left outside the four bands.
export function bandOf(price: number, edges: number[]): number {
  for (let i = 1; i < 4; i++) if (price < edges[i]) return i - 1;
  return 3;
}

// Browse's max is inclusive, and prices have at most 4 decimals, so "below 2.5" is a max of 2.4999
function bandFilters(i: number, edges: number[]): BrowseFilters {
  const below = round4(edges[i + 1] - 0.0001);
  if (i === 0) return { maxPrice: below };
  if (i === 3) return { minPrice: edges[3] };
  return { minPrice: edges[i], maxPrice: below };
}

// Release periods are 5 calendar years from 1995, the last one is whatever is left up to the newest year (2025 to 2026 today).
// Years far outside this window (a date typed wrong, 0001 or 9999) are left out of the bars instead of making hundreds of them.
export const FIRST_YEAR = 1900;
export const LAST_YEAR = 2100;

export interface Period {
  from: number;
  to: number;
  label: string;
}

export function buildPeriods(years: number[]): Period[] {
  const inside = years.filter(y => y >= FIRST_YEAR && y <= LAST_YEAR);
  const lo = Math.min(1995, ...inside.map(y => Math.floor(y / 5) * 5));
  const hi = Math.max(2026, ...inside);
  const out: Period[] = [];
  for (let from = lo; from <= hi; from += 5) {
    const to = Math.min(from + 4, hi);
    out.push({ from, to, label: from === to ? String(from) : `${from} to ${to}` });
  }
  return out;
}

export function periodOf(year: number | null, periods: Period[]): number {
  if (year === null || year < periods[0].from || year > periods[periods.length - 1].to) return -1;
  return periods.findIndex(p => year <= p.to);
}

function yearFilters(from: number, to: number): BrowseFilters {
  return { releaseFrom: `${from}-01-01`, releaseTo: `${to}-12-31` };
}

// A list of slice names that is too long keeps its first ones and groups the rest, in one place for every split
function capSlices(all: string[], rawOf: (r: Row) => string | null): { keys: string[]; of: (r: Row) => string | null } {
  if (all.length <= MAX_SLICES) return { keys: all, of: rawOf };
  const keep = all.slice(0, MAX_SLICES - 1);
  return {
    keys: [...keep, OTHER],
    of: r => {
      const v = rawOf(r);
      return v === null ? null : keep.includes(v) ? v : OTHER;
    },
  };
}

// The splits the circle can use. Sector, Price band and Release era are built in. Every custom text field that has a list of
// choices is added too (nothing is hardcoded, it all comes from the rules).
export function buildDims(rows: Row[], rules: FieldRule[] | null): Dim[] {
  const field = (key: string) => rules?.find(f => f.key === key) ?? null;
  const dims: Dim[] = [];

  // Sector: the rule's list first, then any other sector found in the table, most used first, so no row is silently dropped
  const sectorRule = field('sector');
  const listed = (sectorRule?.options ?? []).map(o => o.trim()).filter(o => o.length > 0);
  const found = new Map<string, number>();
  for (const r of rows) if (r.sector !== null && !listed.includes(r.sector)) found.set(r.sector, (found.get(r.sector) ?? 0) + 1);
  const extras = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
  const sector = capSlices([...listed, ...extras], r => r.sector);
  dims.push({
    id: 'sector', label: sectorRule?.label ?? 'Sector', custom: false, keys: sector.keys, of: sector.of,
    browse: key => (key === OTHER ? null : { sector: key }),
  });

  const edges = bandEdges(field('price'));
  const bands = [0, 1, 2, 3].map(i => `${plain(edges[i])} to ${plain(edges[i + 1])}`);
  dims.push({
    id: 'band', label: 'Price band', custom: false, keys: bands,
    of: r => (r.price === null ? null : bands[bandOf(r.price, edges)]),
    browse: key => {
      const i = bands.indexOf(key);
      return i < 0 ? null : bandFilters(i, edges);
    },
  });

  const years = rows.map(r => r.year).filter((y): y is number => y !== null && y >= FIRST_YEAR && y <= LAST_YEAR);
  const firstDecade = Math.min(1990, ...years.map(y => Math.floor(y / 10) * 10));
  const lastDecade = Math.max(2020, ...years.map(y => Math.floor(y / 10) * 10));
  const decades: number[] = [];
  for (let d = firstDecade; d <= lastDecade; d += 10) decades.push(d);
  const eraOf = (r: Row) => (r.year === null || r.year < FIRST_YEAR || r.year > LAST_YEAR ? null : `${Math.floor(r.year / 10) * 10}s`);
  const era = capSlices(decades.map(d => `${d}s`), eraOf);
  dims.push({
    id: 'era', label: 'Release era', custom: false, keys: era.keys, of: era.of,
    browse: key => {
      const d = decades.find(x => `${x}s` === key);
      return d === undefined ? null : yearFilters(d, d + 9);
    },
  });

  for (const f of rules ?? []) {
    if (!f.custom || f.hidden || f.type !== 'text' || !f.options?.length) continue;
    const options = f.options.map(o => o.trim()).filter(o => o.length > 0);
    const canon = new Map(options.map(o => [o.toLowerCase(), o]));
    const custom = capSlices(options, r => {
      const v = own(r.extra, f.key);
      return typeof v === 'string' ? canon.get(v.trim().toLowerCase()) ?? null : null;
    });
    // Browse has no filter for a custom field, so these slices can be charted but not opened there
    dims.push({ id: 'extra:' + f.key, label: f.label, custom: true, keys: custom.keys, of: custom.of, browse: () => null });
  }
  return dims;
}

// ---------- The selection ----------

export type Metric = 'count' | 'avg';
export type TopMode = 'top3' | 'top10' | 'low3';

export interface Selection {
  dim: string;
  pick: string | null;
  // Index of the release period picked on a bar
  bar: number | null;
  attns: AttnKey[];
  cmp: boolean;
  cmpKeys: string[];
  metric: Metric;
  topMode: TopMode;
}

export const emptySelection: Selection = { dim: 'sector', pick: null, bar: null, attns: [], cmp: false, cmpKeys: [], metric: 'count', topMode: 'top3' };

// The slices of one split get lighter from the first to the last (both on the light page and the dark one).
// The faintest is still at least 3:1 against the card, so every slice can be seen.
export function tonesFor(n: number): number[] {
  return n === 2 ? [1, 0.45] : n === 3 ? [1, 0.68, 0.45] : [1, 0.78, 0.6, 0.45];
}

export const CIRCLE = 2 * Math.PI * 74;

export interface Slice {
  key: string;
  count: number;
  // Share of the industries that have a value for this split, as text like 54%
  pct: string;
  on: boolean;
  // A or B in Compare mode
  tag: string;
  tone: number;
  dash: string;
  offset: number;
  // Share as a number out of 100, for the thin bar in the Breakdown list
  width: number;
}

export interface Bar {
  label: string;
  // Rows in this period with every filter but the picked slice, and with the picked slice (average price in that metric)
  all: number;
  shown: number;
  // Heights as percent of the bar area
  allH: number;
  shownH: number;
  labelAt: number;
  // The stacked pieces, one per slice, then the rest that has no value for the split
  pieces: { h: number; b: number; n: number }[];
  missH: number;
  missB: number;
  perSlice: number[];
}

export interface CompareBar {
  label: string;
  a: number;
  b: number;
  aH: number;
  bH: number;
}

export interface TopRow {
  id: number;
  rank: number;
  name: string;
  sector: string;
  price: string;
  fill: number;
  release: string;
  flags: string;
}

export interface TopColumn {
  title: string;
  // ink, signal or grey decide the colours in the list
  tone: 'ink' | 'signal';
  note: string;
  rows: TopRow[];
  empty: boolean;
}

export interface Chip {
  id: string;
  label: string;
  aria: string;
  kind: 'pick' | 'bar' | 'attn' | 'cmp';
  key: string;
}

export interface Derived {
  dim: Dim;
  total: number;
  slices: Slice[];
  anyOn: boolean;
  cmpActive: boolean;
  effPick: string | null;
  headline: string;
  insight1: string;
  insight2: string;
  groups: Row[][];
  selected: Row[];
  stats: { count: number; sectors: number; avg: number | null; max: number | null; nulls: number }[];
  bars: Bar[];
  compareBars: CompareBar[];
  stacked: boolean;
  periods: Period[];
  leftOutNoDate: number;
  leftOutRange: number;
  cols: TopColumn[];
  chips: Chip[];
  attention: { key: AttnKey; label: string; count: number; on: boolean }[];
  browse: BrowseFilters | null;
  noMatch: boolean;
  scale: number;
}

const avgOf = (g: Row[]) => {
  const p = g.filter(r => r.price !== null);
  return p.length ? p.reduce((s, r) => s + r.price!, 0) / p.length : null;
};
const maxOf = (g: Row[]) => {
  const p = g.filter(r => r.price !== null);
  return p.length ? Math.max(...p.map(r => r.price!)) : null;
};

export function derive(rows: Row[], dims: Dim[], periods: Period[], sel: Selection, priceMax: number): Derived {
  const dim = dims.find(d => d.id === sel.dim) ?? dims[0];
  const bi = (r: Row) => periodOf(r.year, periods);
  const okAttn = (r: Row) => sel.attns.length === 0 || sel.attns.some(k => attention(k).has(r));
  const okBar = (r: Row) => sel.bar === null || bi(r) === sel.bar;
  const cmpActive = sel.cmp && sel.cmpKeys.length === 2;
  // In Compare mode with one slice picked so far, that slice already filters the rest
  const effPick = sel.cmp ? (sel.cmpKeys.length === 1 ? sel.cmpKeys[0] : null) : sel.pick;
  const okPick = (r: Row) => !effPick || dim.of(r) === effPick;
  const selected = rows.filter(r => okAttn(r) && okBar(r) && okPick(r));
  const groups = cmpActive ? sel.cmpKeys.map(k => rows.filter(r => okAttn(r) && okBar(r) && dim.of(r) === k)) : [selected];

  // The circle ignores its own slice filter, so a picked slice still shows its share of the whole
  const pieRows = rows.filter(r => okAttn(r) && okBar(r));
  const counts = dim.keys.map(k => pieRows.filter(r => dim.of(r) === k).length);
  const total = counts.reduce((s, n) => s + n, 0);
  const tones = tonesFor(dim.keys.length);
  const anyOn = sel.cmp ? sel.cmpKeys.length > 0 : !!effPick;
  let used = 0;
  const slices: Slice[] = dim.keys.map((key, i) => {
    const frac = total ? counts[i] / total : 0;
    const length = Math.max(0, frac * CIRCLE - (dim.keys.length > 1 && frac < 1 ? 3 : 0));
    const at = sel.cmpKeys.indexOf(key);
    const slice: Slice = {
      key, count: counts[i], pct: Math.round(frac * 100) + '%', width: frac * 100,
      on: sel.cmp ? at >= 0 : effPick === key,
      tag: sel.cmp && at >= 0 ? ['A', 'B'][at] : '',
      tone: tones[i], dash: `${length} ${CIRCLE}`, offset: -used,
    };
    used += frac * CIRCLE;
    return slice;
  });
  const lead = [...slices].sort((a, b) => b.count - a.count)[0];
  const dimName = dim.label.toLowerCase();
  const insight1 = total && lead
    ? lead.key === OTHER
      ? `The smaller ${dimName} groups together are the biggest slice, ${lead.pct} of the industries with a ${dimName}.`
      : `${lead.key} is the biggest slice, ${lead.pct} of the industries with a ${dimName}.`
    : 'Nothing to split yet.';
  const missing = pieRows.length - total;
  const insight2 = missing > 0
    ? `${thousands(missing)} ${missing === 1 ? 'industry has' : 'industries have'} no ${dimName} and ${missing === 1 ? 'is' : 'are'} left out.`
    : `Every industry has a ${dimName}.`;

  // Bars. With Count and no slice picked, every bar is stacked from the circle's slices.
  const valueIn = (g: Row[], i: number) => {
    const inPeriod = g.filter(r => bi(r) === i);
    return sel.metric === 'count' ? inPeriod.length : avgOf(inPeriod) ?? 0;
  };
  const base = rows.filter(okAttn);
  const selB = rows.filter(r => okAttn(r) && okPick(r));
  const A = cmpActive ? rows.filter(r => okAttn(r) && dim.of(r) === sel.cmpKeys[0]) : [];
  const B = cmpActive ? rows.filter(r => okAttn(r) && dim.of(r) === sel.cmpKeys[1]) : [];
  const idx = periods.map((_, i) => i);
  const ghostV = idx.map(i => valueIn(base, i));
  const aV = idx.map(i => valueIn(A, i));
  const bV = idx.map(i => valueIn(B, i));
  const scale = sel.metric === 'avg' ? priceMax : Math.max(1, ...ghostV, ...aV, ...bV);
  const pct = (v: number) => (v / scale) * 100 * 0.84;
  const hasSel = !!effPick;
  const stacked = sel.metric === 'count' && !hasSel && !cmpActive;
  const perSlice = dim.keys.map(k => idx.map(i => base.filter(r => bi(r) === i && dim.of(r) === k).length));
  const bars: Bar[] = idx.map(i => {
    const all = ghostV[i];
    const shown = hasSel ? valueIn(selB, i) : all;
    let below = 0;
    const pieces = dim.keys.map((_, j) => {
      const n = perSlice[j][i];
      const piece = { h: pct(n), b: pct(below), n };
      below += n;
      return piece;
    });
    return {
      label: String(periods[i].from), all, shown, allH: pct(all), shownH: pct(shown), labelAt: pct(Math.max(all, shown)),
      pieces, missH: pct(Math.max(0, all - below)), missB: pct(below), perSlice: perSlice.map(p => p[i]),
    };
  });
  const compareBars: CompareBar[] = idx.map(i => ({ label: String(periods[i].from), a: aV[i], b: bV[i], aH: pct(aV[i]), bH: pct(bV[i]) }));

  const stats = groups.map(g => ({
    count: g.length,
    sectors: new Set(g.map(r => r.sector).filter(Boolean)).size,
    avg: avgOf(g),
    max: maxOf(g),
    nulls: g.filter(r => r.price === null).length,
  }));

  // Top list
  const n = sel.topMode === 'top10' ? 10 : 3;
  const column = (g: Row[], title: string, tone: 'ink' | 'signal'): TopColumn => {
    const priced = g.filter(r => r.price !== null).sort((a, b) =>
      (sel.topMode === 'low3' ? a.price! - b.price! : b.price! - a.price!) || a.id - b.id);
    const rowsOut = priced.slice(0, n).map((r, i) => ({
      id: r.id, rank: i + 1, name: r.name, sector: (r.sector ?? 'No sector').replace(' Sector', ''), price: usd(r.price!, 3),
      fill: Math.min(100, (r.price! / priceMax) * 100),
      release: r.year === null ? 'no date' : String(r.year),
      flags: [r.dup ? 'Similar row exists' : '', r.lost ? 'Has lost fields' : ''].filter(Boolean).join(' · '),
    }));
    return { title, tone, note: priced.length < g.length ? `${g.length - priced.length} without a price skipped` : '', rows: rowsOut, empty: rowsOut.length === 0 };
  };
  const cols = cmpActive
    ? [column(groups[0], 'A  ' + sel.cmpKeys[0], 'ink'), column(groups[1], 'B  ' + sel.cmpKeys[1], 'signal')]
    : [column(groups[0], effPick ?? 'All industries', effPick ? 'signal' : 'ink')];

  // Chips for every filter that is on
  const chips: Chip[] = [];
  if (!sel.cmp && sel.pick) chips.push({ id: 'pick', label: `${dim.label}: ${sel.pick}`, aria: `Remove ${sel.pick}`, kind: 'pick', key: sel.pick });
  if (sel.cmp) sel.cmpKeys.forEach((k, i) => chips.push({ id: 'cmp' + k, label: ['A  ', 'B  '][i] + k, aria: `Remove ${k}`, kind: 'cmp', key: k }));
  if (sel.bar !== null && periods[sel.bar]) chips.push({ id: 'bar', label: `Released ${periods[sel.bar].label}`, aria: 'Remove release period', kind: 'bar', key: String(sel.bar) });
  for (const k of sel.attns) chips.push({ id: 'attn' + k, label: attention(k).label, aria: `Remove ${attention(k).label}`, kind: 'attn', key: k });

  const attnBase = rows.filter(r => okBar(r) && okPick(r));
  const attentionList = ATTENTION.map(a => ({ key: a.key, label: a.label, count: attnBase.filter(a.has).length, on: sel.attns.includes(a.key) }));

  return {
    dim, total, slices, anyOn, cmpActive, effPick,
    headline: cmpActive ? `${sel.cmpKeys[0]} vs ${sel.cmpKeys[1]}` : effPick ?? 'All industries',
    insight1, insight2, groups, selected, stats, bars, compareBars, stacked, periods,
    leftOutNoDate: rows.filter(r => r.release === null).length,
    leftOutRange: rows.filter(r => r.year !== null && periodOf(r.year, periods) < 0).length,
    cols, chips, attention: attentionList,
    browse: browseFilters(dim, sel, periods, cmpActive),
    noMatch: !cmpActive && chips.length > 0 && selected.length === 0,
    scale,
  };
}

// ---------- Open in Browse ----------

// The filters Browse needs to show exactly the rows the Overview has selected, or null when it can't do that.
// A count that doesn't match is worse than no link, so anything Browse can't show hides the link.
export function browseFilters(dim: Dim, sel: Selection, periods: Period[], cmpActive: boolean): BrowseFilters | null {
  if (cmpActive || sel.cmp) return null;
  let out: BrowseFilters = {};
  if (sel.pick) {
    const mapped = dim.browse(sel.pick);
    if (mapped === null) return null;
    out = { ...mapped };
  }
  if (sel.bar !== null) {
    const period = periods[sel.bar];
    if (!period) return null;
    const range = yearFilters(period.from, period.to);
    // An era and a period are both date ranges, the rows have to be inside both
    out.releaseFrom = out.releaseFrom && out.releaseFrom > range.releaseFrom! ? out.releaseFrom : range.releaseFrom;
    out.releaseTo = out.releaseTo && out.releaseTo < range.releaseTo! ? out.releaseTo : range.releaseTo;
  }
  // Several flags are one OR group in Browse
  if (sel.attns.length) out.flags = sel.attns.map(k => attention(k).flag);
  return out;
}

// The same filters as the address Browse reads, see MyComponents.seedFromAddress
export function browseParams(f: BrowseFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.sector !== undefined) out['sector'] = f.sector;
  if (f.minPrice !== undefined) out['minPrice'] = String(f.minPrice);
  if (f.maxPrice !== undefined) out['maxPrice'] = String(f.maxPrice);
  if (f.releaseFrom !== undefined) out['releaseFrom'] = f.releaseFrom;
  if (f.releaseTo !== undefined) out['releaseTo'] = f.releaseTo;
  if (f.flags?.length) out['flags'] = f.flags.join(',');
  return out;
}

// ---------- Find an industry ----------

// Rank by price, 1 is the most expensive. Rows with no price have no rank.
export function rankRows(rows: Row[]): { rank: Map<number, number>; ranked: number } {
  const priced = rows.filter(r => r.price !== null).sort((a, b) => b.price! - a.price! || a.id - b.id);
  return { rank: new Map(priced.map((r, i) => [r.id, i + 1])), ranked: priced.length };
}
