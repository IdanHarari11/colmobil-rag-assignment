export {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  INDEX_FORMAT_VERSION,
  IndexMismatchError,
  MissingApiKeyError,
} from "./types";
export type {
  EmbeddingConfig,
  IndexManifest,
  IndexedChunk,
  LocalIndex,
  RetrievalHit,
  RetrieveMode,
  RetrieveOptions,
  RetrieveResult,
} from "./types";

export { loadEnv, getEmbeddingConfig, getOpenAiApiKey } from "./env";
export { buildEmbeddingText } from "./embedding-text";
export { cosineSimilarity, rankByCosine } from "./cosine";
export { createOpenAiEmbedder } from "./embedder";
export type { Embedder, EmbedBatchResult } from "./embedder";
export {
  assertIndexCompatible,
  canReuseIndex,
  loadChunksFile,
  loadValidatedIndex,
  readLocalIndex,
  writeLocalIndex,
} from "./index-store";
export { buildLocalIndex, buildIndexFromVectors, ensureIndexReady } from "./build-index";
export { retrieve, HYBRID_EXPERIMENT_CONFIG } from "./retrieve";
export { buildBm25Index, BM25_DEFAULTS } from "./bm25";
export { fuseRrf, RRF_DEFAULT_C } from "./rrf";
export { tokenizeForBm25, BM25_TOKENIZER_NOTES } from "./tokenize";
export { defaultChunksPath, defaultIndexPath, defaultEvalDir } from "./paths";

export { ask } from "./ask";
export type { AskOptions, AskDependencies } from "./ask";
export {
  DOCUMENT_RELATIONS_MANIFEST_VERSION,
  defaultManifestPath,
  loadDocumentRelationsManifest,
  validateManifestAgainstIndex,
  getValidatedManifest,
  extractUserTemporalFacts,
  resolveVersionDecisions,
  buildEnrichedGenerationContext,
  ManifestValidationError,
} from "./document-relations";
export type {
  DocumentRelationsManifest,
  ApplicabilitySummary,
  UserTemporalFacts,
  VersionDecision,
} from "./document-relations";
// Trace writer/session (used by ask). Reader CLI imports from ./trace/read directly
// so Next.js routes that import @/rag do not pull filesystem log scanning.
export {
  TRACE_SCHEMA_VERSION,
  TRACE_LOG_POLICY,
  TRACE_SCOPE_NOTE,
  createRequestId,
  AskTraceSession,
  JsonlTraceWriter,
  MemoryTraceWriter,
  getDefaultTraceWriter,
  toTraceTokenUsage,
  isAbortError,
  safeErrorCode,
} from "./trace";
export type {
  TraceEvent,
  TraceOutcome,
  TraceStageName,
  TraceTokenUsage,
  TraceWriter,
  TraceSource,
} from "./trace";
export {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  CONTEXT_BUDGET_NOTES,
  buildGenerationContext,
  formatContextForPrompt,
  allowedChunkIds,
} from "./context-builder";
export {
  DEFAULT_GENERATION_MODEL,
  GENERATION_MODEL_NOTES,
  getGenerationModel,
  generateGroundedAnswer,
  parseModelGenerationPayload,
  buildSystemPrompt,
  buildUserPrompt,
} from "./generate";
export {
  buildComputedTemporalFacts,
  calendarDaysBetween,
  formatComputedTemporalFactsForPrompt,
  userTextsForTemporalExtraction,
} from "./temporal";
export type {
  ComputedTemporalFacts,
  DatedEvent,
  DatedEventKind,
  TemporalDaySpan,
} from "./temporal";
export {
  chatCompletionSamplingForModel,
  toChatCompletionRequestFields,
  usesClassicSampling,
  usesReasoningFamilyParams,
} from "./model-request-params";
export type {
  ChatCompletionSamplingProfile,
  ModelCallMeta,
  ReasoningEffort,
} from "./model-request-params";
export {
  HISTORY_MAX_TURNS,
  HISTORY_MAX_TOTAL_CHARS,
  HISTORY_MAX_MESSAGE_CHARS,
  HISTORY_WINDOW_NOTES,
  HistoryValidationError,
  parseAndValidateHistory,
  applyHistoryWindow,
  formatHistoryForPrompt,
} from "./history";
export type { ChatHistoryMessage, ChatHistoryRole } from "./history";
export {
  rewriteQuery,
  parseRewritePayload,
  RewriteSystemError,
  REWRITE_SYSTEM_PROMPT,
} from "./rewrite-query";
export type { RewriteQueryResult } from "./rewrite-query";
export { assembleAnswerFromParts } from "./validate-answer";
// clarify.ts exists as historical Stage 5.2 experiment — not exported on the active path.
export {
  GenerationSystemError,
  NEUTRAL_INSUFFICIENT_ANSWER,
} from "./ask-types";
export type {
  AnswerStatus,
  AnswerSource,
  AnswerPart,
  AskResult,
  AskRewriteDiagnostics,
  Citation,
  ContextChunk,
  ContextBuildResult,
  ContextOrigin,
  ModelGenerationPayload,
} from "./ask-types";
export {
  isAnswerReviewEnabled,
  runAnswerReviewPipeline,
  reviewAnswerDraft,
  reviseAnswerDraft,
  parseReviewResultPayload,
  shouldAttemptRevision,
  AnswerReviewFailedError,
  AnswerReviewSystemError,
  MAX_REVIEW_ATTEMPTS,
  MAX_REVISION_ATTEMPTS,
  REVIEW_PROBLEM_TYPES,
} from "./answer-review";
export type {
  AnswerReviewMeta,
  AnswerReviewOutcome,
  ReviewFinding,
  ReviewProblemType,
  ReviewResultPayload,
} from "./answer-review";
