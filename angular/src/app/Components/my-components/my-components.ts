import { Component, signal, computed, inject, OnInit, HostListener, DestroyRef } from '@angular/core';
import { Industry, CreateIndustry, DbHealth, FieldRule, RuleSet } from '../../models/industry';
import { Auth } from '../../services/auth';
import { IndustryApi } from '../../services/industry-api';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';

// A custom field can be named constructor or toString. A plain obj[key] would return a built in function.
function own(obj: object | null | undefined, key: string): unknown {
  if (obj == null || !Object.hasOwn(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-my-components',
  styleUrl: './my-components.css',
  templateUrl: './my-components.html',
})

export class MyComponents implements OnInit { 
  private api = inject(IndustryApi);
  protected auth = inject(Auth);
  private fb = inject(FormBuilder);

  // General Table logic 

  // Validators come from the API's rules (GET /schema), see applyRules
  form = this.fb.group({
    name: [''],
    sector: [''],
    price: [null as number | null],
    release: [''],
  })

  // The two sectors people pick. Anything else only shows while editing a row that already has it.
  sectorChoices = ['Public Sector', 'Private Sector'];

  otherSector(): string | null {
    const value = this.form.controls.sector.value;
    if (!value || this.sectorChoices.includes(value)) return null;
    return value;
  }
// signals for error, saving, editingId, formError
  industries = signal<Industry[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  editingId = signal<number | null>(null);
  formError = signal('');

   submit() {
    if (this.form.invalid) {
      if (this.form.controls.sector.hasError('required')) {
        this.form.controls.sector.markAsDirty();
        this.formError.set('Choose a sector');
      }
      return;
    }

    // Table logic and enforcements
    const verify = this.form.getRawValue();
    const body: CreateIndustry = {
      name: verify.name ?? '',
      sector: verify.sector ?? '',
      price: verify.price,
      release: verify.release || null,
      extra: this.extraBody(),
    };

    this.saving.set(true);
    this.formError.set('');

    const id = this.editingId();

    // Create/ POST logic
    if (id === null) {
      this.api.create(body).subscribe({
        next: created => {
          this.industries.update(list => [...list, created]);
          this.form.reset({ sector: '' });
          this.extraValues.set({});
          this.saving.set(false);
        },
        error: err => {
          this.formError.set(this.errorMessage(err));
          this.saving.set(false);
        },
      });
    } else {
      // update/PUT logic 
      this.api.update(id, body).subscribe({
        next: () => {
          this.cancelEdit();
          this.saving.set(false);
          // Reload so flags that cleared on save (similar row, couldn't be brought over) update too
          this.loadIndustries();
        },
        error: err => {
          this.formError.set(this.errorMessage(err));
          this.saving.set(false);
        },
      });
    }
  }
// State erorr if it couldn't be saved
  private errorMessage (err: any): string {
    const body = err.error;
    if (typeof body === 'string') return body;
    // ProblemDetails, for example the 503 the API sends while the database is migrating
    if (body?.detail) return body.detail;
    if (body?.errors) return Object.values(body.errors).flat().join(' ');
    return 'Could not save. Try again later';
  }

  // Rules in use, from GET /schema. Changing a limit in the database changes the form, nothing here
  rules = signal<RuleSet | null>(null);

  private loadRules() {
    this.api.schema().subscribe({
      next: rules => {
        this.applyRules(rules.fields);
        this.rules.set(rules);
      },
      // Without the rules the form still works, the API checks every save anyway
      error: () => this.rules.set(null),
    });
  }

  private applyRules(fields: FieldRule[]) {
    const sector = fields.find(f => f.key === 'sector');
    const options = (sector?.options ?? []).map(o => o.trim()).filter(o => o.length > 0);
    this.sectorChoices = options.length ? options : ['Public Sector', 'Private Sector'];
    for (const rule of fields) {
      const control = this.form.get(rule.key);
      if (!control) continue;
      const validators: ValidatorFn[] = [];
      if (rule.required) validators.push(Validators.required);
      if (rule.maxLength !== null) validators.push(Validators.maxLength(rule.maxLength));
      if (rule.min !== null) validators.push(Validators.min(rule.min));
      if (rule.max !== null) validators.push(Validators.max(rule.max));
      control.setValidators(validators);
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  // Same wording as the API's messages in api_v2/Rules/RulesService.cs
  fieldErrors(): string[] {
    const list: string[] = [];
    for (const rule of this.rules()?.fields ?? []) {
      const errors = this.form.get(rule.key)?.errors;
      if (errors?.['maxlength']) list.push(`${rule.label} can be at most ${rule.maxLength} characters`);
      if (errors?.['min'] || errors?.['max']) list.push(this.rangeText(rule, true));
    }
    for (const rule of this.customFields()) {
      const problem = this.checkValue(rule, this.extraValue(rule.key));
      if (problem && this.extraTouched().has(rule.key)) list.push(problem);
    }
    return list;
  }

  // Custom fields from the Fields page, their inputs sit after the built in ones
  customFields = computed(() => (this.rules()?.fields ?? []).filter(f => f.custom && !f.hidden));
  extraValues = signal<Record<string, string>>({});
  extraTouched = signal(new Set<string>());

  extraValue(key: string): string {
    const value = own(this.extraValues(), key);
    return value == null ? '' : String(value);
  }

  setExtra(key: string, value: string) {
    this.extraValues.update(v => ({ ...v, [key]: value }));
    this.extraTouched.update(t => new Set(t).add(key));
    this.formError.set('');
  }

  customInvalid = computed(() =>
    this.customFields().some(rule => this.checkValue(rule, this.extraValue(rule.key)) !== null));

  private extraBody(): Record<string, string | number | null> {
    const body: Record<string, string | number | null> = {};
    for (const rule of this.customFields()) {
      const raw = this.extraValue(rule.key).trim();
      body[rule.key] = raw === '' ? null : rule.type === 'number' ? Number(raw) : raw;
    }
    return body;
  }

  // One value against its rule, the same checks and wording the API uses
  checkValue(rule: FieldRule, value: unknown): string | null {
    const empty = value === null || value === undefined || String(value).trim() === '';
    if (empty) return rule.required ? `${rule.label} is required` : null;
    if (rule.type === 'text' && rule.options?.length) {
      const text = String(value).trim();
      const listed = rule.options.some(o => o.toLowerCase() === text.toLowerCase());
      if (!listed) return `${rule.label} has to be one of: ${rule.options.join(', ')}`;
    }
    if (rule.type === 'text' && rule.maxLength !== null && String(value).trim().length > rule.maxLength)
      return `${rule.label} can be at most ${rule.maxLength} characters`;
    if (rule.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) return `${rule.label} has to be a number`;
      if ((rule.min !== null && n < rule.min) || (rule.max !== null && n > rule.max)) return this.rangeText(rule, true);
    }
    return null;
  }

  private rangeText(rule: FieldRule, asError: boolean): string {
    const { label, min, max } = rule;
    if (min !== null && max !== null) return asError ? `${label} has to be between ${min} and ${max}` : `${label} between ${min} and ${max}`;
    if (min !== null) return asError ? `${label} has to be at least ${min}` : `${label}, at least ${min}`;
    return asError ? `${label} has to be at most ${max}` : `${label}, at most ${max}`;
  }

  private readonly ruleIcons: Record<string, string> = {
    name: 'fa-solid fa-font',
    sector: 'fa-solid fa-industry',
    price: 'fa-solid fa-dollar-sign',
    release: 'fa-regular fa-calendar',
  };

  // The rule chips above the form, one per field
  ruleChips = computed(() =>
    (this.rules()?.fields ?? []).map(rule => ({
      key: rule.key,
      icon: (own(this.ruleIcons, rule.key) as string | undefined) ?? 'fa-solid fa-circle-info',
      text: this.ruleText(rule),
    }))
  );

  private ruleText(rule: FieldRule): string {
    if (rule.key === 'sector') {
      const choices = rule.options?.length ? rule.options : this.sectorChoices;
      return `${rule.label}, ${choices.join(' or ')}`;
    }
    if (rule.type === 'text' && rule.maxLength !== null) return `${rule.label}, up to ${rule.maxLength} characters`;
    if (rule.type === 'number' && (rule.min !== null || rule.max !== null)) return this.rangeText(rule, false);
    const what = rule.type === 'date' ? `${rule.label} date` : rule.label;
    return `${what} is ${rule.required ? 'required' : 'optional'}`;
  }

  // Database state from GET /health, drives the status pill and the loading/error states
  dbState = signal<DbHealth['state'] | 'offline'>('starting');
  dbMessage = signal('');
  historyHealth = signal<DbHealth['history']>(undefined);
  private historyTimer?: ReturnType<typeof setTimeout>;
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.checkHealth();
    this.destroyRef.onDestroy(() => { this.left = true; clearTimeout(this.historyTimer); });
  }
  private left = false;

  // History comes up after the main database, so keep asking until it's there and the pill clears by itself
  private watchHistory() {
    if (this.left || this.historyHealth()?.ready !== false) return;
    this.historyTimer = setTimeout(() => this.api.health().subscribe({
      next: health => { this.historyHealth.set(health.history); this.watchHistory(); },
      error: () => this.watchHistory(),
    }), 5000);
  }

  // Wait for the API's auto migration to finish before loading rows
  private checkHealth() {
    this.api.health().subscribe({
      next: health => {
        this.dbState.set(health.state);
        this.dbMessage.set(health.message);
        this.historyHealth.set(health.history);
        if (health.state === 'ready') {
          this.loadRules();
          this.loadIndustries();
          this.loadWaiting();
          this.watchHistory();
        }
        else if (health.state === 'failed') {
          this.error.set(health.message);
          this.loading.set(false);
        }
        // Still starting or migrating, ask again in 2s
        else setTimeout(() => this.checkHealth(), 2000);
      },
      error: () => {
        this.dbState.set('offline');
        this.error.set('Could not load the industries. Check if the API is running');
        this.loading.set(false);
      },
    });
  }

  // GET all basically the same function that shows the db content also does the GET
  loadIndustries(): void {
    this.api.getAll().subscribe({
      next: data => {
        this.industries.set(data);
        this.loading.set(false);
    },
    error: () => {
      // Before deleting take place this pop up will confirm if you really want it off
      this.error.set('Could not load the industries. Check if the API is running');
      this.loading.set(false);
    },
  });
  }
  // Delete by id 
  // The row that is asking "Delete this row?", and the one being deleted
  confirmingId = signal<number | null>(null);
  deletingId = signal<number | null>(null);

  remove(id: number){
    this.deletingId.set(id);
    this.api.delete(id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.confirmingId.set(null);
        this.industries.update(list => list.filter(i => i.id !== id));
        if (this.editingId() === id) this.cancelEdit();
      },
      // Delete logic if id found
      error: err => {
        this.deletingId.set(null);
        this.confirmingId.set(null);
        this.formError.set(this.errorMessage(err));
      },
    });
  }
  // Edit button logic
    edit(item: Industry) {
      this.editingId.set(item.id);
      this.formError.set('');
      this.form.setValue({
        name: item.name,
        sector: item.sector ?? '',
        price: item.price,
        release: item.release,
      });
      const extra: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.extra ?? {})) extra[key] = value === null ? '' : String(value);
      this.extraValues.set(extra);
      this.extraTouched.set(new Set());
      // Bring the form into view so long tables don't hide it
      document.getElementById('add')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
