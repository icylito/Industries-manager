import { Observable } from 'rxjs';
import { AuthUser } from '../../domain/models/industry';

// The signed in person's name and picture on the API. infrastructure/profile-api.ts calls HTTP for it.
export abstract class ProfileGateway {
  abstract saveName(displayName: string | null): Observable<AuthUser>;
  abstract savePicture(picture: Blob): Observable<AuthUser>;
  abstract removePicture(): Observable<AuthUser>;
  abstract picture(): Observable<Blob>;
}
