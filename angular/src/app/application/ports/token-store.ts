// Where the sign in token is kept between visits. infrastructure/token-store.ts keeps it in this browser's storage.
export abstract class TokenStore {
  abstract load(): string | null;
  abstract save(token: string | null): void;
}
