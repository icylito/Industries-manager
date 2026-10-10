// The one name rule, the same as the API's (api_v2/Rules/Names.cs) and the database's collation name_rule: two names
// are the same when they match ignoring capital letters, accents, spaces, punctuation and symbols, by ICU, which the
// browser's Intl.Collator uses too. "Acme, Inc.", "ACME inc" and "acme-inc" are one name; Hindi "काम" and "कम" are
// two. The API decides; the page uses this to say so sooner. testing/check_names.py holds the same examples.
const collator = new Intl.Collator('und', { sensitivity: 'base', ignorePunctuation: true });
// The collator leaves symbols and currency signs in, the database's rule (kv-currency) ignores them
const plain = (name: string | null | undefined) => (name ?? '').replace(/\p{S}/gu, '');

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return collator.compare(plain(a), plain(b)) === 0;
}

// A name of only symbols, spaces or punctuation is no name at all
export function hasNoLetters(name: string | null | undefined): boolean {
  return sameName(name, '');
}
