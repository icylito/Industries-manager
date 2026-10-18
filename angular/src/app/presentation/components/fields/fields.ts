import { ConfirmPopup } from '../confirm-popup/confirm-popup';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { hasNoLetters, sameName } from '../../../domain/name-key';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FieldRule, RuleSet } from '../../../domain/models/industry';
import { IndustryApi } from '../../../infrastructure/industry-api';
import { errorText } from '../../../application/http-text';

type FieldType = 'text' | 'number' | 'date';

@Component({
  imports: [RouterLink, ConfirmPopup],
  selector: 'app-fields',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './fields.css'],
  templateUrl: './fields.html',
})
export class FieldsPage implements OnInit {
  private api = inject(IndustryApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // Which part of the page shows, kept in the address (?tab=) like History, so a reload lands on the same one
  tab = signal<'fields' | 'history'>(this.startTab());

  private startTab(): 'fields' | 'history' {
    return this.route.snapshot.queryParamMap.get('tab') === 'history' ? 'history' : 'fields';
  }

  setTab(tab: 'fields' | 'history') {
    this.menuKey.set(null);
    this.tab.set(tab);
    this.router.navigate([], {
      queryParams: { tab: tab === 'fields' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  rules = signal<RuleSet | null>(null);
  // An editable copy of the fields, saved together as the next rules version
  draft = signal<FieldRule[]>([]);
  note = signal('');
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveMsg = signal('');
  saveError = signal('');
  versions = signal<RuleSet[]>([]);
  waiting = signal(new Set<string>());

  readonly types: { value: FieldType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
  ];

  ngOnInit() {
    this.load();
  }

  private load() {
    this.api.schema().subscribe({
      next: (r) => {
        this.setRules(r);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(errorText(err, 'Could not load the fields'));
        this.loading.set(false);
      },
    });
    this.loadVersions();
    this.loadWaiting();
  }

  // keepEdits leaves unsaved label and limit changes in place for fields that are still there
  private setRules(r: RuleSet, keepEdits = false) {
    const edited = this.draft();
    const previous = this.rules()?.fields ?? [];
    this.rules.set(r);
    this.draft.set(
      r.fields.map((f) => {
        if (!keepEdits) return { ...f };
        const was = edited.find((p) => p.key === f.key);
        const original = previous.find((p) => p.key === f.key);
        if (!was || !original) return { ...f };
        const kept: FieldRule = { ...f };
        for (const key of ['label', 'required', 'maxLength', 'min', 'max', 'hidden'] as const) {
          if (was[key] !== original[key]) kept[key] = was[key] as never;
        }
        return kept;
      }),
    );
  }

  private loadVersions() {
    this.api.ruleVersions().subscribe({ next: (v) => this.versions.set(v), error: () => {} });
  }

  private loadWaiting() {
    this.api.requests('active').subscribe({
      next: (list) =>
        this.waiting.set(new Set(list.map((r) => r.fieldKey).filter((k): k is string => !!k))),
      error: () => {},
    });
  }

  dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.rules()?.fields ?? []),
  );

  update(key: string, change: Partial<FieldRule>) {
    this.draft.update((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));
    this.saveMsg.set('');
    this.saveError.set('');
  }

  num(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  typeLabel(type: string): string {
    return this.types.find((t) => t.value === type)?.label ?? type;
  }

  // The table is read only. A change to a field is made in the edit pop up, then it still waits for Save like before.
  editing = signal<FieldRule | null>(null);
  editLabel = signal('');
  editRequired = signal(false);
  editMaxLength = signal<number | null>(null);
  editMin = signal<number | null>(null);
  editMax = signal<number | null>(null);
  editError = signal('');

  startEdit(f: FieldRule) {
    this.editing.set(f);
    this.editLabel.set(f.label);
    this.editRequired.set(f.required);
    this.editMaxLength.set(f.maxLength ?? null);
    this.editMin.set(f.min ?? null);
    this.editMax.set(f.max ?? null);
    this.editError.set('');
    this.askingType.set(null);
    this.askError.set('');
  }

  closeEdit() {
    this.editing.set(null);
    this.askingType.set(null);
  }

  // The row menu, the same one every table uses. Fixed to the window so a table's scrolling box can't cut it off.
  menuKey = signal<string | number | null>(null);
  menuAt = signal({ top: 0, right: 0 });

  toggleMenu(key: string | number, e: Event) {
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const room = 150;
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
    if (this.editing() && !this.deleting()) this.closeEdit();
  }

  applyEdit() {
    const f = this.editing();
    if (!f) return;
    const label = this.editLabel().trim();
    if (!label || label.length > 40)
      return this.editError.set('The label has to be 1 to 40 characters');
    if (this.hasHidden(label))
      return this.editError.set("The label can't contain line breaks or hidden characters");
    if (hasNoLetters(label)) return this.editError.set('A name needs at least one letter or digit');
    if (this.draft().some((other) => other.key !== f.key && sameName(other.label, label))) {
      return this.editError.set('A field with that label already exists');
    }
    const maxLength = f.type === 'text' ? this.editMaxLength() : null;
    const min = f.type === 'number' ? this.editMin() : null;
    const max = f.type === 'number' ? this.editMax() : null;
    if (maxLength !== null && (maxLength < 1 || maxLength > 1000))
      return this.editError.set('The longest has to be 1 to 1000');
    if (min !== null && max !== null && min > max)
      return this.editError.set("Lowest can't be above highest");
    const change: Partial<FieldRule> = {
      label,
      required: f.key === 'name' ? true : this.editRequired(),
    };
    if (f.type === 'text') change.maxLength = maxLength;
    if (f.type === 'number') {
      change.min = min;
      change.max = max;
    }
    this.update(f.key, change);
    this.closeEdit();
  }

  // The limits as one plain phrase, for the read only table
  limitText(f: FieldRule): string {
    if (f.type === 'text') return f.maxLength != null ? `${f.maxLength} characters` : 'No limit';
    if (f.type === 'number') {
      if (f.min != null && f.max != null) return `${f.min} to ${f.max}`;
      if (f.min != null) return `From ${f.min}`;
      if (f.max != null) return `Up to ${f.max}`;
      return 'No limit';
    }
    return 'No limits';
  }

  discard() {
    const r = this.rules();
    if (r) this.setRules(r);
    this.note.set('');
    this.saveError.set('');
  }

  save() {
    this.saving.set(true);
    this.saveMsg.set('');
    this.saveError.set('');
    this.api.saveRules(this.draft(), this.note() || null, this.rules()!.version).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.setRules(r);
        this.note.set('');
        this.saveMsg.set(
          `Saved as rules version ${r.version}. A copy of the table was saved first.`,
        );
        this.loadVersions();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.saveError.set(errorText(err));
      },
    });
  }

  deleting = signal<FieldRule | null>(null);
  deleteBusy = signal(false);
  deleteMsg = signal('');
  deleteError = signal('');

  startDelete(field: FieldRule) {
    if (this.deleteBusy()) return;
    this.deleting.set(field);
    this.deleteError.set('');
    this.deleteMsg.set('');
  }

  confirmDelete() {
    const field = this.deleting();
    const version = this.rules()?.version;
    if (!field || this.deleteBusy() || version == null) return;
    this.deleteBusy.set(true);
    this.deleteError.set('');
    this.api.deleteField(field.key, version).subscribe({
      next: (r) => {
        this.deleteBusy.set(false);
        this.deleting.set(null);
        const rows = `${r.rowsChanged} ${r.rowsChanged === 1 ? 'row' : 'rows'}`;
        const requests = r.requestsClosed
          ? ` ${r.requestsClosed} open ${r.requestsClosed === 1 ? 'request' : 'requests'} about it ${r.requestsClosed === 1 ? 'was' : 'were'} closed.`
          : '';
        this.deleteMsg.set(
          `Deleted ${field.label}. Its values were removed from ${rows} in Industries.${requests}`,
        );
        this.setRules(r.rules, true);
        this.loadVersions();
        if (r.requestsClosed) this.api.refreshRequestCount();
      },
      error: (err: HttpErrorResponse) => {
        this.deleteBusy.set(false);
        this.deleteError.set(errorText(err));
      },
    });
  }

  private hasHidden(text: string): boolean {
    return /\p{Cc}|\p{Cf}/u.test(text);
  }

  // Asking a developer, for a new type or to turn a field into a real column
  askingType = signal<string | null>(null);
  askType = signal<FieldType>('text');
  askMsg = signal('');
  askError = signal('');

  startTypeAsk(f: FieldRule) {
    this.askingType.set(f.key);
    this.askType.set(this.types.find((t) => t.value !== f.type)!.value);
    this.askMsg.set('');
    this.askError.set('');
  }

  sendTypeAsk(f: FieldRule) {
    this.api.askFieldType(f.key, this.askType()).subscribe({
      next: () =>
        this.asked(
          `Asked a developer to make "${f.label}" a ${this.typeLabel(this.askType()).toLowerCase()}.`,
        ),
      error: (err: HttpErrorResponse) => this.askError.set(errorText(err)),
    });
  }

  askRealColumn(f: FieldRule) {
    this.api.askColumn({ fieldKey: f.key }).subscribe({
      next: () => this.asked(`Asked a developer to turn "${f.label}" into a real column.`),
      error: (err: HttpErrorResponse) => this.askError.set(errorText(err)),
    });
  }

  private asked(message: string) {
    this.askingType.set(null);
    this.editing.set(null);
    this.askError.set('');
    this.askMsg.set(message);
    this.api.refreshRequestCount();
    this.loadWaiting();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
