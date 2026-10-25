/**
 * Corpus-grounded retrieval aliases appended to embeddingText for search only.
 *
 * These strings are NOT part of the chunk body shown for citation
 * (`formatContextForPrompt` uses `chunk.text`, not embeddingText).
 *
 * Each alias is justified by terms/concepts that already appear in that
 * document's corpus text (or are the natural Hebrew bridge for an English-only
 * FAQ phrase). No eval question IDs and no canned answers.
 *
 * Rationale (closure round): one general retrieval change —
 * bilingual / paraphrase bridge for known lexical gaps (EN agent FAQ;
 * Hebrew "תקרה" vs corpus "גבול אחריות" on home contents limits).
 */

/** documentId → search-only alias lines. */
export const RETRIEVAL_ALIASES_BY_DOCUMENT_ID: Readonly<
  Record<string, readonly string[]>
> = {
  /**
   * Source: corpus/30_agent_faq_en.md — commission clawback / agent discount
   * questions are English-only; Hebrew agent questions need lexical bridge.
   *
   * BM25 has no Hebrew stemming ("עמלת"≠"עמלה", "ביטל"≠"ביטול"), so aliases
   * include both construct-state and free-form surface tokens that users use
   * when asking about the same corpus facts (commission clawback; 120-day rule).
   */
  "corpus/30_agent_faq_en": [
    "עמלת סוכן",
    "עמלה",
    "העמלה שלי",
    "עמלה שלי",
    "החזרת עמלה",
    "clawback עמלה",
    "agent commission clawback",
    "ביטול פוליסה עמלה סוכן",
    "ביטל פוליסה עמלה",
    "סוכן ביטוח עמלה",
    "הנחת סוכן",
    "120 ימים עמלה",
    "clawback מלא",
    "pro-rata clawback",
    // Hebrew paraphrase of the EN FAQ clawback Q&A (search-only; not cited body).
    "מה קורה לעמלה שלי אם הלקוח ביטל פוליסה",
    "ביטול תוך 120 ימים מההנפקה — clawback מלא של עמלת הסוכן",
    "ביטול בין 121 ימים ל-12 חודשים — clawback יחסי pro-rata לעמלת הסוכן",
  ],
  /**
   * Source: corpus/12_home_contents_limits — body uses "גבול אחריות" / "מזומנים";
   * users often ask "תקרת כיסוי למזומנים".
   */
  "corpus/12_home_contents_limits": [
    "תקרת כיסוי",
    "תקרת כיסוי למזומנים",
    "גבול אחריות מזומנים",
    "ביטוח תכולת דירה מזומנים",
  ],
};

export function retrievalAliasesForDocument(
  documentId: string,
): readonly string[] {
  return RETRIEVAL_ALIASES_BY_DOCUMENT_ID[documentId] ?? [];
}
