export interface Industry {
    id: number;
    name: string;
    sector: string | null;
    price: number | null; 
    release: string;
}

export interface CreateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string;
}

export interface UpdateIndustry{
    name: string;
    sector: string | null;
    price: number | null;
    release: string;
}