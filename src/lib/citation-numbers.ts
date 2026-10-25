import type { AnswerPart } from "@/rag/ask-types";
import type { AskDisplaySource } from "./ask-display";

/**
 * Stable citation numbers for one assistant answer.
 * First appearance in answerParts wins; repeated chunkIds reuse the same number.
 * Cited sources missing from parts (should be rare) are appended in list order.
 */
export function buildCitationNumberMap(
  answerParts: readonly AnswerPart[],
  sources: readonly AskDisplaySource[],
): Map<string, number> {
  const known = new Set(sources.map((s) => s.chunkId));
  const map = new Map<string, number>();
  let next = 1;

  for (const part of answerParts) {
    for (const chunkId of part.sourceChunkIds) {
      if (!known.has(chunkId) || map.has(chunkId)) continue;
      map.set(chunkId, next);
      next += 1;
    }
  }

  for (const source of sources) {
    if (map.has(source.chunkId)) continue;
    map.set(source.chunkId, next);
    next += 1;
  }

  return map;
}
