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