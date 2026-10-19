import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthGateway } from '../application/ports/auth-gateway';
import { AuthUser, LoginResult } from '../domain/models/industry';
import { environment } from '../../environments/environment';

@Service()
export class AuthApi implements AuthGateway {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/auth`;

  me(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${this.url}/me`);
  }

  login(username: string, password: string): Observable<LoginResult> {
    return this.http.post<LoginResult>(`${this.url}/login`, { username, password });
  }

  changePassword(current: string, next: string): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${this.url}/password`, { current, new: next });
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.url}/logout`, {});
  }
}
