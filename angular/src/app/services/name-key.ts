// The one name rule, the same as the API's Names.Key (api_v2/Rules/Names.cs) and the database's name_key: two names
// are the same when they match after ignoring capital letters, accents, spaces, punctuation and symbols, in any
// script. "Acme, Inc.", "ACME inc" and "acme-inc" are one name. The API decides; the page uses this to say so sooner.
export function nameKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
}
