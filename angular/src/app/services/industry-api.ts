import { Service } from '@angular/core';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Industry } from '../models/industry';

@Service()
export class IndustryApi {
    private http = inject(HttpClient);
    private baseUrl = 'http://localhost:5005/industries';
    
    getAll(): Observable<Industry[]> {
        return this.http.get<Industry[]>(this.baseUrl);
    }
}
