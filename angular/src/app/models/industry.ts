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
}

// What GET /health returns, see api_v2/Data/DatabaseStatus.cs
export interface DbHealth {
    state: 'starting' | 'migrating' | 'ready' | 'failed';
    message: string;
    attempts: number;
    appliedMigrations: string[];
    updatedAt: string;
    history?: { ready: boolean; message: string };
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
