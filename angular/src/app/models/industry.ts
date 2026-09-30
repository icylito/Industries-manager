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