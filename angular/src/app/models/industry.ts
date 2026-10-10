export interface Industry {
    id: number;
    name: string;
    sector: string | null;
    price: number | null;
    release: string | null;
    // Imported rows that share a name with row #duplicateOf, shown amber with a triangle
    duplicateOf: number | null;
    // The saved version this row was imported from
    importedFrom: number | null;
    // Fields that couldn't be brought over from old data, red triangle until the row is saved
    lostFields: string[] | null;
    // Custom field values from the Fields page, keyed by field key
    extra: Record<string, string | number | null> | null;
}

// What DELETE /industries/{id} gives back, so the page can say what went and from where
export interface DeletedRow {
    deleted: number;
    table: string;
    id: number;
    name: string;
}

// What DELETE /schema/fields/{key} gives back
export interface FieldDeleted {
    rules: RuleSet;
    rowsChanged: number;
    requestsClosed: number;
}

export interface CreateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string | null;
    extra?: Record<string, string | number | null>;
}

export interface UpdateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string | null;
    extra?: Record<string, string | number | null>;
    // The row as it was when Edit was pressed. The API refuses the save with a 409 if it changed since.
    original?: { name: string; sector: string | null; price: number | null; release: string | null; extra: Record<string, string | number | null> | null };
}

// What GET /health returns, see api_v2/Data/DatabaseStatus.cs. Someone not signed in only gets state, message and history.
export interface DbHealth {
    state: 'starting' | 'migrating' | 'ready' | 'failed';
    message: string;
    attempts?: number;
    appliedMigrations?: string[];
    updatedAt?: string;
    history?: { ready: boolean; message: string };
    // Host, port, and database name. Optional so an older health body still loads.
    databases?: {
        live: { host: string; port: number; database: string };
        history: { host: string; port: number; database: string };
    };
}

// What GET /schema returns, the rules in use, see api_v2/Rules/FieldRule.cs
export interface FieldRule {
    key: string;
    label: string;
    type: 'text' | 'number' | 'date';
    required: boolean;
    maxLength: number | null;
    min: number | null;
    max: number | null;
    custom: boolean;
    hidden: boolean;
    // Allowed values for a text field. Sector reads these from scripts/config.toml.
    options?: string[] | null;
}

export interface RuleSet {
    version: number;
    createdAt: string;
    changedBy: string;
    note: string | null;
    fields: FieldRule[];
}

export interface NewField {
    label: string;
    type: 'text' | 'number' | 'date';
    required: boolean;
    maxLength: number | null;
    min: number | null;
    max: number | null;
}

// History page, see api_v2/Endpoints/HistoryEndpoints.cs
export interface VersionSummary {
    id: number;
    createdAt: string;
    reason: string;
    createdBy: string;
    rowCount: number;
    rulesVersion: number | null;
    pinned: boolean;
    sameLayout: boolean;
    // A saved value couldn't be read, so it can't be restored or brought back
    damaged: boolean;
}

// The file Export settings makes and Import settings reads
export interface SettingsFile {
    app: string;
    format: number;
    exportedAt?: string;
    retention?: Retention | null;
    fields?: FieldRule[] | null;
}

export interface SettingsImportPreview {
    rulesChanged: boolean;
    retentionChanged: boolean;
    retention: Retention | null;
    ignored: string[];
    willRemove: number;
}

export interface SettingsImportResult {
    rulesChanged: boolean;
    retentionChanged: boolean;
    ignored: string[];
    removed: number;
}

export interface VersionDetail extends VersionSummary {
    columns: string[];
    rules: FieldRule[] | null;
    rows: Record<string, unknown>[];
}

export interface ImportPreviewRow {
    oldId: number | null;
    name: string | null;
    values: Record<string, unknown>;
    level: 'red' | 'black' | null;
    problems: string[];
    similarTo: number | null;
    similarInBatch: boolean;
    skip: string | null;
}

