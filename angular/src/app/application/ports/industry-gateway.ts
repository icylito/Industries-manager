import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Industry,
  CreateIndustry,
  UpdateIndustry,
  DbHealth,
  RuleSet,
  FieldRule,
  NewField,
  VersionSummary,
  VersionDetail,
  ImportPreview,
  ImportResult,
  RestoreResult,
  Retention,
  BackupEntry,
  BackupStatus,
  BackupRestorePreview,
  BackupRestoreResult,
  DevRequest,
  RequestThread,
  RequestMessage,
  RowActivity,
  SettingsFile,
  SettingsImportPreview,
  SettingsImportResult,
  AuthUser,
  NewUserResult,
  DeletedRow,
  FieldDeleted,
  UserNote,
} from '../../domain/models/industry';

// What the page asks of the API about the table and everything around it: rows, rules, History, backups, accounts and
// requests. The use cases and the pages depend on this; infrastructure/industry-api.ts is the one that calls HTTP.
// A file the API sends is saved from the page by downloadFile, because a plain link can't carry the sign in.
export abstract class IndustryGateway {
  // The number on the Requests bell, kept fresh by refreshRequestCount
  abstract readonly openRequests: Signal<number>;
  abstract health(): Observable<DbHealth>;
  abstract schema(): Observable<RuleSet>;
  abstract getAll(): Observable<Industry[]>;
  abstract create(body: CreateIndustry): Observable<Industry>;
  abstract topIndustries(limit: number): Observable<Industry[]>;
  abstract searchIndustries(q: string, limit: number): Observable<Industry[]>;
  abstract industriesByIds(ids: number[]): Observable<Industry[]>;
  abstract getById(id: number): Observable<Industry>;
  abstract update(id: number, body: UpdateIndustry): Observable<void>;
  abstract delete(id: number): Observable<DeletedRow>;
  abstract saveRules(
    fields: FieldRule[],
    note: string | null,
    basedOn: number,
  ): Observable<RuleSet>;
  abstract addField(field: NewField): Observable<RuleSet>;
  abstract addFields(fields: NewField[], basedOn: number | null): Observable<RuleSet>;
  abstract deleteField(key: string, basedOn: number): Observable<FieldDeleted>;
  abstract ruleVersions(): Observable<RuleSet[]>;
  abstract versions(): Observable<VersionSummary[]>;
  abstract version(id: number): Observable<VersionDetail>;
  abstract downloadUrl(id: number): string;
  abstract pin(id: number, pinned: boolean): Observable<void>;
  abstract deleteVersion(id: number): Observable<{ deleted: number }>;
  abstract restore(id: number, note: string): Observable<RestoreResult>;
  abstract importPreview(id: number): Observable<ImportPreview>;
  abstract importVersion(
    id: number,
    confirm: boolean,
    skipDuplicates?: boolean,
  ): Observable<ImportResult>;
  abstract retention(): Observable<Retention>;
  abstract saveRetention(body: Retention): Observable<Retention & { removed: number }>;
  abstract previewRetention(body: Retention): Observable<{ willRemove: number }>;
  abstract settingsExportUrl(): string;
  abstract previewSettingsImport(file: SettingsFile): Observable<SettingsImportPreview>;
  abstract importSettings(file: SettingsFile): Observable<SettingsImportResult>;
  abstract backups(): Observable<{ backups: BackupEntry[]; status: BackupStatus }>;
  abstract backupNow(): Observable<BackupEntry>;
  abstract backupDownloadUrl(id: string, file: 'main' | 'collector' | 'excel'): string;
  abstract backupRestorePreview(id: string): Observable<BackupRestorePreview>;
  abstract restoreBackup(id: string, confirm: string): Observable<BackupRestoreResult>;
  abstract backupZipUrl(id: string): string;
  abstract deleteBackup(id: string): Observable<void>;
  abstract uploadBackup(file: File): Observable<BackupEntry>;
  abstract users(): Observable<AuthUser[]>;
  abstract createUser(username: string, role: string): Observable<NewUserResult>;
  abstract resetPassword(id: number): Observable<NewUserResult>;
  abstract updateUser(
    id: number,
    body: { username?: string; role?: string; disabled?: boolean },
  ): Observable<AuthUser>;
  abstract deleteUser(id: number): Observable<{ deleted: number; username: string }>;
  abstract userNotes(id: number): Observable<UserNote[]>;
  abstract addUserNote(id: number, text: string): Observable<UserNote>;
  abstract deleteUserNote(id: number, noteId: number): Observable<void>;
  abstract downloadFile(url: string, fallbackName: string): Observable<void>;
  abstract refreshRequestCount(): void;
  abstract requests(
    status?: 'open' | 'in-progress' | 'active' | 'done' | 'dismissed' | 'all',
  ): Observable<DevRequest[]>;
  abstract askDeveloper(title: string, details: string, code?: string): Observable<AskAnswer>;
  abstract askColumn(body: {
    label?: string;
    type?: string;
    fieldKey?: string;
    details?: string;
  }): Observable<DevRequest>;
  abstract askFieldType(fieldKey: string, type: string): Observable<DevRequest>;
  abstract requestThread(id: number): Observable<RequestThread>;
  abstract replyToRequest(
    id: number,
    body: string,
  ): Observable<{ message: RequestMessage; status: DevRequest['status'] }>;
  abstract activity(): Observable<RowActivity[]>;
  abstract setRequestStatus(id: number, status: DevRequest['status']): Observable<DevRequest>;
}

// A request's answer: 201 when it is new, 200 when the same open request was already there and this one joined it
export interface AskAnswer {
  readonly status: number;
  readonly body: DevRequest | null;
}
