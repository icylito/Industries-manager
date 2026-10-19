import { Service } from '@angular/core';
import { TokenStore } from '../application/ports/token-store';

// Where the sign in token is kept. Storage can be blocked (private window, blocked site data), so a copy also
// lives in memory for this visit; the page still works, the person just signs in again next time.
const TOKEN_KEY = 'stock-listing-token';

@Service()
export class BrowserTokenStore implements TokenStore {
  private memoryToken: string | null = null;

  load(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  save(token: string | null): void {
    this.memoryToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Blocked storage, the token stays in memory for this visit only
    }
  }
}
