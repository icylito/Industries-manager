import { Service, inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Industry, CreateIndustry, UpdateIndustry } from '../models/industry';

@Service()
export class IndustryApi {
    private http = inject(HttpClient);
    private baseUrl = 'http://localhost:5005/industries';
    
    getAll(): Observable<Industry[]> {
            return this.http.get<Industry[]>(this.baseUrl);
        }
        create(body: CreateIndustry): Observable<Industry>{
            return this.http.post<Industry>(this.baseUrl, body);
        }
        update(id: number, body: UpdateIndustry): Observable<void>{
            return this.http.put<void>(`${this.baseUrl}/update/${id}`, body);
        }
        delete(id: number): Observable<string>{
            return this.http.delete(`${this.baseUrl}/${id}`, { responseType: 'text'})
        }
    }

