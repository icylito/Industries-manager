import { Component, signal } from '@angular/core';
import { Industry } from '../../models/industry';

@Component({
  imports: [],
  selector: 'app-my-components',
  styleUrl: './my-components.css',
  templateUrl: './my-components.html',
})
export class MyComponents {
  industries = signal<Industry[]>([
    {id: 1, name: 'Omantel', sector: 'Public Sector', price: 0.210, release: '2021-09-17'},
    {id: 2, name: 'Ooredoo', sector: 'Private Sector', price: null , release: '2026-01-20'},
    {id: 3, name: 'Totally Tech', sector: null , price: 0.781, release: '2026-10-10'}
  ]);
  remove(id: number){
    this.industries.update(list => list.filter(i => i.id !== id));
  }
  nextId= 4;
  
  add(name: string, sector: string, price: string){
    const newItem: Industry = {
      id: this.nextId++,
      name,
      sector: sector || null,
      price: price ? Number(price) : null,
      release: new Date().toISOString().slice(0, 10),
    };
    this.industries.update(list => [...list, newItem]);
  }
}