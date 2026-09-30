import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { Industry, CreateIndustry  } from '../../models/industry';
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

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(50)]],
    sector: ['', [Validators.maxLength(25)]],
    price: [null as number | null, [Validators.min(0), Validators.max(10)]],
    release: ['', [Validators.required]],
  })
  industries = signal<Industry[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  editingId = signal<number | null>(null);
  formError = signal('');

   submit() {
    if (this.form.invalid) return;

    const verify = this.form.getRawValue();
    const body: CreateIndustry = {
      name: verify.name ?? '',
      sector: verify.sector || null,
      price: verify.price,
      release: verify.release ?? '',
    };

    this.saving.set(true);
    this.formError.set('');

    const id = this.editingId();

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

  private errorMessage (err: any): string {
    const body = err.error;
    if (typeof body === 'string') return body;
    if (body?.errors) return Object.values(body.errors).flat().join(' ');
    return 'Could not save. Try again later';
  }

  fieldErrors(): string[] {
    const c = this.form.controls;
    const list: string[] = [];
    if (c.name.errors?. ['maxlength']) list.push('Name can be at most 50 characters');
    if (c.sector.errors?.['maxlength']) list.push('Sector can be at most 25 characters');
    if (c.price.errors?. ['min'] || c.price.errors?. ['max']) list.push('price can be only 0 to 10');
    return list;
  }

  ngOnInit(): void {
    this.api.getAll().subscribe({
      next: data => {
        this.industries.set(data);
        this.loading.set(false);
    },
    error: () => {
      this.error.set('Could not load the industries. Check if the API is running');
      this.loading.set(false);
    },
  });
  }
  remove(id: number){
    if (!confirm('Are you sure you want to delete this industry?'))return;
    this.api.delete(id).subscribe({
      next: () => {
        this.industries.update(list => list.filter(i => i.id !== id));
        if (this.editingId() === id) this.cancelEdit();
      },
      error: err => this.formError.set(this.errorMessage(err)),   
    });
  }
    edit(item: Industry) {
      this.editingId.set(item.id);
      this.formError.set('');
      this.form.setValue({
        name: item.name,
        sector: item.sector,
        price: item.price,
        release: item.release,
      });
    }

    cancelEdit() {
      this.editingId.set(null);
      this.form.reset();
    }

  search = signal ('');

  filtered = computed(() => 
  this.industries().filter(i => i.name.toLowerCase()
  .includes(this.search().toLowerCase()))) 
}
