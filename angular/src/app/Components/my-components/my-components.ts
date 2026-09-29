import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { Industry } from '../../models/industry';
import { IndustryApi } from '../../services/industry-api';


@Component({
  imports: [],
  selector: 'app-my-components',
  styleUrl: './my-components.css',
  templateUrl: './my-components.html',
})

export class MyComponents implements OnInit {
  private api = inject(IndustryApi);
  industries = signal<Industry[]>([]);

  ngOnInit(): void {
    this.api.getAll().subscribe(data => this.industries.set(data));
  }
  remove(id: number){
    this.industries.update(list => list.filter(i => i.id !== id));
  }

  add(name: string, sector: string, price: string){
    const newItem: Industry = {
      id: Math.max(0, ...this.industries().map(i => i.id)) +1,
      name,
      sector: sector || null,
      price: price ? Number(price) : null,
      release: new Date().toISOString().slice(0, 10),
    };
    this.industries.update(list => [...list, newItem]);
  }
  search = signal ('');

  filtered = computed(() => 
  this.industries().filter(i => i.name.toLowerCase()
  .includes(this.search().toLowerCase()))) 
}
