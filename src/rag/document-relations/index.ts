export {
  DOCUMENT_RELATIONS_MANIFEST_VERSION,
} from "./types";
export type {
  ApplicabilitySummary,
  DocumentRelationsManifest,
  ManifestDocument,
  UserTemporalFacts,
  VersionDecision,
  ActivatedRelationship,
} from "./types";
export {
  defaultManifestPath,
  loadDocumentRelationsManifest,
  validateManifestAgainstIndex,
  getValidatedManifest,
  resetManifestCache,
  ManifestValidationError,
} from "./load-manifest";
export {
  extractUserTemporalFacts,
  governingPolicyDate,
  isOnOrAfter,
  isBefore,
} from "./dates";
export {
  resolveVersionDecisions,
  collectActivatedRelationships,
  buildApplicabilitySummary,
  linkedDocumentIdsToFetch,
  demotedDocumentIds,
} from "./resolve";
export {
  countPolicyIssueAnchors,
  isMultiScenarioInSingleText,
  isMultiScenarioPolicyComparison,
} from "./multi-scenario";
export { verifiedVersionLabel } from "./version-label";
export {
  buildEnrichedGenerationContext,
} from "./enrich-context";
export type { EnrichedContextBuildResult, EnrichContextOptions } from "./enrich-context";
export {
  annotateChunksForPartialUpdates,
  collectPartialUpdateBindings,
  wrapSupersededSection,
} from "./annotate-partial-updates";
export type { PartialUpdateSectionBinding } from "./annotate-partial-updates";
export {
  VERIFIED_PARTIAL_UPDATE_SECTION_SPANS,
  findVerifiedSpan,
} from "./section-spans";
