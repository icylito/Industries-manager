import { ConfirmPopup } from '../confirm-popup/confirm-popup';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ColumnInput, FieldRule, TableRow, UserTable } from '../../../domain/models/industry';
import { errorText } from '../../../infrastructure/industry-api';
import { TablesApi } from '../../../infrastructure/tables-api';
import { Auth } from '../../../application/auth';
import { Toast } from '../../../application/toast';

type ColumnType = 'text' | 'number' | 'date';

// One column while it is being written. uid keeps the row steady while typing; key is set for a column that exists.
interface DraftColumn {
  uid: number;
  key: string | null;
  label: string;
  type: ColumnType;
  required: boolean;
  maxLength: number | null;
  min: number | null;
  max: number | null;
  // The dropdown options, one per line, for a text column. Empty means any text.
  choices: string;
}

// The limits the API keeps, shown on the page so nobody finds them by hitting them
export const TABLE_LIMITS = { tables: 50, columns: 20, rows: 100_000 } as const;

let nextUid = 1;

// Tables that managers and admins make, fill and delete, with no developer and no database change.
// /tables lists them, /tables/:id opens one. Everyone signed in can look; only managers and admins see the buttons.
@Component({
  imports: [RouterLink, ConfirmPopup],
  selector: 'app-tables',
  styleUrls: [
    '../my-components/my-components.css',
    '../history/history.css',
    '../fields/fields.css',
    './tables.css',
  ],
  templateUrl: './tables.html',
})
export class TablesPage {
  private api = inject(TablesApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(Toast);
  auth = inject(Auth);

  readonly limits = TABLE_LIMITS;
  readonly types: { value: ColumnType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
  ];

  // The list
  tables = signal<UserTable[]>([]);
  loading = signal(true);
  error = signal('');
  bin = signal<UserTable[]>([]);
  binOpen = signal(false);

  // One open table
  tableId = signal<number | null>(null);
  table = computed(() => this.tables().find((t) => t.id === this.tableId()) ?? null);
  columns = computed<FieldRule[]>(() => (this.table()?.columns ?? []).filter((c) => !c.hidden));
  rows = signal<TableRow[]>([]);
  total = signal(0);
  rowsLoading = signal(false);
  rowsError = signal('');
  search = signal('');
  sortKey = signal('');
  sortDir = signal<'asc' | 'desc'>('asc');
  page = signal(1);
  readonly pageSize = 25;
  pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));

  // Making a table, or changing one's name and columns
  editor = signal<'new' | 'edit' | null>(null);
  draftName = signal('');
  draftColumns = signal<DraftColumn[]>([]);
  editorBusy = signal(false);
  editorError = signal('');

  // Adding or changing a row
  rowFormOpen = signal(false);
  editingRow = signal<TableRow | null>(null);
  rowValues = signal<Record<string, string>>({});
  rowErrors = signal<Record<string, string>>({});
  rowBusy = signal(false);
  rowError = signal('');
  confirmingRowId = signal<number | null>(null);

  // Deleting a table: the name has to be typed, so it can't happen by accident
  deleting = signal(false);
  deleteTyped = signal('');
  deleteBusy = signal(false);

  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      const id = Number(params.get('id'));
      this.tableId.set(Number.isInteger(id) && id > 0 ? id : null);
      this.resetTableView();
      this.loadList();
    });
  }

  // ---- the list and the bin ----

  loadList() {
    this.api.list().subscribe({
      next: (list) => {
        this.tables.set(list);
        this.loading.set(false);
        this.error.set('');
        if (this.tableId() !== null) {
          if (this.table()) this.loadRows();
          else this.error.set("That table isn't there any more. It may have been deleted.");
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(errorText(err, "Couldn't load the tables"));
      },
    });
  }

  toggleBin() {
    const open = !this.binOpen();
    this.binOpen.set(open);
    if (open) this.loadBin();
  }

  private loadBin() {
    this.api.bin().subscribe({
      next: (list) => this.bin.set(list),
      error: (err: HttpErrorResponse) => this.toast.say(errorText(err, "Couldn't load the bin")),
    });
  }

  bringBack(t: UserTable) {
    this.api.bringBack(t.id).subscribe({
      next: () => {
        this.toast.say(`${t.name} is back`);
        this.loadBin();
        this.loadList();
      },
      error: (err: HttpErrorResponse) => this.toast.say(errorText(err)),
    });
  }

  daysLeft(t: UserTable): number {
    if (!t.deletedAt) return 0;
    const gone = Date.parse(t.deletedAt) + 14 * 86_400_000;
    return Math.max(0, Math.ceil((gone - Date.now()) / 86_400_000));
  }

  // ---- rows ----

  private resetTableView() {
    this.rows.set([]);
    this.total.set(0);
    this.search.set('');
    this.sortKey.set('');
    this.sortDir.set('asc');
    this.page.set(1);
    this.closeRowForm();
    this.editor.set(null);
    this.deleting.set(false);
  }

  loadRows() {
    const id = this.tableId();
    if (id === null) return;
    this.rowsLoading.set(true);
    this.api
      .rows(id, {
        q: this.search().trim(),
        sort: this.sortKey(),
        dir: this.sortDir(),
        page: this.page(),
        size: this.pageSize,
      })
      .subscribe({
        next: (page) => {
          this.rows.set(page.rows);
          this.total.set(page.total);
          this.rowsLoading.set(false);
          this.rowsError.set('');
        },
        error: (err: HttpErrorResponse) => {
          this.rowsLoading.set(false);
          this.rowsError.set(errorText(err, "Couldn't load the rows"));
        },
      });
  }

  searchFor(text: string) {
    this.search.set(text);
    this.page.set(1);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadRows(), 300);
  }

  sortBy(key: string) {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
    this.page.set(1);
    this.loadRows();
  }

  goToPage(n: number) {
    this.page.set(Math.min(Math.max(1, n), this.pageCount()));
    this.loadRows();
  }

  show(row: TableRow, column: FieldRule): string {
    const value = row.data[column.key];
    if (value === null || value === undefined || value === '') return '--';
    if (column.type === 'date' && typeof value === 'string') {
      const date = new Date(value + 'T00:00:00');
      return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // 120,000 rather than 120000, the same as the counts on Browse
    if (column.type === 'number' && typeof value === 'number')
      return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return String(value);
  }

  count(n: number): string {
    return n.toLocaleString('en-US');
  }

  openRowForm(row: TableRow | null) {
    this.editingRow.set(row);
    const values: Record<string, string> = {};
    for (const c of this.columns()) {
      const v = row?.data[c.key];
      values[c.key] = v === null || v === undefined ? '' : String(v);
    }
    this.rowValues.set(values);
    this.rowErrors.set({});
    this.rowError.set('');
    this.rowFormOpen.set(true);
  }

  closeRowForm() {
    this.rowFormOpen.set(false);
    this.editingRow.set(null);
    this.rowErrors.set({});
    this.rowError.set('');
  }

  setValue(key: string, value: string) {
    this.rowValues.update((v) => ({ ...v, [key]: value }));
    if (this.rowErrors()[key])
      this.rowErrors.update((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
  }

  saveRow() {
    const id = this.tableId();
    if (id === null || this.rowBusy()) return;
    // Numbers go as numbers and empty boxes as nothing, the API checks the rest and says what is wrong
    const values: Record<string, unknown> = {};
    for (const c of this.columns()) {
      const text = (this.rowValues()[c.key] ?? '').trim();
      values[c.key] =
        text === ''
          ? null
          : c.type === 'number' && !Number.isNaN(Number(text))
            ? Number(text)
            : text;
    }
    const editing = this.editingRow();
    this.rowBusy.set(true);
    const call = editing
      ? this.api.updateRow(id, editing.id, values, editing.updatedAt)
      : this.api.addRow(id, values);
    call.subscribe({
      next: () => {
        this.rowBusy.set(false);
        this.toast.say(editing ? 'Row saved' : 'Row added');
        this.closeRowForm();
        this.loadRows();
        this.refreshTable();
      },
      error: (err: HttpErrorResponse) => {
        this.rowBusy.set(false);
        const fields = err.error?.errors as Record<string, string[]> | undefined;
        if (err.status === 400 && fields) {
          this.rowErrors.set(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]])));
          this.rowError.set('Some values need a look, see the boxes marked below.');
        } else {
          this.rowError.set(errorText(err, "Couldn't save the row"));
        }
      },
    });
  }

  deleteRowById(id: number) {
    const row = this.rows().find((r) => r.id === id);
    if (row) this.deleteRow(row);
  }

  deleteRow(row: TableRow) {
    const id = this.tableId();
    if (id === null) return;
    this.api.deleteRow(id, row.id).subscribe({
      next: () => {
        this.confirmingRowId.set(null);
        this.toast.say('Row deleted');
        this.loadRows();
        this.refreshTable();
      },
      error: (err: HttpErrorResponse) => {
        this.confirmingRowId.set(null);
        this.toast.say(errorText(err));
      },
    });
  }

  exportCsv() {
    const t = this.table();
    if (!t) return;
    this.api
      .exportCsv(t.id, `${t.name}.csv`)
      .subscribe({ error: (err: HttpErrorResponse) => this.toast.say(errorText(err)) });
  }

  // Row counts and the version move with every change, so the open table is read again quietly
  private refreshTable() {
    const id = this.tableId();
    if (id === null) return;
    this.api
      .get(id)
      .subscribe({
        next: (t) => this.tables.update((list) => list.map((x) => (x.id === t.id ? t : x))),
      });
  }

  // ---- making and changing tables ----

  // Cancel, the X, the dimmed page behind and Escape all close the pop up, but never while a save is running
  closeEditor() {
    if (!this.editorBusy()) this.editor.set(null);
  }

  // The row menu, the same one every table uses. Fixed to the window so a table's scrolling box can't cut it off.
  menuKey = signal<string | number | null>(null);
  menuAt = signal({ top: 0, right: 0 });

  toggleMenu(key: string | number, e: Event) {
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const room = 110;
    const top =
      box.bottom + 4 + room > window.innerHeight ? Math.max(8, box.top - 4 - room) : box.bottom + 4;
    this.menuAt.set({ top, right: window.innerWidth - box.right });
    this.menuKey.update((current) => (current === key ? null : key));
  }

  @HostListener('document:click')
  @HostListener('window:scroll')
  @HostListener('window:resize')
  closeMenu() {
    this.menuKey.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.editor()) this.closeEditor();
  }

  startNew() {
    this.draftName.set('');
    this.draftColumns.set([this.blankColumn()]);
    this.editorError.set('');
    this.confirmRemove.set(null);
    this.editor.set('new');
    // The table name is the first thing to type, so the cursor is already in it
    setTimeout(() =>
      document.querySelector<HTMLInputElement>('#table-editor .table-name input')?.focus(),
    );
  }

  startEdit() {
    const t = this.table();
    if (!t) return;
    this.draftName.set(t.name);
    this.draftColumns.set(
      this.columns().map((c) => ({
        uid: nextUid++,
        key: c.key,
        label: c.label,
        type: c.type,
        required: c.required,
        maxLength: c.maxLength,
        min: c.min,
        max: c.max,
        choices: (c.options ?? []).join('\n'),
      })),
    );
    this.editorError.set('');
    this.confirmRemove.set(null);
    this.editor.set('edit');
    this.closeRowForm();
  }

  private blankColumn(): DraftColumn {
    return {
      uid: nextUid++,
      key: null,
      label: '',
      type: 'text',
      required: false,
      maxLength: null,
      min: null,
      max: null,
      choices: '',
    };
  }

  // The column whose Remove is waiting for its second press, so one slip of the mouse never drops a column
  confirmRemove = signal<number | null>(null);

  addColumn() {
    if (this.draftColumns().length >= this.limits.columns) return;
    this.draftColumns.update((list) => [...list, this.blankColumn()]);
    // Bring the new column into view and put the cursor in its name, so a run of columns can be typed without the mouse
    setTimeout(() => {
      const rows = document.querySelectorAll<HTMLElement>('#table-editor .column-row');
      const last = rows[rows.length - 1];
      last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      last?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  }

  removeColumn(uid: number) {
    this.confirmRemove.set(null);
    this.draftColumns.update((list) => list.filter((c) => c.uid !== uid));
  }

  moveColumn(uid: number, by: -1 | 1) {
    this.draftColumns.update((list) => {
      const i = list.findIndex((c) => c.uid === uid);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  patchColumn(uid: number, change: Partial<DraftColumn>) {
    this.draftColumns.update((list) =>
      list.map((c) => {
        if (c.uid !== uid) return c;
        const next = { ...c, ...change };
        // Limits that don't belong to the new type go, so the API isn't sent a max length on a number
        if (change.type) {
          if (next.type !== 'text') {
            next.maxLength = null;
            next.choices = '';
          }
          if (next.type !== 'number') {
            next.min = null;
            next.max = null;
          }
        }
        return next;
      }),
    );
  }

  num(text: string): number | null {
    const n = Number(text);
    return text.trim() === '' || Number.isNaN(n) ? null : n;
  }

  // A column that existed before and is left out now is hidden by the API, with its values kept
  removedColumns = computed(() => {
    if (this.editor() !== 'edit') return [];
    const kept = new Set(
      this.draftColumns()
        .map((c) => c.key)
        .filter(Boolean),
    );
    return this.columns().filter((c) => !kept.has(c.key));
  });

  removedLabels = computed(() =>
    this.removedColumns()
      .map((c) => c.label)
      .join(', '),
  );

  // Columns removed earlier, kept with their values. Bringing one back keeps its key, so its values return with it.
  hiddenColumns = computed(() => {
    if (this.editor() !== 'edit') return [];
    const inDraft = new Set(
      this.draftColumns()
        .map((c) => c.key)
        .filter(Boolean),
    );
    return (this.table()?.columns ?? []).filter((c) => c.hidden && !inDraft.has(c.key));
  });

  bringBackColumn(c: FieldRule) {
    if (this.draftColumns().length >= this.limits.columns) return;
    this.draftColumns.update((list) => [
      ...list,
      {
        uid: nextUid++,
        key: c.key,
        label: c.label,
        type: c.type,
        required: c.required,
        maxLength: c.maxLength,
        min: c.min,
        max: c.max,
        choices: (c.options ?? []).join('\n'),
      },
    ]);
  }

  columnCount(t: UserTable): number {
    return t.columns.filter((c) => !c.hidden).length;
  }

  saveTable() {
    if (this.editorBusy()) return;
    const name = this.draftName().trim();
    if (!name) {
      this.editorError.set('Give the table a name');
      return;
    }
    if (this.draftColumns().some((c) => !c.label.trim())) {
      this.editorError.set('Every column needs a name');
      return;
    }
    const columns: ColumnInput[] = this.draftColumns().map((c) => ({
      key: c.key,
      label: c.label.trim(),
      type: c.type,
      required: c.required,
      maxLength: c.type === 'text' ? c.maxLength : null,
      min: c.type === 'number' ? c.min : null,
      max: c.type === 'number' ? c.max : null,
      options:
        c.type === 'text'
          ? c.choices
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean)
          : null,
    }));

    this.editorBusy.set(true);
    this.editorError.set('');
    const t = this.table();
    const editing = this.editor() === 'edit' && !!t;
    const call =
      editing && t
        ? this.api.update(t.id, t.version, { name, columns })
        : this.api.create(name, columns);
    call.subscribe({
      next: (saved) => {
        this.editorBusy.set(false);
        this.editor.set(null);
        this.toast.say(editing ? 'Table saved' : `${saved.name} is ready`);
        this.tables.update((list) =>
          [...list.filter((x) => x.id !== saved.id), saved].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
        if (this.tableId() === saved.id) {
          this.loadRows();
        } else {
          void this.router.navigate(['/tables', saved.id]);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.editorBusy.set(false);
        this.editorError.set(this.columnProblems(err));
      },
    });
  }

  // "columns[2]: ..." from the API becomes "Column 3 (Score): ..."
  private columnProblems(err: HttpErrorResponse): string {
    const fields = err.error?.errors as Record<string, string[]> | undefined;
    if (err.status !== 400 || !fields) return errorText(err, "Couldn't save the table");
    return Object.entries(fields)
      .map(([key, problems]) => {
        const m = /^columns\[(\d+)\]$/.exec(key);
        if (!m) return problems.join(' ');
        const column = this.draftColumns()[Number(m[1])];
        return `Column ${Number(m[1]) + 1}${column?.label ? ` (${column.label})` : ''}: ${problems.join(' ')}`;
      })
      .join(' ');
  }

  // ---- deleting a table ----

  confirmDelete() {
    const t = this.table();
    if (!t || this.deleteTyped().trim().toLowerCase() !== t.name.trim().toLowerCase()) return;
    this.deleteBusy.set(true);
    this.api.delete(t.id).subscribe({
      next: () => {
        this.deleteBusy.set(false);
        this.toast.say(`${t.name} is in the bin for 14 days`);
        void this.router.navigate(['/tables']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleteBusy.set(false);
        this.toast.say(errorText(err));
      },
    });
  }

  typedMatches = computed(() => {
    const t = this.table();
    return !!t && this.deleteTyped().trim().toLowerCase() === t.name.trim().toLowerCase();
  });
}
