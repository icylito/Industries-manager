import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, retry, throwError, timer } from 'rxjs';
import {
    Industry, CreateIndustry, UpdateIndustry, DbHealth, RuleSet, FieldRule, NewField, VersionSummary, VersionDetail,
    ImportPreview, ImportResult, RestoreResult, Retention, BackupEntry, BackupStatus, DevRequest,
} from '../models/industry';

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
    schema(): Observable<RuleSet> {
            return this.http.get<RuleSet>(`${this.apiUrl}/schema`).pipe(this.retryTransient());
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

    // Rules and custom fields
    saveRules(fields: FieldRule[], note: string | null, basedOn: number): Observable<RuleSet> {
        return this.http.put<RuleSet>(`${this.apiUrl}/schema`, { note, fields, basedOn });
    }
    addField(field: NewField): Observable<RuleSet> {
        return this.http.post<RuleSet>(`${this.apiUrl}/schema/fields`, field);
    }
    addFields(fields: NewField[], basedOn: number | null): Observable<RuleSet> {
        return this.http.post<RuleSet>(`${this.apiUrl}/schema/fields/many`, { basedOn, fields });
    }
    deleteField(key: string, basedOn: number): Observable<RuleSet> {
        return this.http.delete<RuleSet>(`${this.apiUrl}/schema/fields/${encodeURIComponent(key)}`, { params: { basedOn } });
    }
    ruleVersions(): Observable<RuleSet[]> {
        return this.http.get<RuleSet[]>(`${this.apiUrl}/schema/versions`).pipe(this.retryTransient());
    }

    // History
    versions(): Observable<VersionSummary[]> {
        return this.http.get<VersionSummary[]>(`${this.apiUrl}/history/versions`).pipe(this.retryTransient());
    }
    version(id: number): Observable<VersionDetail> {
        return this.http.get<VersionDetail>(`${this.apiUrl}/history/versions/${id}`).pipe(this.retryTransient());
    }
    downloadUrl(id: number): string {
        return `${this.apiUrl}/history/versions/${id}/download`;
    }
    pin(id: number, pinned: boolean): Observable<void> {
        return this.http.put<void>(`${this.apiUrl}/history/versions/${id}/pin`, { pinned });
    }
    restore(id: number, confirm: string): Observable<RestoreResult> {
        return this.http.post<RestoreResult>(`${this.apiUrl}/history/versions/${id}/restore`, { confirm });
    }
    importPreview(id: number): Observable<ImportPreview> {
        return this.http.post<ImportPreview>(`${this.apiUrl}/history/versions/${id}/import/preview`, {});
    }
    importVersion(id: number, confirm: boolean, skipDuplicates = false): Observable<ImportResult> {
        return this.http.post<ImportResult>(`${this.apiUrl}/history/versions/${id}/import`, { confirm, skipDuplicates });
    }
    retention(): Observable<Retention> {
        return this.http.get<Retention>(`${this.apiUrl}/history/settings`).pipe(this.retryTransient());
    }
    saveRetention(body: Retention): Observable<Retention & { removed: number }> {
        return this.http.put<Retention & { removed: number }>(`${this.apiUrl}/history/settings`, body);
    }
    backups(): Observable<{ backups: BackupEntry[]; status: BackupStatus }> {
        return this.http.get<{ backups: BackupEntry[]; status: BackupStatus }>(`${this.apiUrl}/backups`).pipe(this.retryTransient());
    }
    backupNow(): Observable<BackupEntry> {
        return this.http.post<BackupEntry>(`${this.apiUrl}/backups`, {});
    }
    backupDownloadUrl(id: string, file: 'main' | 'collector' | 'excel'): string {
        return `${this.apiUrl}/backups/${id}/${file}`;
    }

    // Requests, openRequests is the number on the bell
    openRequests = signal(0);

    refreshRequestCount() {
        this.http.get<{ open: number }>(`${this.apiUrl}/requests/count`).subscribe({
            next: c => this.openRequests.set(c.open),
            error: () => {},
        });
    }
    requests(status: 'open' | 'done' | 'dismissed' | 'all' = 'open'): Observable<DevRequest[]> {
        return this.http.get<DevRequest[]>(`${this.apiUrl}/requests`, { params: { status } }).pipe(this.retryTransient());
    }
    askDeveloper(title: string, details: string): Observable<HttpResponse<DevRequest>> {
        return this.http.post<DevRequest>(`${this.apiUrl}/requests`, { title, details }, { observe: 'response' });
    }
    askColumn(body: { label?: string; type?: string; fieldKey?: string; details?: string }): Observable<DevRequest> {
        return this.http.post<DevRequest>(`${this.apiUrl}/requests/column`, body);
    }
    askFieldType(fieldKey: string, type: string): Observable<DevRequest> {
        return this.http.post<DevRequest>(`${this.apiUrl}/requests/field-type`, { fieldKey, type });
    }
    setRequestStatus(id: number, status: 'open' | 'done' | 'dismissed'): Observable<DevRequest> {
        return this.http.put<DevRequest>(`${this.apiUrl}/requests/${id}/status`, { status });
    }
}

// Turns an API error into one plain sentence for the page
export function errorText(err: HttpErrorResponse, fallback = 'Something went wrong. Try again in a moment'): string {
    const body = err?.error;
    if (typeof body === 'string' && body) return body;
    if (body?.detail) return body.detail;
    if (body?.message) return body.message;
    if (body?.errors) return Object.values(body.errors).flat().join(' ');
    if (err?.status === 0) return 'Could not reach the API. Check if it is running';
    return fallback;
}
