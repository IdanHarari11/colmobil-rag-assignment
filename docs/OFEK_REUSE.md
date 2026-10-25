# Reuse audit against Ofek

Reference: https://github.com/IdanHarari11/ofek-rag-assignment at `4172304c7497e8b43aa3284d37cb0ff77a9e80bf` (read-only clone, 2026-10-25).

The handoff already includes Ofek's core libraries and utilities: Next.js, React, TypeScript, OpenAI SDK, Tailwind, Lucide, assistant-ui registry components, Vitest, BM25, cosine similarity, RRF, bounded history and query rewriting. `src/rag/embedder.ts` and `build-index.ts` were compared to the reference and are identical. Real indexing uses 64-text batches, text-embedding-3-small/1536, metadata-rich search text, source/index fingerprints and reuse of unchanged embeddings. The index is built offline and bundled with server functions.

The active customer UI preserves the chat/sidebar/composer/source-disclosure layout and shared design tokens. It uses React and Lucide directly to add continuous voice and clear simulated handoff rather than replacing the application with Ofek's insurance UI. Sources come from structured server data and original text, never model-generated HTML. Source cards now have stable numbers within each response and original PDF links. Insurance aliases, policy dates, warranty rules and temporal clocks are not applicable to this vehicle corpus and are not enabled in the active path.

Evaluation follows Ofek's separation of retrieval, answer contracts, behavior, multi-turn history and semantic review. The comparison runner measures lexical/vector/Hybrid on the same questions using one actual query embedding per question. Reports retain denominators and failures; `answered` and valid chunk IDs never mean semantic correctness. Existing exposed cases remain labeled development cases. Configuration hashes and model/index settings accompany new answer reports. A separate conversation runner uses actual generated previous answers instead of only fixture histories.

Ofek's optional model review was off after false blocks/misses in its paired experiment. We have not silently enabled it or copied insurance quality claims. Vehicle safety requires original-manual review and real speech checks. No file, deployment or credential in Ofek was changed.
