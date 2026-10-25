/**
 * Consistent tokenizer for BM25 over Hebrew/English insurance text.
 *
 * - Unicode NFKC normalization
 * - English lowercasing only (Hebrew has no case)
 * - Punctuation / symbols → whitespace separators
 * - Keeps Hebrew letters, Latin letters, and digits (incl. forms like 1,100 → split or kept?)
 *
 * Limitations (documented, intentional for this experiment):
 * - No stemming / lemmatization: "גרירה" and "גרירות" are distinct tokens.
 * - No synonym dictionary or query expansion.
 * - Commas inside numbers are treated as separators, so "1,100" → ["1","100"].
 * - Apostrophes / geresh in Hebrew abbreviations may split tokens.
 */
export const BM25_TOKENIZER_NOTES = [
  "NFKC + English lowercase; punctuation becomes separators.",
  "Hebrew/Latin letters and digits are kept; no stemming or synonyms.",
  '"גרירה" vs "גרירות" are different tokens — exact match is not morphology-aware.',
  "Numeric commas split values (e.g. 1,100 → 1 and 100).",
] as const;

const SEPARATOR_RE = /[^\p{L}\p{N}]+/u;

export function tokenizeForBm25(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  return normalized
    .split(SEPARATOR_RE)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
