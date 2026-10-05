import { Component, signal, computed, inject, OnInit, HostListener } from '@angular/core';
import { Industry, CreateIndustry, DbHealth } from '../../models/industry';
import { IndustryApi } from '../../services/industry-api';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  imports: [ReactiveFormsModule],
  selector: 'app-my-components',
  styleUrl: './my-components.css',
  templateUrl: './my-components.html',
})

export class MyComponents implements OnInit { 
  private api = inject(IndustryApi);
  private fb = inject(FormBuilder);

  // General Table logic 

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(50)]],
    sector: ['', [Validators.required, Validators.maxLength(25)]],
    price: [null as number | null, [Validators.min(0), Validators.max(10)]],
    release: [''],
  })
// signals for error, saving, editingId, formError
  industries = signal<Industry[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  editingId = signal<number | null>(null);
  formError = signal('');

   submit() {
    if (this.form.invalid) return;

    // Table logic and enforcements
    const verify = this.form.getRawValue();
    const body: CreateIndustry = {
      name: verify.name ?? '',
      sector: verify.sector ?? '',
      price: verify.price,
      release: verify.release || null,
    };

    this.saving.set(true);
    this.formError.set('');

    const id = this.editingId();

    // Create/ POST logic
    if (id === null) {
      this.api.create(body).subscribe({
        next: created => {
          this.industries.update(list => [...list, created]);
          this.form.reset();
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
          this.industries.update(list =>
            list.map(i => (i.id === id ? { ...i, ...body } : i))
          );
          this.cancelEdit();
          this.saving.set(false);
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

  /* Field validation to enforce the table requirements its following api_v2/Dtos folder 
  logic if you ever change the logic for this change the logic in Dtos/ too */
  fieldErrors(): string[] {
    const c = this.form.controls;
    const list: string[] = [];
    if (c.name.errors?. ['maxlength']) list.push('Name can be at most 50 characters');
    if (c.sector.errors?.['maxlength']) list.push('Sector can be at most 25 characters');
    if (c.price.errors?. ['min'] || c.price.errors?. ['max']) list.push('price can be only 0 to 10');
    return list;
  }

  // Database state from GET /health, drives the status pill and the loading/error states
  dbState = signal<DbHealth['state'] | 'offline'>('starting');
  dbMessage = signal('');

  ngOnInit(): void {
    this.checkHealth();
  }

  // Wait for the API's auto migration to finish before loading rows
  private checkHealth() {
    this.api.health().subscribe({
      next: health => {
        this.dbState.set(health.state);
        this.dbMessage.set(health.message);
        if (health.state === 'ready') this.loadIndustries();
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
  remove(id: number){
    // Delete logic if id don't exist
    if (!confirm('Are you sure you want to delete this industry?'))return;
    this.api.delete(id).subscribe({
      next: () => {
        this.industries.update(list => list.filter(i => i.id !== id));
        if (this.editingId() === id) this.cancelEdit();
      },
      // Delete logic if id found
      error: err => this.formError.set(this.errorMessage(err)),   
    });
  }
  // Edit button logic
    edit(item: Industry) {
      this.editingId.set(item.id);
      this.formError.set('');
      this.form.setValue({
        name: item.name,
        sector: item.sector,
        price: item.price,
        release: item.release,
      });
      // Bring the form into view so long tables don't hide it
      document.getElementById('add')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
// Cancel button logic
    cancelEdit() {
      this.editingId.set(null);
      this.form.reset();
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

  // Sorting, click a header to sort, click again to flip
  readonly columns: { key: keyof Industry; label: string; align?: 'num' }[] = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'sector', label: 'Sector' },
    { key: 'release', label: 'Release' },
    { key: 'price', label: 'Price', align: 'num' },
  ];

  sortKey = signal<keyof Industry>('id');
  sortDir = signal<1 | -1>(1);

  sortBy(key: keyof Industry) {
    if (this.sortKey() === key) this.sortDir.update(d => (d === 1 ? -1 : 1));
    else { this.sortKey.set(key); this.sortDir.set(1); }
  }

  sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    // Empty values always sink to the bottom
    return [...this.filtered()].sort((a, b) => {
      const x = a[key], y = b[key];
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
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['ID', 'Name', 'Sector', 'Price', 'Release'],
      ...this.sorted().map(i => [i.id, i.name, i.sector, i.price, i.release])];
    const csv = rows.map(r => r.map(escape).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'industries.csv';
    link.click();
    URL.revokeObjectURL(link.href);
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
