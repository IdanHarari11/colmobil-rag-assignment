import path from "node:path";
import type {
  AnswerPart,
  AnswerSource,
  AnswerStatus,
  Citation,
  ContextChunk,
  ModelGenerationPayload,
} from "./ask-types";
import {
  GenerationSystemError,
  NEUTRAL_INSUFFICIENT_ANSWER,
} from "./ask-types";
import { allowedChunkIds } from "./context-builder";
import { verifiedVersionLabel } from "./document-relations/version-label";

export interface AssembledAnswer {
  status: AnswerStatus;
  answer: string;
  answerParts: AnswerPart[];
  citations: Citation[];
  sources: AnswerSource[];
  citationsOk: boolean;
  invalidCitationIds: string[];
}

/**
 * Assemble answer + citations exclusively from answerParts.
 * Invalid / missing source ids on factual parts → GenerationSystemError.
 * Semantic support of text by chunk is NOT proven here — evaluation only.
 */
export function assembleAnswerFromParts(
  payload: ModelGenerationPayload,
  contextChunks: ContextChunk[],
): AssembledAnswer {
  if (payload.status === "insufficient_evidence") {
    return {
      status: "insufficient_evidence",
      answer: NEUTRAL_INSUFFICIENT_ANSWER,
      answerParts: [],
      citations: [],
      sources: [],
      citationsOk: true,
      invalidCitationIds: [],
    };
  }

  if (payload.status === "clarification_needed") {
    if (payload.answerParts.length === 0) {
      throw new GenerationSystemError(
        "clarification_needed requires a non-empty clarification answerPart.",
      );
    }
    // Clarification text must not attach source citations.
    const parts = payload.answerParts.map((p) => ({
      text: p.text,
      sourceChunkIds: [] as string[],
    }));
    return {
      status: "clarification_needed",
      answer: parts.map((p) => p.text).join("\n\n"),
      answerParts: parts,
      citations: [],
      sources: [],
      citationsOk: true,
      invalidCitationIds: [],
    };
  }

  if (payload.answerParts.length === 0) {
    throw new GenerationSystemError(
      "answered status requires at least one non-empty answerPart.",
    );
  }

  const allowed = allowedChunkIds(contextChunks);
  const byId = new Map(contextChunks.map((c) => [c.chunkId, c]));
  const invalidCitationIds: string[] = [];

  for (const [index, part] of payload.answerParts.entries()) {
    if (part.sourceChunkIds.length === 0) {
      throw new GenerationSystemError(
        `Factual answerPart ${index} has no sourceChunkIds — cannot treat as verified.`,
      );
    }
    for (const id of part.sourceChunkIds) {
      if (!allowed.has(id)) {
        invalidCitationIds.push(id);
      }
    }
  }

  if (invalidCitationIds.length > 0) {
    throw new GenerationSystemError(
      `answerParts cite chunkIds not in supplied context: ${[...new Set(invalidCitationIds)].join(", ")}`,
    );
  }

  const answer = payload.answerParts.map((p) => p.text).join("\n\n");

  const claimsByChunk = new Map<string, string[]>();
  for (const part of payload.answerParts) {
    for (const id of part.sourceChunkIds) {
      const list = claimsByChunk.get(id) ?? [];
      if (!list.includes(part.text)) list.push(part.text);
      claimsByChunk.set(id, list);
    }
  }

  const citations: Citation[] = [...claimsByChunk.entries()].map(
    ([chunkId, claims]) => ({ chunkId, claims }),
  );

  const sources: AnswerSource[] = citations.map((citation) => {
    const chunk = byId.get(citation.chunkId)!;
    const versionLabel = verifiedVersionLabel(chunk.documentId);
    return {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      relativePath: chunk.relativePath,
      fileName: path.basename(chunk.relativePath),
      documentTitle: chunk.documentTitle,
      ...(versionLabel ? { versionLabel } : {}),
      sectionPath: chunk.sectionPath,
      pages: chunk.pages,
      claims: citation.claims,
      origin: chunk.origin,
    };
  });

  return {
    status: "answered",
    answer,
    answerParts: payload.answerParts,
    citations,
    sources,
    citationsOk: true,
    invalidCitationIds: [],
  };
}
