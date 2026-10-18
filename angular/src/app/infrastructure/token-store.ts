// Where the sign in token is kept. Storage can be blocked (private window, blocked site data), so a copy also
// lives in memory for this visit; the page still works, the person just signs in again next time.
const TOKEN_KEY = 'stock-listing-token';

let memoryToken: string | null = null;

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function saveToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Blocked storage, the token stays in memory for this visit only
  }
}
