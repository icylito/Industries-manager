import { Component, DestroyRef, Injector, OnInit, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { timeout } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FieldRule, Industry } from '../../models/industry';
import { Auth } from '../../services/auth';
import { IndustryApi } from '../../services/industry-api';
import { Shortcuts, capsOf } from '../../services/shortcuts';
import { Toast } from '../../services/toast';
import { TrayStore } from '../../board/tray-store';
import { CARD_DRAG } from '../carry-tray/snapshot-look';
import { countUp } from './count-up';
import {
  Bar, Metric, OTHER, Selection, TopMode, bandEdges, browseParams, buildDims, buildPeriods, derive, emptySelection, plain, rankRows, thousands, toRow, usd,
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
  private auth = inject(Auth);
  protected keys = inject(Shortcuts);
  private toast = inject(Toast);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private tray = inject(TrayStore);
  private route = inject(ActivatedRoute);
  // A snapshot on the Scratchpad opens the Overview on the split and slice it was taken from: ?split=&pick=
  private fromAddress: { split: string | null; pick: string | null } | null = null;

  // The page can be loading, ready, or failed before it ever had numbers. Once it has numbers, a failed refresh only makes them "out of date".
  items = signal<Industry[]>([]);
  rules = signal<FieldRule[] | null>(null);
  loading = signal(true);
  // What went wrong on the first load, shown behind "Show details", and what kind of trouble it was (the words on the card follow it)
  failure = signal<string | null>(null);
  failureKind = signal<'down' | 'broken' | 'slow'>('down');
  failedAt = signal<Date | null>(null);
  showDetails = signal(false);
  loadedAt = signal<number | null>(null);
  stale = signal(false);
  // A try again or a Refresh now that is waiting for the server, so the button can say so
  retrying = signal(false);
  refreshing = signal(false);
  // Loading for longer than usual, the grey page says so
  slow = signal(false);
  private clock = signal(Date.now());

  // How long the server gets before the page gives up and says so, instead of a grey page that never ends
  static readonly GiveUpAfterMs = 20000;
  static readonly SlowAfterMs = 10000;

  ngOnInit() {
    const query = this.route.snapshot.queryParamMap;
    if (query.get('split')) this.fromAddress = { split: query.get('split'), pick: query.get('pick') };
    this.load();
    const slowTimer = setTimeout(() => { if (this.loading()) this.slow.set(true); }, OverviewPage.SlowAfterMs);
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
    // While the Overview is open, a card dropped on the carry tray is carried
    this.tray.carrier.set(kind => void this.carry(kind));
    this.destroyRef.onDestroy(() => { clearTimeout(slowTimer); clearInterval(every); document.removeEventListener('visibilitychange', visible); off(); this.tray.carrier.set(null); });
  }

  // manual is a press of Try again or Refresh now, they say what happened. The quiet refresh every minute stays quiet.
  load(manual = false) {
    this.api.getAll().pipe(timeout(OverviewPage.GiveUpAfterMs)).subscribe({
      next: data => {
        const wasStale = this.stale();
        this.items.set(data);
        this.loadedAt.set(Date.now());
        this.applyAddress();
        this.clock.set(Date.now());
        this.failure.set(null);
        this.stale.set(false);
        this.loading.set(false);
        this.slow.set(false);
        this.retrying.set(false);
        this.refreshing.set(false);
        if (manual && wasStale) { this.toast.say('Numbers updated.'); this.restoreFocus(); }
        // The page may have opened while the server was down, so who is signed in is still to be asked
        this.auth.recheck();
      },
      error: (err: HttpErrorResponse | Error) => {
        this.retrying.set(false);
        this.refreshing.set(false);
        this.slow.set(false);
        this.failedAt.set(new Date());
        // With numbers already on the page they stay, marked as out of date
        if (this.loadedAt() !== null) {
          this.stale.set(true);
          if (manual) { this.toast.say(`Still can't reach the server. These numbers are from ${this.staleText()}.`); this.restoreFocus(); }
          return;
        }
        const status = err instanceof HttpErrorResponse ? err.status : -1;
        this.failureKind.set(status === -1 ? 'slow' : status === 0 ? 'down' : 'broken');
        this.failure.set(status === -1 ? `no answer after ${OverviewPage.GiveUpAfterMs / 1000} seconds`
          : status === 0 ? 'no response from the server'
          : `the server answered ${status} ${(err as HttpErrorResponse).statusText}`.trim());
        this.loading.set(false);
        // Pressing Try again and failing again leaves the person where they were, with a word about it
        if (manual) {
          this.toast.say(`Still can't reach the server. Tried again at ${this.failedTime()}.`);
          afterNextRender(() => document.querySelector<HTMLElement>('.ov .notice-card .btn.solid')?.focus({ preventScroll: true }), { injector: this.injector });
        }
      },
    });
    // The rules give the split lists their names and the price bands their size. Without them the page still works from the rows.
    this.api.schema().subscribe({ next: r => this.rules.set(r.fields), error: () => {} });
  }

  // Once, after the first numbers: a split this table doesn't have, or a slice it doesn't have, is ignored
  private applyAddress() {
    const wanted = this.fromAddress;
    if (!wanted) return;
    this.fromAddress = null;
    const dim = this.dims().find(d => d.id === wanted.split);
    if (!dim) return;
    this.patch({ dim: dim.id, pick: wanted.pick && dim.keys.includes(wanted.pick) ? wanted.pick : null, cmpKeys: [], cmp: false });
  }

  // ---------- Carry: a frozen snapshot of the circle or the list, to the tray on the Scratchpad ----------

  carrying = signal(false);

  async carry(kind: 'circle' | 'list') {
    if (this.carrying()) return;
    const d = this.view();
    const picked = d.effPick;
    const snap = kind === 'circle'
      ? {
        title: `Circle split by ${d.dim.label}` + (picked ? `, ${picked} selected` : ''),
        numbers: d.slices.map(s => ({ label: s.key, value: thousands(s.count), share: s.count })),
      }
      : {
        // "Top 3 most expensive: All industries", so the card says which list it was and of what
        title: { top3: 'Top 3 most expensive', top10: 'Top 10 most expensive', low3: '3 cheapest' }[this.sel().topMode]
          + ': ' + (d.cols[0]?.title ?? 'the table'),
        numbers: (d.cols[0]?.rows ?? []).map(r => ({ label: r.name, value: r.price })),
      };
    this.carrying.set(true);
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 's' + Date.now();
    const ok = await this.tray.carry({ id, kind, ...snap, takenAt: new Date().toISOString(), split: d.dim.id, pick: picked });
    this.carrying.set(false);
    this.toast.say(ok ? 'Carried. It waits in the tray at the bottom of the page.' : "Couldn't carry it. Check the connection, then try again.");
  }

  // The circle card and the list card can be dragged onto the carry tray, as well as the Carry buttons
  onCardDragStart(event: DragEvent, kind: 'circle' | 'list') {
    if (!event.dataTransfer || this.loading()) return;
    event.dataTransfer.setData(CARD_DRAG, kind);
    event.dataTransfer.effectAllowed = 'copy';
  }

  // Try again keeps the failure card up and says it is trying, it doesn't swap the page for a grey one and back
  retry() {
    if (this.retrying()) return;
    this.retrying.set(true);
    this.load(true);
  }

  // A button that was pressed and then disabled while it worked loses focus, so it goes back to the button, or to the headline when the
  // banner is gone, and a keyboard user stays where they were
  private restoreFocus() {
    afterNextRender(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      (document.querySelector<HTMLElement>('.ov .stale .btn') ?? document.querySelector<HTMLElement>('.ov h1'))?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  refreshNow() {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.load(true);
  }

  failedTime = computed(() => (this.failedAt() ?? new Date()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

  // The words on the failure card, by what kind of trouble it was
  failureText = computed(() => {
    const tail = ' Nothing was changed.';
    switch (this.failureKind()) {
      case 'slow': return "The server is taking too long to answer, so the numbers can't be shown." + tail + ' Try again in a moment.';
      case 'broken': return 'The server answered, but it has a problem right now, so the numbers can\'t be shown.' + tail + ' If it keeps happening, tell whoever looks after the server.';
      default: return "The page couldn't reach the server, so the numbers can't be shown." + tail + ' If it keeps happening, tell whoever looks after the server.';
    }
  });

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
    if (slice) return { label: slice.key, value: slice.count, text: '', sub: `${slice.pct} of industries`, size: this.sizeFor(slice.count) };
    if (d.cmpActive) return { label: 'Comparing', value: null, text: `${thousands(d.groups[0].length)} / ${thousands(d.groups[1].length)}`, sub: 'A / B', size: 'mid' };
    return { label: 'All industries', value: d.total, text: '', sub: `${d.dim.label.toLowerCase()} known`, size: this.sizeFor(d.total) };
  });

  // Five digits and up (30,013) would touch the ring at the big size
  private sizeFor(n: number): string {
    return n >= 10000 ? 'five' : 'big';
  }
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
    return this.sel().metric === 'count' ? thousands(v) : v ? usd(v, 2) : '—';
  }

  // Counts for the page: 30,001 and not 30001
  protected n = thousands;

  // Where the tooltip of a pair of bars sits: just above the taller bar
  pairAt(b: { aH: number; bH: number }): number {
    return Math.max(b.aH, b.bH);
  }

  // The tooltip of a pair of bars, with the exact numbers
  pairTip(b: { a: number; b: number }, i: number): string[] {
    const [a, c] = this.sel().cmpKeys;
    return [this.view().periods[i].label, `A  ${a}: ${this.fmt(b.a)}`, `B  ${c}: ${this.fmt(b.b)}`];
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
      if (hov) third = `${thousands(b.perSlice[d.dim.keys.indexOf(hov)] ?? 0)} in ${hov}`;
      else third = 'Split like the circle. Click to filter by this period';
    } else if (d.effPick) {
      third = count ? `${thousands(b.shown)} in ${d.effPick} (${b.all ? Math.round((b.shown / b.all) * 100) : 0}%)` : `${d.effPick}: ${this.fmt(b.shown)}`;
    }
    return [d.periods[i].label, count ? `${thousands(b.all)} industries in total` : `Average ${this.fmt(b.all)} overall`, third];
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
    if (d.leftOutNoDate) text += `${thousands(d.leftOutNoDate)} without a release date ${d.leftOutNoDate === 1 ? 'is' : 'are'} left out. `;
    if (d.leftOutRange) text += `${thousands(d.leftOutRange)} with a date before 1900 or after 2100 ${d.leftOutRange === 1 ? 'is' : 'are'} left out. `;
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
      { label: 'Industries', a: thousands(a.count), b: thousands(b.count) },
      { label: 'Average price', a: two(a.avg), b: two(b.avg) },
      { label: 'Highest price', a: three(a.max), b: three(b.max) },
      { label: 'No price yet', a: thousands(a.nulls), b: thousands(b.nulls) },
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
    const place = rank.has(r.id) ? `#${thousands(rank.get(r.id)!)} of ${thousands(ranked)} by price` : 'No price';
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
      rank: at ? `#${thousands(at)} of ${thousands(ranked)}` : 'No price yet',
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
