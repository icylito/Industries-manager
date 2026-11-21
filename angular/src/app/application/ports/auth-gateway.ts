import { Observable } from 'rxjs';
import { AuthUser, LoginResult } from '../../domain/models/industry';

// Signing in and out on the API. infrastructure/auth-api.ts calls HTTP for it.
export abstract class AuthGateway {
  abstract me(): Observable<AuthUser>;
  abstract login(username: string, password: string): Observable<LoginResult>;
  abstract changePassword(current: string, next: string): Observable<AuthUser>;
  abstract logout(): Observable<unknown>;
}
