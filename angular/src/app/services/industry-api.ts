import { Service, inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, retry, throwError, timer } from 'rxjs';
import { Industry, CreateIndustry, UpdateIndustry, DbHealth } from '../models/industry';

@Service()
export class IndustryApi {
    private http = inject(HttpClient);
    private apiUrl = 'http://localhost:5005';
    private baseUrl = `${this.apiUrl}/industries`;

    // Retries a dropped connection or a 5xx up to 3 times (0.5s, 1s, 2s), a 4xx fails right away.
    // Only used on GETs, retrying a POST could insert the same row twice.
    private retryTransient<T>(): MonoTypeOperatorFunction<T> {
        return retry<T>({
            count: 3,
            delay: (err: HttpErrorResponse, attempt) =>
                err.status === 0 || err.status >= 500 ? timer(500 * 2 ** (attempt - 1)) : throwError(() => err),
        });
    }

    health(): Observable<DbHealth> {
            return this.http.get<DbHealth>(`${this.apiUrl}/health`).pipe(this.retryTransient());
        }
    getAll(): Observable<Industry[]> {
            return this.http.get<Industry[]>(this.baseUrl).pipe(this.retryTransient());
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

