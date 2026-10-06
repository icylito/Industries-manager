import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FieldRule, NewField, RuleSet } from '../../models/industry';
import { IndustryApi, errorText } from '../../services/industry-api';

type FieldType = 'text' | 'number' | 'date';

interface QueuedField {
  label: string;
  type: FieldType;
  required: boolean;
  maxLength: number | null;
  min: number | null;
  max: number | null;
}

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

  // keepEdits leaves unsaved label and limit changes in place for fields that are still there
  private setRules(r: RuleSet, keepEdits = false) {
    const edited = this.draft();
    const previous = this.rules()?.fields ?? [];
    this.rules.set(r);
    this.draft.set(r.fields.map(f => {
      if (!keepEdits) return { ...f };
      const was = edited.find(p => p.key === f.key);
      const original = previous.find(p => p.key === f.key);
      if (!was || !original) return { ...f };
      const kept: FieldRule = { ...f };
      for (const key of ['label', 'required', 'maxLength', 'min', 'max', 'hidden'] as const) {
        if (was[key] !== original[key]) kept[key] = was[key] as never;
      }
      return kept;
    }));
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
  queue = signal<QueuedField[]>([]);
  sending = signal(false);
  deleting = signal<FieldRule | null>(null);
  deleteBusy = signal(false);
  deleteMsg = signal('');
  deleteError = signal('');

  addField() {
    this.addMsg.set('');
    this.addError.set('');
    const problem = this.queueProblem();
    if (problem) {
      this.addError.set(problem);
      return;
    }
    const type = this.newType();
    this.queue.update(list => [...list, {
      label: this.newLabel().trim(),
      type,
      required: this.newRequired(),
      maxLength: type === 'text' ? this.newMaxLength() : null,
      min: type === 'number' ? this.newMin() : null,
      max: type === 'number' ? this.newMax() : null,
    }]);
    this.newLabel.set('');
    this.newType.set('text');
    this.newRequired.set(false);
    this.newMaxLength.set(null);
    this.newMin.set(null);
    this.newMax.set(null);
  }

  removeQueued(index: number) {
    if (this.sending()) return;
    this.queue.update(list => list.filter((_, i) => i !== index));
  }

  queueLimits(field: QueuedField): string {
    const parts: string[] = [];
    if (field.type === 'text' && field.maxLength !== null) parts.push(`Longest ${field.maxLength}`);
    if (field.type === 'number' && field.min !== null) parts.push(`Lowest ${field.min}`);
    if (field.type === 'number' && field.max !== null) parts.push(`Highest ${field.max}`);
    return parts.join(', ');
  }

  sendFields() {
    const queued = this.queue();
    const version = this.rules()?.version;
    if (!queued.length || this.sending() || version == null) return;
    this.sending.set(true);
    this.addMsg.set('');
    this.addError.set('');
    const fields: NewField[] = queued.map(field => ({
      label: field.label,
      type: field.type,
      required: field.required,
      maxLength: field.maxLength,
      min: field.min,
      max: field.max,
    }));
    this.api.addFields(fields, version).subscribe({
      next: r => {
        this.sending.set(false);
        this.addMsg.set(this.addedSentence(queued.map(field => field.label)));
        this.queue.set([]);
        this.setRules(r, true);
        this.loadVersions();
      },
      error: (err: HttpErrorResponse) => { this.sending.set(false); this.addError.set(errorText(err)); },
    });
  }

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
      next: r => {
        this.deleteBusy.set(false);
        this.deleting.set(null);
        this.deleteMsg.set(`Deleted ${field.label}.`);
        this.setRules(r, true);
        this.loadVersions();
      },
      error: (err: HttpErrorResponse) => { this.deleteBusy.set(false); this.deleteError.set(errorText(err)); },
    });
  }

  private queueProblem(): string | null {
    const label = this.newLabel().trim();
    if (!label || label.length > 40) return 'The label has to be 1 to 40 characters';
    if (this.hasHidden(label)) return "The label can't contain line breaks or hidden characters";
    const taken = [...this.draft().map(f => f.label), ...this.queue().map(f => f.label)];
    if (taken.some(existing => existing.trim().toLowerCase() === label.toLowerCase())) {
      return 'A field with that label already exists';
    }
    const type = this.newType();
    const maxLength = type === 'text' ? this.newMaxLength() : null;
    const min = type === 'number' ? this.newMin() : null;
    const max = type === 'number' ? this.newMax() : null;
    if (maxLength !== null && (maxLength < 1 || maxLength > 1000)) {
      return 'Max length only works on text and has to be 1 to 1000';
    }
    if (min !== null && max !== null && min > max) return "Min can't be above max";
    return null;
  }

  private hasHidden(text: string): boolean {
    return /\p{Cc}|\p{Cf}/u.test(text);
  }

  private addedSentence(labels: string[]): string {
    const list = labels.length <= 1
      ? (labels[0] ?? '')
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return labels.length === 1 ? `Added 1 field: ${list}.` : `Added ${labels.length} fields: ${list}.`;
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
