import { Observable } from 'rxjs';
import { MySettings } from '../../domain/models/settings';

// The person's own shortcuts, mouse and theme as the API keeps them. updatedAt is null when nothing was saved yet.
// infrastructure/settings-api.ts calls HTTP for it.
export abstract class SettingsGateway {
  abstract load(): Observable<MySettings & { updatedAt: string | null }>;
  abstract save(settings: MySettings): Observable<unknown>;
}
