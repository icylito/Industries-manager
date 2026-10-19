import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TablesGateway } from '../application/ports/tables-gateway';
import { ColumnInput, TableRow, TableRowsPage, UserTable } from '../domain/models/industry';
import { environment } from '../../environments/environment';
import { IndustryApi } from './industry-api';

// The Tables page's calls. Everyone signed in can read; managers and admins change things (the API checks every call).
@Service()
export class TablesApi implements TablesGateway {
  private http = inject(HttpClient);
  private industries = inject(IndustryApi);
  private url = `${environment.apiUrl}/tables`;

  list(): Observable<UserTable[]> {
    return this.http.get<UserTable[]>(this.url);
  }

  bin(): Observable<UserTable[]> {
    return this.http.get<UserTable[]>(`${this.url}/bin`);
  }

  get(id: number): Observable<UserTable> {
    return this.http.get<UserTable>(`${this.url}/${id}`);
  }

  create(name: string, columns: ColumnInput[]): Observable<UserTable> {
    return this.http.post<UserTable>(this.url, { name, columns });
  }

  // version is the one the page was looking at, so a change made meanwhile is refused instead of overwritten
  update(
    id: number,
    version: number,
    change: { name?: string; columns?: ColumnInput[] },
  ): Observable<UserTable> {
    return this.http.put<UserTable>(`${this.url}/${id}`, { ...change, version });
  }

  delete(id: number): Observable<{ deleted: number; keptUntil: string }> {
    return this.http.delete<{ deleted: number; keptUntil: string }>(`${this.url}/${id}`);
  }

  bringBack(id: number): Observable<UserTable> {
    return this.http.post<UserTable>(`${this.url}/${id}/restore`, {});
  }

  rows(
    id: number,
    query: { q?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; size?: number },
  ): Observable<TableRowsPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '')
        params = params.set(key, String(value));
    }
    return this.http.get<TableRowsPage>(`${this.url}/${id}/rows`, { params });
  }

  addRow(id: number, values: Record<string, unknown>): Observable<TableRow> {
    return this.http.post<TableRow>(`${this.url}/${id}/rows`, { values });
  }

  // updatedAt is the row's time as the page saw it, the same guard as the table's version
  updateRow(
    id: number,
    rowId: number,
    values: Record<string, unknown>,
    updatedAt: string,
  ): Observable<TableRow> {
    return this.http.put<TableRow>(`${this.url}/${id}/rows/${rowId}`, { values, updatedAt });
  }

  deleteRow(id: number, rowId: number): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.url}/${id}/rows/${rowId}`);
  }

  exportCsv(id: number, fallbackName: string): Observable<void> {
    return this.industries.downloadFile(`${this.url}/${id}/export.csv`, fallbackName);
  }
}
