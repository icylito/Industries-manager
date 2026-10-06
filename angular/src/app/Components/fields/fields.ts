import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FieldRule, RuleSet } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';

type FieldType = 'text' | 'number' | 'date';

@Component({
  imports: [RouterLink],
  selector: 'app-fields',
  styleUrls: ['../my-components/my-components.css', '../history/history.css', './fields.css'],
  templateUrl: './fields.html',
})
export class FieldsPage implements OnInit {
  private api = inject(IndustryApi);

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
      next: r => { this.setRules(r); this.loading.set(false); },
      error: (err: HttpErrorResponse) => { this.error.set(errorText(err, 'Could not load the fields')); this.loading.set(false); },
    });
    this.loadVersions();
    this.loadWaiting();
  }

  private setRules(r: RuleSet) {
    this.rules.set(r);
    this.draft.set(r.fields.map(f => ({ ...f })));
  }

  private loadVersions() {
    this.api.ruleVersions().subscribe({ next: v => this.versions.set(v), error: () => {} });
  }

  private loadWaiting() {
    this.api.requests('open').subscribe({
      next: list => this.waiting.set(new Set(list.map(r => r.fieldKey).filter((k): k is string => !!k))),
      error: () => {},
    });
  }

  dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.rules()?.fields ?? []));

  update(key: string, change: Partial<FieldRule>) {
    this.draft.update(list => list.map(f => (f.key === key ? { ...f, ...change } : f)));
    this.saveMsg.set('');
    this.saveError.set('');
  }

  num(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  typeLabel(type: string): string {
    return this.types.find(t => t.value === type)?.label ?? type;
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
      next: r => {
        this.saving.set(false);
        this.setRules(r);
        this.note.set('');
        this.saveMsg.set(`Saved as rules version ${r.version}. A copy of the table was saved first.`);
        this.loadVersions();
      },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.saveError.set(errorText(err)); },
    });
  }

  // New custom field
  newLabel = signal('');
  newType = signal<FieldType>('text');
  newRequired = signal(false);
  newMaxLength = signal<number | null>(null);
  newMin = signal<number | null>(null);
  newMax = signal<number | null>(null);
  addMsg = signal('');
  addError = signal('');
  adding = signal(false);

  addField() {
    this.adding.set(true);
    this.addMsg.set('');
    this.addError.set('');
    const type = this.newType();
    this.api.addField({
      label: this.newLabel().trim(),
      type,
      required: this.newRequired(),
      maxLength: type === 'text' ? this.newMaxLength() : null,
      min: type === 'number' ? this.newMin() : null,
      max: type === 'number' ? this.newMax() : null,
    }).subscribe({
      next: r => {
        this.adding.set(false);
        this.addMsg.set(`Added "${this.newLabel().trim()}". It shows in the form and the table now.`);
        this.newLabel.set(''); this.newRequired.set(false); this.newMaxLength.set(null); this.newMin.set(null); this.newMax.set(null);
        this.setRules(r);
        this.loadVersions();
      },
      error: (err: HttpErrorResponse) => { this.adding.set(false); this.addError.set(errorText(err)); },
    });
  }

  // Asking a developer, for a new type or a real column
  askingType = signal<string | null>(null);
  askType = signal<FieldType>('text');
  askMsg = signal('');
  askError = signal('');

  startTypeAsk(f: FieldRule) {
    this.askingType.set(f.key);
    this.askType.set(this.types.find(t => t.value !== f.type)!.value);
    this.askMsg.set('');
    this.askError.set('');
  }

  sendTypeAsk(f: FieldRule) {
    this.api.askFieldType(f.key, this.askType()).subscribe({
      next: () => this.asked(`Asked a developer to make "${f.label}" a ${this.typeLabel(this.askType()).toLowerCase()}.`),
      error: (err: HttpErrorResponse) => this.askError.set(errorText(err)),
    });
  }

  askRealColumn(f: FieldRule) {
    this.api.askColumn({ fieldKey: f.key }).subscribe({
      next: () => this.asked(`Asked a developer to turn "${f.label}" into a real column.`),
      error: (err: HttpErrorResponse) => this.askError.set(errorText(err)),
    });
  }

  colLabel = signal('');
  colType = signal<FieldType>('text');
  colDetails = signal('');

  askNewColumn() {
    this.api.askColumn({ label: this.colLabel().trim(), type: this.colType(), details: this.colDetails().trim() || undefined }).subscribe({
      next: () => {
        this.asked(`Asked a developer for a "${this.colLabel().trim()}" column.`);
        this.colLabel.set(''); this.colDetails.set('');
      },
      error: (err: HttpErrorResponse) => this.askError.set(errorText(err)),
    });
  }

  private asked(message: string) {
    this.askingType.set(null);
    this.askError.set('');
    this.askMsg.set(message);
    this.api.refreshRequestCount();
    this.loadWaiting();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
