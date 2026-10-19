import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProfileGateway } from '../application/ports/profile-gateway';
import { AuthUser } from '../domain/models/industry';
import { environment } from '../../environments/environment';

@Service()
export class ProfileApi implements ProfileGateway {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/me`;

  saveName(displayName: string | null): Observable<AuthUser> {
    return this.http.put<AuthUser>(`${this.url}/profile`, { displayName });
  }

  savePicture(picture: Blob): Observable<AuthUser> {
    return this.http.put<AuthUser>(`${this.url}/avatar`, picture, {
      headers: { 'Content-Type': picture.type },
    });
  }

  removePicture(): Observable<AuthUser> {
    return this.http.delete<AuthUser>(`${this.url}/avatar`);
  }

  // Fetched with the sign in, so the page holds it as a blob address
  picture(): Observable<Blob> {
    return this.http.get(`${this.url}/avatar`, { responseType: 'blob' });
  }
}
