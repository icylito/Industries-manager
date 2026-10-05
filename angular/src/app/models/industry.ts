export interface Industry {
    id: number;
    name: string;
    sector: string | null;
    price: number | null; 
    release: string | null;
}

export interface CreateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string | null;
}

export interface UpdateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string | null;
}

// What GET /health returns, see api_v2/Data/DatabaseStatus.cs
export interface DbHealth {
    state: 'starting' | 'migrating' | 'ready' | 'failed';
    message: string;
    attempts: number;
    appliedMigrations: string[];
    updatedAt: string;
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
}

export interface RuleSet {
    version: number;
    createdAt: string;
    changedBy: string;
    note: string | null;
    fields: FieldRule[];
}