export interface ImportPreview {
    versionId: number;
    rulesDiffer: boolean;
    message: string | null;
    unmatchedColumns: string[];
    total: number;
    willImport: number;
    skipped: string[];
    rows: ImportPreviewRow[];
}

export interface ImportResult {
    imported: number;
    similar: number;
    lostValues: number;
    breakingRules: number;
    skipped: string[];
    leftOutDuplicates: number;
    requestIds: number[];
}

export interface RestoreResult {
    restored: number;
    skipped: string[];
    lostValues: number;
    rulesRestored: boolean;
    requestId: number | null;
}

export interface Retention {
    keepVersions: number | null;
    keepDays: number | null;
}

// History page backups card, see api_v2/Endpoints/BackupEndpoints.cs
export interface BackupEntry {
    id: string;
    createdAt: string;
    kind: string;
    by: string;
    mainSize: number;
    collectorSize: number;
    rulesVersion: number;
    hasExcel: boolean;
    // Rows in the table when the copy was made, older backups don't have it
    rowCount: number | null;
    // False when the table had other columns back then, so Restore isn't offered. Null when the backup didn't record it.
    sameLayout: boolean | null;
    // Set when the backup was dropped in from a file
    uploadedAt?: string | null;
    // Only a signed backup can be downloaded as one file and dropped back in. Older ones still restore from the list.
    signed?: boolean;
}

// What GET /backups/{id}/restore/preview says before a restore
export interface BackupRestorePreview {
    id: string;
    createdAt: string;
    rulesVersion: number;
    rowCount: number | null;
    sameLayout: boolean | null;
    currentRows: number;
    historyReady: boolean;
}

export interface BackupRestoreResult {
    backup: string;
    rowsBefore: number;
    rows: number;
    rulesVersion: number;
    copyId: number | null;
    // The full backup of everything as it was just before this restore. Restoring it undoes the restore.
    undoBackup?: string | null;
}

export interface BackupStatus {
    running: boolean;
    lastError: string | null;
    lastErrorAt: string | null;
    nextNightly: string;
    keepDays: number;
    folder: string;
}

// Requests page, see api_v2/Endpoints/RequestEndpoints.cs
export interface DevRequest {
    id: number;
    createdAt: string;
    kind: 'column' | 'rename' | 'field-type' | 'restore-layout' | 'other';
    title: string;
    details: string;
    draftedCode: string | null;
    status: 'open' | 'done' | 'dismissed';
    createdBy: string;
    fieldKey: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
}

// Accounts. The API never sends a password hash.
// A manager makes and changes tables on the Tables page and restores backups. An admin does that and everything else.
export type Role = 'admin' | 'manager' | 'normal';

export interface AuthUser {
    id: number;
    username: string;
    role: Role;
    disabled: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    // Only the admin list sets this. It says a note exists, never what it says.
    hasNotes?: boolean;
}

// A note an admin keeps about an account. The person it is about is never shown one.
export interface UserNote {
    id: number;
    text: string;
    createdBy: string;
    createdAt: string;
}

export interface LoginResult {
    token: string;
    expiresAt: string;
    user: AuthUser;
}

// A new or reset account. The temporary password is shown once.
export interface NewUserResult {
    user: AuthUser;
    temporaryPassword: string;
}

// A table made on the Tables page. It is data in the API, not a real database table.
// Columns use the same shape as the Fields page; a removed column stays in the list with hidden set, values kept.
export interface UserTable {
    id: number;
    name: string;
    columns: FieldRule[];
    rowCount: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    version: number;
}

// One column as the Tables page sends it. key is empty for a new column, the API makes it from the label.
export interface ColumnInput {
    key?: string | null;
    label: string;
    type: 'text' | 'number' | 'date';
    required: boolean;
    maxLength?: number | null;
    min?: number | null;
    max?: number | null;
    options?: string[] | null;
}

export interface TableRow {
    id: number;
    data: Record<string, string | number | null>;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface TableRowsPage {
    total: number;
    page: number;
    size: number;
    rows: TableRow[];
}