// Cancel button logic
    cancelEdit() {
      this.editingId.set(null);
      this.form.reset({ sector: '' });
      this.extraValues.set({});
      this.extraTouched.set(new Set());
    }

  search = signal ('');

  // Column filters above the table
  sectorFilter = signal('');
  minPrice = signal<number | null>(null);
  maxPrice = signal<number | null>(null);

  filtered = computed(() =>
  this.industries().filter(i => i.name.toLowerCase()
  .includes(this.search().toLowerCase()))
  .filter(i => !this.sectorFilter() || i.sector === this.sectorFilter())
  .filter(i => this.minPrice() === null || (i.price ?? -Infinity) >= this.minPrice()!)
  .filter(i => this.maxPrice() === null || (i.price ?? Infinity) <= this.maxPrice()!))

  sectors = computed(() =>
    [...new Set(this.industries().map(i => i.sector).filter((s): s is string => !!s))].sort());

  hasFilters = computed(() =>
    !!this.search() || !!this.sectorFilter() || this.minPrice() !== null || this.maxPrice() !== null);

  // Number inputs give '' when empty, keep that as "no limit"
  toNumber(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  clearFilters() {
    this.search.set('');
    this.sectorFilter.set('');
    this.minPrice.set(null);
    this.maxPrice.set(null);
    this.page.set(1);
  }

  // Sorting, click a header to sort, click again to flip. Labels follow the rules, custom fields get their own column.
  columns = computed(() => {
    const label = (key: string, fallback: string) => this.rules()?.fields.find(f => f.key === key)?.label ?? fallback;
    const cols: { key: string; label: string; align?: 'num'; custom?: FieldRule }[] = [
      { key: 'id', label: 'ID' },
      { key: 'name', label: label('name', 'Name') },
      { key: 'sector', label: label('sector', 'Sector') },
      { key: 'release', label: label('release', 'Release') },
      { key: 'price', label: label('price', 'Price'), align: 'num' },
    ];
    for (const f of this.customFields()) {
      cols.push({ key: 'extra:' + f.key, label: f.label, align: f.type === 'number' ? 'num' : undefined, custom: f });
    }
    return cols;
  });

  // The value behind a column, custom ones live in extra
  cell(item: Industry, key: string): string | number | null {
    if (key.startsWith('extra:')) {
      const value = own(item.extra, key.slice(6));
      return value == null ? null : value as string | number;
    }
    return item[key as keyof Industry] as string | number | null;
  }

  sortKey = signal<string>('id');
  sortDir = signal<1 | -1>(1);

  sortBy(key: string) {
    if (this.sortKey() === key) this.sortDir.update(d => (d === 1 ? -1 : 1));
    else { this.sortKey.set(key); this.sortDir.set(1); }
  }

  sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    // Empty values always sink to the bottom
    return [...this.filtered()].sort((a, b) => {
      const x = this.cell(a, key), y = this.cell(b, key);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
  });

  // Paging, "Show N entries"
  pageSize = signal(10);
  page = signal(1);
  pageCount = computed(() => Math.max(1, Math.ceil(this.sorted().length / this.pageSize())));
  currentPage = computed(() => Math.min(this.page(), this.pageCount()));
  paged = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.sorted().slice(start, start + this.pageSize());
  });
  rangeStart = computed(() => (this.sorted().length ? (this.currentPage() - 1) * this.pageSize() + 1 : 0));
  rangeEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.sorted().length));

  // Export what's on screen after filters and sorting
  exportCsv() {
    const guard = (v: unknown) => {
      if (typeof v === 'number') return v;
      const text = v == null ? '' : String(v);
      return text.length > 0 && '=+-@\t\r'.includes(text[0]) ? `'${text}` : text;
    };
    const escape = (v: unknown) => `"${String(guard(v) ?? '').replace(/"/g, '""')}"`;
    const custom = this.customFields();
    const rows = [['ID', 'Name', 'Sector', 'Price', 'Release', ...custom.map(f => f.label)],
      ...this.sorted().map(i => [i.id, i.name, i.sector, i.price, i.release, ...custom.map(f => own(i.extra, f.key) ?? '')])];
    const csv = rows.map(r => r.map(escape).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'industries.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  extraOf(item: Industry, key: string): unknown {
    return own(item.extra, key);
  }

  print() {
    window.print();
  }

  // Date picker for the release field, the form value stays as 'YYYY-MM-DD'
  readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  calendarOpen = signal(false);
  calendarMonth = signal(this.firstOfMonth(new Date()));
  releaseValue = signal<string | null>(null);

  constructor() {
    this.form.controls.release.valueChanges.subscribe(v => this.releaseValue.set(v || null));
  }

  private firstOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  private toIso(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Parse as a local date so the day never shifts with the timezone
  private fromIso(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  formatDate(iso: string | null): string {
    if (!iso) return '';
    return this.fromIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  calendarTitle = computed(() =>
    this.calendarMonth().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

  calendarDays = computed(() => {
    const month = this.calendarMonth();
    // Weeks start on Monday
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    const today = this.toIso(new Date());
    const selected = this.releaseValue();
    return Array.from({ length: 42 }, (_, n) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
      const iso = this.toIso(d);
      return { iso, day: d.getDate(), inMonth: d.getMonth() === month.getMonth(),
        isToday: iso === today, isSelected: iso === selected };
    });
  });

  toggleCalendar() {
    const current = this.releaseValue();
    if (!this.calendarOpen()) this.calendarMonth.set(this.firstOfMonth(current ? this.fromIso(current) : new Date()));
    this.calendarOpen.update(open => !open);
  }

  moveMonth(step: number) {
    this.calendarMonth.update(m => new Date(m.getFullYear(), m.getMonth() + step, 1));
  }

  pickDate(iso: string | null) {
    this.form.controls.release.setValue(iso ?? '');
    this.form.controls.release.markAsDirty();
    this.calendarOpen.set(false);
  }

  pickToday() {
    this.pickDate(this.toIso(new Date()));
  }

  // Close the picker on outside click or Escape
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.calendarOpen() && !(event.target as HTMLElement).closest('.datepicker')) this.calendarOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.calendarOpen.set(false);
  }

  // Warning triangles. Red: a value couldn't come over from old data. Black: minor, like a similar row
  // or a value that breaks today's rules. A row shows one triangle in its worst color, hover lists them all.
  flags = computed(() => {
    const fields = (this.rules()?.fields ?? []).filter(f => !f.hidden);
    const labelOf = (key: string) => this.rules()?.fields.find(f => f.key === key)?.label ?? key;
    const map = new Map<number, { level: 'red' | 'black'; text: string }>();
    for (const item of this.industries()) {
      const red = (item.lostFields ?? []).map(k => `${labelOf(k)} couldn't be brought over from the old data`);
      const black: string[] = [];
      if (item.duplicateOf !== null) black.push(`A similar row exists in this table in row #${item.duplicateOf}`);
      for (const rule of fields) {
        if ((item.lostFields ?? []).includes(rule.key)) continue;
        const value = rule.custom ? own(item.extra, rule.key) : item[rule.key as keyof Industry];
        const problem = this.checkValue(rule, value);
        if (problem) black.push(problem);
      }
      if (red.length || black.length) {
        map.set(item.id, { level: red.length ? 'red' : 'black', text: [...red, ...black].join('\n') });
      }
    }
    return map;
  });

  // Fields with an open request get a "waiting for a developer" marker on their column header
  waitingFields = signal(new Set<string>());

  private loadWaiting() {
    // The list of requests is for people who are signed in
    if (!this.auth.isSignedIn()) return;
    this.api.requests('open').subscribe({
      next: list => this.waitingFields.set(new Set(list.map(r => r.fieldKey).filter((k): k is string => !!k))),
      error: () => {},
    });
  }

  isWaiting(columnKey: string): boolean {
    const key = columnKey.startsWith('extra:') ? columnKey.slice(6) : columnKey;
    return this.waitingFields().has(key);
  }

  // Numbers for the stat cards
  sectorCount = computed(() =>
    new Set(this.industries().map(i => i.sector).filter(Boolean)).size);

  averagePrice = computed(() => {
    const prices = this.industries()
      .map(i => i.price)
      .filter((p): p is number => p !== null);
    if (prices.length === 0) return '—';
    return (prices.reduce((sum, p) => sum + p, 0) / prices.length).toFixed(2);
  });
}
