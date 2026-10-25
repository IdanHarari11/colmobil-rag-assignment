/**
 * Verified in-chunk spans for partial-update sections.
 * Quotes are copied from corpus/parsed blocks (not answer amounts).
 * Used when chunk text dropped intermediate headings during packing.
 *
 * Validation: unit tests assert each span still occurs in the indexed chunk text.
 */

export interface VerifiedSectionSpan {
  sectionName: string;
  /** First line of the section body as it appears in the indexed chunk. */
  startInclusive: string;
  /** Last line of the section body as it appears in the indexed chunk. */
  endInclusive: string;
}

export const VERIFIED_PARTIAL_UPDATE_SECTION_SPANS: Record<
  string,
  VerifiedSectionSpan[]
> = {
  "corpus/22_cancellation_procedure_2023": [
    {
      sectionName: "חישוב ההחזר",
      startInclusive:
        "- ההחזר מחושב באופן יחסי לתקופה שנותרה עד תום תקופת הביטוח (pro-rata).",
      endInclusive:
        "- ההחזר יועבר לאמצעי התשלום המקורי, או לחשבון בנק לפי טופס 4410, בתוך 14 ימי עסקים.",
    },
  ],
};

export function findVerifiedSpan(
  documentId: string,
  sectionName: string,
): VerifiedSectionSpan | undefined {
  return VERIFIED_PARTIAL_UPDATE_SECTION_SPANS[documentId]?.find(
    (s) => s.sectionName === sectionName,
  );
}
