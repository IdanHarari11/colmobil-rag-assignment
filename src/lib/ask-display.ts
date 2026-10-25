import type {
  AnswerPart,
  AnswerStatus,
  AskResult,
  Citation,
  ContextOrigin,
} from "@/rag/ask-types";

/** Max user question length accepted by POST /api/ask (characters). */
export const ASK_MAX_QUESTION_CHARS = 2000;

/** Structured payload for the chat UI — not the full ask() diagnostics object. */
export interface AskDisplaySource {
  chunkId: string;
  documentId: string;
  fileName: string;
  relativePath: string;
  documentTitle?: string;
  /** Verified manifest versionLabel when known; omit on legacy stored messages. */
  versionLabel?: string;
  sectionPath?: string[];
  pages?: number[];
  /**
   * Chunk body from the index/context (citation text).
   * Never includes retrieval aliases or computed temporal fact blocks.
   */
  text: string;
  origin: ContextOrigin;
  claims: string[];
}

export interface AskDisplayResponse {
  /** Server ask-trace id (also returned on API errors). */
  requestId: string;
  status: AnswerStatus;
  answer: string;
  answerParts: AnswerPart[];
  citations: Citation[];
  /** Only sources that were cited in answerParts. */
  sources: AskDisplaySource[];
  generationModel: string;
  retrievalMode: string;
}

export const ASK_CUSTOM_METADATA_KEY = "rag" as const;

export type AskMessageCustom = {
  [ASK_CUSTOM_METADATA_KEY]: AskDisplayResponse;
};

/**
 * Map ask() result to a browser-safe display DTO.
 * Omits retrieved-but-uncited chunks and diagnostic context dumps.
 */
export function toAskDisplayResponse(result: AskResult): AskDisplayResponse {
  const textById = new Map(
    result.contextChunks.map((c) => [c.chunkId, c.text] as const),
  );

  const sources: AskDisplaySource[] = result.sources.map((source) => ({
    chunkId: source.chunkId,
    documentId: source.documentId,
    fileName: source.fileName,
    relativePath: source.relativePath,
    documentTitle: source.documentTitle,
    ...(source.versionLabel ? { versionLabel: source.versionLabel } : {}),
    sectionPath: source.sectionPath,
    pages: source.pages,
    text: textById.get(source.chunkId) ?? "",
    origin: source.origin,
    claims: source.claims,
  }));

  return {
    requestId: result.requestId,
    status: result.status,
    answer: result.answer,
    answerParts: result.answerParts,
    citations: result.citations,
    sources,
    generationModel: result.generationModel,
    retrievalMode: result.retrievalMode,
  };
}

export function isAskDisplayResponse(value: unknown): value is AskDisplayResponse {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.requestId === "string" &&
    obj.requestId.length > 0 &&
    typeof obj.status === "string" &&
    typeof obj.answer === "string" &&
    Array.isArray(obj.answerParts) &&
    Array.isArray(obj.sources)
  );
}
