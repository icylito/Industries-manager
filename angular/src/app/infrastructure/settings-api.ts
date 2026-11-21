import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SettingsGateway } from '../application/ports/settings-gateway';
import { MySettings } from '../domain/models/settings';
import { environment } from '../../environments/environment';

@Service()
export class SettingsApi implements SettingsGateway {
  private http = inject(HttpClient);
  private url = environment.apiUrl + '/me/settings';

  load(): Observable<MySettings & { updatedAt: string | null }> {
    return this.http.get<MySettings & { updatedAt: string | null }>(this.url);
  }

  save(settings: MySettings): Observable<unknown> {
    return this.http.put(this.url, settings);
  }
}
