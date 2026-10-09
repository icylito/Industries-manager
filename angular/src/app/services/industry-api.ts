import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEvent, HttpResponse } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, retry, throwError, timer } from 'rxjs';
import {
    Industry, CreateIndustry, UpdateIndustry, DbHealth, RuleSet, FieldRule, NewField, VersionSummary, VersionDetail,
    ImportPreview, ImportResult, RestoreResult, Retention, BackupEntry, BackupStatus, BackupRestorePreview, BackupRestoreResult, DevRequest,
    SettingsFile, SettingsImportPreview, SettingsImportResult, AuthUser, NewUserResult, DeletedRow, FieldDeleted, UserNote,
    BoardAnswer, BoardDocument, ScratchFileInfo,
} from '../models/industry';
import { environment } from '../../environments/environment';

@Service()
export class IndustryApi {
    private http = inject(HttpClient);
    private apiUrl = environment.apiUrl;
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
        // The Scratchpad, one board per person, saved as a single JSON document
        board(): Observable<BoardAnswer> {
            return this.http.get<BoardAnswer>(this.apiUrl + '/scratchpad').pipe(this.retryTransient());
        }
        saveBoard(document: BoardDocument, updatedAt: string | null): Observable<{ updatedAt: string }> {
            return this.http.put<{ updatedAt: string }>(this.apiUrl + '/scratchpad', { document, updatedAt });
        }
        create(body: CreateIndustry): Observable<Industry>{
            return this.http.post<Industry>(this.baseUrl, body);
        }
        // The Scratchpad rail never loads the table: the few most expensive rows, name matches, and the cards it holds
        topIndustries(limit: number): Observable<Industry[]> {
            return this.http.get<Industry[]>(`${this.baseUrl}/top`, { params: { by: 'price', limit } }).pipe(this.retryTransient());
        }
        searchIndustries(q: string, limit: number): Observable<Industry[]> {
            return this.http.get<Industry[]>(`${this.baseUrl}/search`, { params: { q, limit } });
        }
        industriesByIds(ids: number[]): Observable<Industry[]> {
            return this.http.get<Industry[]>(`${this.baseUrl}/by-ids`, { params: { ids: ids.join(',') } }).pipe(this.retryTransient());
        }
        // A file for the Scratchpad, sent as a form so the API names it in any refusal. The events carry the progress.
        uploadScratchFile(file: File): Observable<HttpEvent<ScratchFileInfo>> {
            const form = new FormData();
            form.append('file', file, file.name);
            return this.http.post<ScratchFileInfo>(`${this.apiUrl}/scratchpad/files`, form, { reportProgress: true, observe: 'events' });
        }
        // The bytes of a stored file, fetched with the sign in so a picture can show and Open can work
        scratchFileBlob(id: number): Observable<Blob> {
            return this.http.get(`${this.apiUrl}/scratchpad/files/${id}`, { responseType: 'blob' });
        }
        getById(id: number): Observable<Industry> {
            return this.http.get<Industry>(`${this.baseUrl}/${id}`);
        }
        update(id: number, body: UpdateIndustry): Observable<void>{
            return this.http.put<void>(`${this.baseUrl}/update/${id}`, body);
        }
        // The API says what went: 1 row from Industries, with its name
        delete(id: number): Observable<DeletedRow>{
            return this.http.delete<DeletedRow>(`${this.baseUrl}/${id}`);
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
    deleteField(key: string, basedOn: number): Observable<FieldDeleted> {
        return this.http.delete<FieldDeleted>(`${this.apiUrl}/schema/fields/${encodeURIComponent(key)}`, { params: { basedOn } });
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
    deleteVersion(id: number): Observable<{ deleted: number }> {
        return this.http.delete<{ deleted: number }>(`${this.apiUrl}/history/versions/${id}`);
    }
    restore(id: number, note: string): Observable<RestoreResult> {
        return this.http.post<RestoreResult>(`${this.apiUrl}/history/versions/${id}/restore`, { note });
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
    // How many saved versions these settings would remove, nothing is saved
    previewRetention(body: Retention): Observable<{ willRemove: number }> {
        return this.http.post<{ willRemove: number }>(`${this.apiUrl}/history/settings/preview`, body);
    }
    settingsExportUrl(): string {
        return `${this.apiUrl}/history/settings/export`;
    }
    previewSettingsImport(file: SettingsFile): Observable<SettingsImportPreview> {
        return this.http.post<SettingsImportPreview>(`${this.apiUrl}/history/settings/import/preview`, file);
    }
    importSettings(file: SettingsFile): Observable<SettingsImportResult> {
        return this.http.post<SettingsImportResult>(`${this.apiUrl}/history/settings/import`, file);
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
    // Restoring a backup. The preview changes nothing, the restore wants the word RESTORE.
    backupRestorePreview(id: string): Observable<BackupRestorePreview> {
        return this.http.get<BackupRestorePreview>(`${this.apiUrl}/backups/${id}/restore/preview`);
    }
    restoreBackup(id: string, confirm: string): Observable<BackupRestoreResult> {
        return this.http.post<BackupRestoreResult>(`${this.apiUrl}/backups/${id}/restore`, { confirm });
    }
    // The whole backup as one signed zip, the same file the drop box takes back
    backupZipUrl(id: string): string {
        return `${this.apiUrl}/backups/${id}/download`;
    }
    // A backup zip dropped in. It is checked and added to the list; restoring it is a separate step.
    uploadBackup(file: File): Observable<BackupEntry> {
        const form = new FormData();
        form.append('file', file, file.name);
        return this.http.post<BackupEntry>(`${this.apiUrl}/backups/upload`, form);
    }

    // People, admins only
    users(): Observable<AuthUser[]> {
        return this.http.get<AuthUser[]>(`${this.apiUrl}/users`);
    }
    createUser(username: string, role: string): Observable<NewUserResult> {
        return this.http.post<NewUserResult>(`${this.apiUrl}/users`, { username, role });
    }
    resetPassword(id: number): Observable<NewUserResult> {
        return this.http.post<NewUserResult>(`${this.apiUrl}/users/${id}/reset-password`, {});
    }
    updateUser(id: number, body: { username?: string; role?: string; disabled?: boolean }): Observable<AuthUser> {
        return this.http.put<AuthUser>(`${this.apiUrl}/users/${id}`, body);
    }
    // Deleting an account for good. What History already recorded keeps the name.
    deleteUser(id: number): Observable<{ deleted: number; username: string }> {
        return this.http.delete<{ deleted: number; username: string }>(`${this.apiUrl}/users/${id}`);
    }

    // Notes an admin keeps about an account. They never reach the person they are about.
    userNotes(id: number): Observable<UserNote[]> {
        return this.http.get<UserNote[]>(`${this.apiUrl}/users/${id}/notes`);
    }
    addUserNote(id: number, text: string): Observable<UserNote> {
        return this.http.post<UserNote>(`${this.apiUrl}/users/${id}/notes`, { text });
    }
    deleteUserNote(id: number, noteId: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/users/${id}/notes/${noteId}`);
    }

    // A link can't carry the sign in token, so files are fetched with it and saved from the page
    downloadFile(url: string, fallbackName: string): Observable<void> {
        return new Observable<void>(subscriber => {
            this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
                next: (res: HttpResponse<Blob>) => {
                    const link = document.createElement('a');
                    const href = URL.createObjectURL(res.body as Blob);
                    link.href = href;
                    link.download = fileNameFrom(res.headers.get('Content-Disposition'), fallbackName);
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(href), 10000);
                    subscriber.next();
                    subscriber.complete();
                },
                error: err => subscriber.error(err),
            });
        });
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

// The file name out of a Content-Disposition header. filename* (percent encoded, any language) wins over filename,
// quotes come off, a name that can't be decoded or that isn't there at all falls back to the given one.
export function fileNameFrom(disposition: string | null, fallbackName: string): string {
    const text = disposition ?? '';
    const star = /filename\*\s*=\s*(?:[\w-]*'[\w-]*')?"?([^";]+)"?/i.exec(text)?.[1];
    const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(text);
    const raw = (star ?? plain?.[1] ?? plain?.[2] ?? '').trim();
    if (!raw) return fallbackName;
    try {
        const name = (star ? decodeURIComponent(raw) : raw).replace(/[\\/]/g, '_').trim();
        return name || fallbackName;
    } catch {
        return fallbackName;
    }
}

// Turns an API error into one plain sentence for the page
export function errorText(err: HttpErrorResponse, fallback = 'Something went wrong. Try again in a moment'): string {
    // Nothing came back at all. Checked first: the browser's own error ("Failed to fetch") rides along in the body,
    // and that is not a sentence for the page
    if (err?.status === 0) return 'Could not reach the API. Check if it is running';
    const body = err?.error;
    if (typeof body === 'string' && body) return body;
    if (body?.detail) return body.detail;
    if (body?.message) return body.message;
    if (body?.errors) return Object.values(body.errors).flat().join(' ');
    if (err?.status === 0) return 'Could not reach the API. Check if it is running';
    return fallback;
}
