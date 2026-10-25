import manifest from "../../../config/document-relations.manifest.json";

/**
 * Verified version labels from the hand-authored relations manifest only.
 * Not inferred from filenames alone — unknown docs return undefined.
 */
const VERSION_BY_DOCUMENT_ID = new Map(
  manifest.documents.map((doc) => [doc.documentId, doc.versionLabel] as const),
);

export function verifiedVersionLabel(
  documentId: string,
): string | undefined {
  return VERSION_BY_DOCUMENT_ID.get(documentId);
}
