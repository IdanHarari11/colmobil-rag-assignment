import type { ChunkingPolicySnapshot } from "./types";

/**
 * Corpus-tuned defaults (see Stage 3 analysis):
 * - 31/33 docs estimate under ~400 tokens → keep whole.
 * - Only general_terms (~1160) needs prose splitting.
 * - forms_catalog table (~12 rows / ~450 tok) splits for form-level retrieval
 *   with repeated headers — not to pad short docs to a fixed size.
 */
export const CHUNKING_POLICY: ChunkingPolicySnapshot = {
  keepWholeDocumentMaxTokens: 700,
  targetMaxTokens: 700,
  hardMaxTokens: 900,
  overlapTokens: 50,
  tableSplitMinRows: 8,
  tableSplitMinTokens: 350,
  tableRowsPerChunk: 6,
  notes: [
    "Token counts are heuristic estimates (not a model tokenizer).",
    "Do not split short coherent documents solely to hit a fixed size.",
    "Split a table only when it has both many rows and high token mass.",
    "Never cut mid logical table row; repeat headers on table slices.",
    "Do not merge distinct source documents into one chunk.",
  ],
};
