import { Observable } from 'rxjs';
import { ColumnInput, TableRow, TableRowsPage, UserTable } from '../../domain/models/industry';

// The Tables page's own tables on the API. infrastructure/tables-api.ts calls HTTP for it.
export abstract class TablesGateway {
  abstract list(): Observable<UserTable[]>;
  abstract bin(): Observable<UserTable[]>;
  abstract get(id: number): Observable<UserTable>;
  abstract create(name: string, columns: ColumnInput[]): Observable<UserTable>;
  abstract update(
    id: number,
    version: number,
    change: { name?: string; columns?: ColumnInput[] },
  ): Observable<UserTable>;
  abstract delete(id: number): Observable<{ deleted: number; keptUntil: string }>;
  abstract bringBack(id: number): Observable<UserTable>;
  abstract rows(
    id: number,
    query: { q?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; size?: number },
  ): Observable<TableRowsPage>;
  abstract addRow(id: number, values: Record<string, unknown>): Observable<TableRow>;
  abstract updateRow(
    id: number,
    rowId: number,
    values: Record<string, unknown>,
    updatedAt: string,
  ): Observable<TableRow>;
  abstract deleteRow(id: number, rowId: number): Observable<{ deleted: number }>;
  abstract exportCsv(id: number, fallbackName: string): Observable<void>;
}
