import { Component, DestroyRef, Injector, OnInit, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FieldRule, Industry } from '../../models/industry';
import { IndustryApi } from '../../services/industry-api';
import { Shortcuts, capsOf } from '../../services/shortcuts';
import { Toast } from '../../services/toast';
import { countUp } from './count-up';
import {
  Bar, Metric, OTHER, Selection, TopMode, bandEdges, browseParams, buildDims, buildPeriods, derive, emptySelection, plain, rankRows, toRow, usd,
} from './overview-data';

// The admin Overview: the table at a glance. For spotting, Browse is for acting.
// One selection (sel) drives every number on the page. All the sums are in overview-data.ts, this file is the page's state and its keys.
// Design: design/C-Signal-Light.dc.html, notes in design/OVERVIEW_HANDOFF.md.
@Component({
  imports: [RouterLink],
  selector: 'app-overview',
  styleUrl: './overview.css',
  templateUrl: './overview.html',
})
export class OverviewPage implements OnInit {
  private api = inject(IndustryApi);
  protected keys = inject(Shortcuts);
  private toast = inject(Toast);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);

  // The page can be loading, ready, or failed before it ever had numbers. Once it has numbers, a failed refresh only makes them "out of date".
  items = signal<Industry[]>([]);
  rules = signal<FieldRule[] | null>(null);
  loading = signal(true);
  // What went wrong on the first load, shown behind "Show details"
  failure = signal<string | null>(null);
  showDetails = signal(false);
  loadedAt = signal<number | null>(null);
  stale = signal(false);
  private clock = signal(Date.now());

  ngOnInit() {
    this.load();
    // New rows show up without a reload. The numbers refresh every minute while the page is in view.
    const every = setInterval(() => { this.clock.set(Date.now()); if (!document.hidden) this.load(); }, 60000);
    const visible = () => { if (!document.hidden && Date.now() - (this.loadedAt() ?? 0) > 60000) this.load(); };
    document.addEventListener('visibilitychange', visible);
    const off = this.keys.register('overview', {
      'ov.slice1': () => this.splitByNumber(1), 'ov.slice2': () => this.splitByNumber(2), 'ov.slice3': () => this.splitByNumber(3),
      'ov.slice4': () => this.splitByNumber(4), 'ov.slice5': () => this.splitByNumber(5),
      'ov.find': () => document.getElementById('find')?.focus(),
      'ov.compare': () => { this.toggleCompare(); this.toast.say(this.sel().cmp ? 'Compare is on. Pick two slices.' : 'Compare is off'); },
      'ov.metric': () => { const next = this.sel().metric === 'count' ? 'avg' : 'count'; this.setMetric(next); this.toast.say('Bars show ' + (next === 'avg' ? 'average price' : 'count')); },
      'ov.top': () => {
        const order: TopMode[] = ['top3', 'top10', 'low3'];
        const next = order[(order.indexOf(this.sel().topMode) + 1) % 3];
        this.setTopMode(next);
        this.toast.say({ top3: 'Top 3 most expensive', top10: 'Top 10 most expensive', low3: '3 cheapest' }[next]);
      },
      'ov.clear': () => { this.clearEverything(); this.toast.say('Every filter cleared'); },
    });
    this.destroyRef.onDestroy(() => { clearInterval(every); document.removeEventListener('visibilitychange', visible); off(); });
  }

  load() {
    this.api.getAll().subscribe({
      next: data => {
        this.items.set(data);
        this.loadedAt.set(Date.now());
        this.clock.set(Date.now());
        this.failure.set(null);
        this.stale.set(false);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        // With numbers already on the page they stay, marked as out of date
        if (this.loadedAt() !== null) { this.stale.set(true); return; }
        this.failure.set(err.status === 0 ? 'no response from the server' : `the server answered ${err.status} ${err.statusText}`.trim());
        this.loading.set(false);
      },
    });
    // The rules give the split lists their names and the price bands their size. Without them the page still works from the rows.
    this.api.schema().subscribe({ next: r => this.rules.set(r.fields), error: () => {} });
  }

  retry() {
    this.loading.set(true);
    this.failure.set(null);
    this.load();
  }

  staleText = computed(() => {
    const minutes = Math.max(0, Math.round((this.clock() - (this.loadedAt() ?? this.clock())) / 60000));
    return minutes < 1 ? 'less than a minute ago' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  });

  // ---------- The numbers ----------

  rows = computed(() => this.items().map(toRow));
  dims = computed(() => buildDims(this.rows(), this.rules()));
  periods = computed(() => buildPeriods(this.rows().map(r => r.year).filter((y): y is number => y !== null)));
  private priceRule = computed(() => this.rules()?.find(f => f.key === 'price') ?? null);
  // The top of the price scale, for the average bars and the little bars in the list
  priceMax = computed(() => bandEdges(this.priceRule())[4]);
  empty = computed(() => !this.loading() && this.failure() === null && this.items().length === 0);

  sel = signal<Selection>({ ...emptySelection });
  view = computed(() => derive(this.rows(), this.dims(), this.periods(), this.sel(), this.priceMax()));

  private patch(p: Partial<Selection>) {
    this.sel.update(s => ({ ...s, ...p }));
  }

  // Looking, not filtering: which slice or bar the mouse is over, which row of the list is open
  hov = signal<string | null>(null);
  hovBar = signal<number | null>(null);
  hovTop = signal<number | null>(null);
  openId = signal<number | null>(null);

  // ---------- Slice by, the circle and the Breakdown list ----------

  splitBy(id: string) {
    this.patch({ dim: id, pick: null, cmpKeys: [] });
    this.hov.set(null);
  }

  private splitByNumber(n: number) {
    const dim = this.dims()[n - 1];
    if (!dim) { this.toast.say('There is no split number ' + n + ' yet.'); return; }
    this.splitBy(dim.id);
    this.toast.say('Circle split by ' + dim.label);
  }

  // Click a slice to see only it, click it again to go back. In Compare mode the last two clicked are A and B.
  togglePick(key: string) {
    const s = this.sel();
    if (s.cmp) {
      const keys = [...s.cmpKeys];
      const at = keys.indexOf(key);
      if (at >= 0) keys.splice(at, 1);
      else { keys.push(key); if (keys.length > 2) keys.shift(); }
      this.patch({ cmpKeys: keys });
    } else {
      this.patch({ pick: s.pick === key ? null : key });
    }
  }

  toggleCompare() {
    const s = this.sel();
    this.patch({ cmp: !s.cmp, cmpKeys: s.cmp ? [] : s.pick ? [s.pick] : [], pick: s.cmp ? s.cmpKeys[0] ?? null : null });
  }

  // The label in the middle of the circle: the slice under the mouse, the picked slice, or everything
  centre = computed(() => {
    const d = this.view();
    const active = this.hov() ?? (this.sel().cmp ? null : d.effPick);
    const slice = d.slices.find(s => s.key === active);
    if (slice) return { label: slice.key, value: slice.count, text: '', sub: `${slice.pct} of industries`, size: 'big' };
    if (d.cmpActive) return { label: 'Comparing', value: null, text: `${d.groups[0].length} / ${d.groups[1].length}`, sub: 'A / B', size: 'mid' };
    return { label: 'All industries', value: d.total, text: '', sub: `${d.dim.label.toLowerCase()} known`, size: 'big' };
  });
  centreNumber = countUp(() => this.centre().value ?? 0);
  statCount = countUp(() => this.view().stats[0].count);
  statNulls = countUp(() => this.view().stats[0].nulls);
  statAvg = countUp(() => (this.view().stats[0].avg ?? 0) * 100);

  // The colour of a slice: orange when picked or hovered (and dimmed the rest), otherwise the ink at its own shade
  sliceOpacity(s: { on: boolean; key: string; tone: number }): number {
    const lit = this.hov() === s.key && !s.on;
    return this.view().anyOn ? (s.on || lit ? 1 : 0.14) : lit ? 1 : s.tone;
  }

  sliceColour(s: { on: boolean; key: string; tag: string }): string {
    if (this.sel().cmp) return s.tag === 'B' ? 'var(--signal)' : 'var(--text)';
    return s.on || this.hov() === s.key ? 'var(--signal)' : 'var(--text)';
  }

  // ---------- Bars ----------

  barOpacity(i: number): number {
    const bar = this.sel().bar;
    return bar !== null && bar !== i ? 0.4 : 1;
  }

  toggleBar(i: number) {
    this.patch({ bar: this.sel().bar === i ? null : i });
  }

  setMetric(metric: Metric) {
    this.patch({ metric });
  }

  setTopMode(mode: TopMode) {
    this.patch({ topMode: mode });
    this.openId.set(null);
  }

  fmt(v: number): string {
    return this.sel().metric === 'count' ? String(v) : v ? usd(v, 2) : '—';
  }

  fmtBar(v: number): string {
    return v ? this.fmt(v) : '';
  }

  barAria(b: Bar, i: number): string {
    return `${this.view().periods[i].label}, ${this.fmt(b.shown)}${this.sel().metric === 'count' ? ' industries' : ' average price'}, press to filter`;
  }

  // The three lines in a bar's tooltip
  barTip(b: Bar, i: number): string[] {
    const d = this.view();
    const count = this.sel().metric === 'count';
    const hov = this.hov();
    let third = 'Click to filter by this period';
    if (d.stacked) {
      if (hov) third = `${b.perSlice[d.dim.keys.indexOf(hov)] ?? 0} in ${hov}`;
      else third = 'Split like the circle. Click to filter by this period';
    } else if (d.effPick) {
      third = count ? `${b.shown} in ${d.effPick} (${b.all ? Math.round((b.shown / b.all) * 100) : 0}%)` : `${d.effPick}: ${this.fmt(b.shown)}`;
    }
    return [d.periods[i].label, count ? `${b.all} industries in total` : `Average ${this.fmt(b.all)} overall`, third];
  }

  // A stacked piece: the ink at the slice's shade, orange while that slice is hovered, the others fade
  pieceColour(key: string): string {
    return this.hov() === key ? 'var(--signal)' : 'var(--text)';
  }

  pieceOpacity(key: string, tone: number): number {
    const hov = this.hov();
    return hov ? (hov === key ? 1 : 0.16) : tone;
  }

  tipLeft(i: number): boolean { return i === 0; }
  tipRight(i: number): boolean { return i === this.view().bars.length - 1; }

  barFoot = computed(() => {
    const d = this.view();
    const last = d.periods[d.periods.length - 1];
    let text = d.stacked ? 'Each bar is split like the circle. Click a slice to see only its bars. ' : '';
    if (d.leftOutNoDate) text += `${d.leftOutNoDate} without a release date are left out. `;
    if (d.leftOutRange) text += `${d.leftOutRange} with a date before 1900 or after 2100 are left out. `;
    text += `5 year periods, the last is ${last.label}.`;
    if (this.sel().metric === 'avg') text += ` Bars are out of ${usd(this.priceMax(), 0)}. Averages cannot be stacked, so pick a slice to see its own bars.`;
    return text;
  });

  // ---------- Filters ----------

  toggleAttention(key: Selection['attns'][number]) {
    const s = this.sel();
    this.patch({ attns: s.attns.includes(key) ? s.attns.filter(k => k !== key) : [...s.attns, key] });
  }

  // The button that had focus is gone after a chip is removed or everything is cleared, so a keyboard user would be dropped on the page.
  // Focus goes to the next chip's remove button, or to the row of chips when there are none left.
  private keepFocus() {
    afterNextRender(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const next = document.querySelector<HTMLElement>('.ov .chip button') ?? document.querySelector<HTMLElement>('.ov .chips');
      next?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  removeChip(kind: 'pick' | 'bar' | 'attn' | 'cmp', key: string) {
    const s = this.sel();
    if (kind === 'pick') this.patch({ pick: null });
    else if (kind === 'bar') this.patch({ bar: null });
    else if (kind === 'attn') this.patch({ attns: s.attns.filter(k => k !== key) });
    else this.patch({ cmpKeys: s.cmpKeys.filter(k => k !== key) });
    this.keepFocus();
  }

  // The Clear all button leaves Compare mode as it is, the Esc key puts everything back
  clearAll() {
    this.patch({ pick: null, bar: null, attns: [], cmpKeys: [] });
    this.focusId.set(null);
    this.keepFocus();
  }

  clearEverything() {
    this.patch({ pick: null, bar: null, attns: [], cmpKeys: [], cmp: false });
    this.focusId.set(null);
    this.openId.set(null);
    this.hov.set(null);
  }

  // The link to Browse with exactly these filters, or nothing when Browse can't show the same rows (then the link is hidden)
  browse = computed(() => {
    const d = this.view();
    if (d.cmpActive || d.chips.length === 0 || d.selected.length === 0 || d.browse === null) return null;
    return { params: browseParams(d.browse), count: d.selected.length };
  });

  hint = computed(() => (this.sel().cmp ? 'Compare is on. Pick two slices.' : 'Click a slice, a bar or a chip to filter.'));
  compareHint = computed(() => {
    const n = this.sel().cmpKeys.length;
    return n === 0 ? 'Pick the first slice (A).' : n === 1 ? 'Now pick the second slice (B).' : 'Pick another slice to swap out A.';
  });

  railTitle = computed(() => (this.view().cmpActive ? 'A VS B' : this.view().chips.length ? 'SELECTION' : 'ALL INDUSTRIES'));

  compareRows = computed(() => {
    const [a, b] = this.view().stats;
    if (!b) return [];
    const two = (v: number | null) => (v === null ? '—' : usd(v, 2));
    const three = (v: number | null) => (v === null ? '—' : usd(v, 3));
    return [
      { label: 'Industries', a: String(a.count), b: String(b.count) },
      { label: 'Average price', a: two(a.avg), b: two(b.avg) },
      { label: 'Highest price', a: three(a.max), b: three(b.max) },
      { label: 'No price yet', a: String(a.nulls), b: String(b.nulls) },
    ];
  });

  // Arrow keys step through the options of a list: the focus ring and the choice move together, it wraps at the ends,
  // and the page doesn't scroll while you are inside the list. Tab and Enter work on the real buttons as usual.
  private stepFocus(e: KeyboardEvent, selectedIndex: number): number {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return -1;
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-opt]')];
    if (!buttons.length) return -1;
    e.preventDefault();
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    let at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) at = selectedIndex;
    const next = at < 0 ? (forward ? 0 : buttons.length - 1) : (at + (forward ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    return next;
  }

  onSplitKey(e: KeyboardEvent) {
    const dims = this.dims();
    const next = this.stepFocus(e, dims.findIndex(d => d.id === this.view().dim.id));
    if (next >= 0) this.splitBy(dims[next].id);
  }

  // In Compare mode the arrows only move focus, picking two slices is a deliberate click
  onSliceKey(e: KeyboardEvent) {
    const d = this.view();
    const s = this.sel();
    const next = this.stepFocus(e, s.cmp ? -1 : d.dim.keys.indexOf(s.pick ?? ''));
    if (next >= 0 && !s.cmp) this.patch({ pick: d.dim.keys[next] });
  }

  // ---------- Find an industry ----------

  q = signal('');
  focusId = signal<number | null>(null);
  private ranks = computed(() => rankRows(this.rows()));

  private line(r: { id: number; sector: string | null; year: number | null }): string {
    const { rank, ranked } = this.ranks();
    const place = rank.has(r.id) ? `#${rank.get(r.id)} of ${ranked} by price` : 'No price';
    return `${place} · ${(r.sector ?? 'No sector').replace(' Sector', '')} · ${r.year === null ? 'no date' : r.year}`;
  }

  hits = computed(() => {
    const needle = this.q().trim().toLowerCase();
    if (needle.length < 2) return [];
    return this.rows().filter(r => r.name.toLowerCase().includes(needle)).slice(0, 4).map(r => ({ id: r.id, name: r.name, line: this.line(r) }));
  });

  found = computed(() => {
    const row = this.rows().find(r => r.id === this.focusId());
    if (!row) return null;
    const { rank, ranked } = this.ranks();
    const at = rank.get(row.id);
    return {
      id: row.id, name: row.name,
      rank: at ? `#${at} of ${ranked}` : 'No price yet',
      price: row.price === null ? '—' : usd(row.price, 3),
      sector: row.sector ?? 'No sector',
      released: row.year === null ? 'No date' : String(row.year),
      note: at ? `Priced above ${Math.round(((ranked - at) / ranked) * 100)}% of the industries that have a price.` : 'It has no price, so it has no rank.',
      flags: [row.dup ? 'Similar row exists' : '', row.lost ? 'Has lost fields' : ''].filter(Boolean).join(' · '),
    };
  });

  pickHit(id: number) {
    this.focusId.set(id);
    this.q.set('');
  }

  // ---------- Names for the Shortcuts panel ----------

  constructor() {
    // "Split by Sector" and so on, from the splits this page really has
    effect(() => {
      const labels: Record<string, string> = {};
      const unused: string[] = [];
      for (let n = 1; n <= 5; n++) {
        if (this.dims()[n - 1]) labels['ov.slice' + n] = 'Split by ' + this.dims()[n - 1].label;
        else unused.push('ov.slice' + n);
      }
      this.keys.setLabels(labels);
      this.keys.setUnused(unused);
    });
  }

  // The key shown beside a split in the Slice by list, it follows what the person set in the Shortcuts panel
  keyHint(n: number): string {
    return capsOf(this.keys.bound()['ov.slice' + n] ?? []).map(k => k.text).join(' ');
  }

  // For the template
  protected readonly OTHER = OTHER;
  protected plain = plain;
  protected usd = usd;
}
