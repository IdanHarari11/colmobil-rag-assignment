/**
 * Typed document-relations manifest (Stage 4).
 * Only fields supported by corpus evidence; unknown stays unknown.
 */

export const DOCUMENT_RELATIONS_MANIFEST_VERSION = 1 as const;

export type DocumentRole =
  | "binding_policy"
  | "binding_general_terms"
  | "binding_procedure"
  | "binding_procedure_update"
  | "marketing"
  | "unknown";

export type RelationshipType =
  | "supersedes"
  | "superseded_by"
  | "supplemented_by"
  | "partially_updates"
  | "partially_updated_by"
  | "defers_to";

export type ApplicabilityKind =
  | "issue_or_renewal_on_or_after"
  | "issue_or_renewal_before"
  | "in_force_from"
  | "partial_update_from"
  | "marketing_non_binding"
  | "unknown";

export interface ManifestEvidence {
  chunkIds: string[];
  sourceBlockIds?: string[];
  /** Short supporting quote from the source (for validation/docs — not free-form invention). */
  quoteSnippet: string;
  /** Must match chunk metadata.sourceHash for the primary cited chunk. */
  sourceHash: string;
}

export interface ManifestRelationship {
  type: RelationshipType;
  targetDocumentId: string;
  affectedSections?: string[];
  summary: string;
}

export interface ManifestApplicability {
  kind: ApplicabilityKind;
  inclusiveStartDate?: string;
  exclusiveEndDate?: string;
  affectedSections?: string[];
  summary: string;
}

export interface ManifestDocument {
  documentId: string;
  documentFamily: string;
  versionLabel: string;
  applicability: ManifestApplicability;
  relationships: ManifestRelationship[];
  documentRole?: DocumentRole;
  evidence: ManifestEvidence[];
  /** Document-level sourceHash (typically the primary chunk's hash). */
  sourceHash: string;
}

export interface DocumentRelationsManifest {
  manifestVersion: typeof DOCUMENT_RELATIONS_MANIFEST_VERSION;
  notes?: string[];
  documents: ManifestDocument[];
}

/** Dates explicitly provided by the user (question / rewrite), never inferred from filenames. */
export type UserDateKind = "issue" | "renewal" | "event" | "unspecified";

export interface ParsedUserDate {
  kind: UserDateKind;
  /** ISO date YYYY-MM-DD when day precision is known. */
  isoDate?: string;
  /** YYYY-MM when only month precision is known. */
  yearMonth?: string;
  /** Confidence that the kind classification is explicit in user wording. */
  kindExplicit: boolean;
}

export interface UserTemporalFacts {
  issue?: ParsedUserDate;
  renewal?: ParsedUserDate;
  event?: ParsedUserDate;
  /** Raw signals used for tracing (kinds only — no free user text). */
  dateKindsUsed: UserDateKind[];
}

export type VersionDecisionStatus =
  | "selected"
  | "unresolved"
  | "not_applicable"
  | "partial_update";

export interface VersionDecision {
  documentFamily: string;
  status: VersionDecisionStatus;
  selectedDocumentId?: string;
  alternativeDocumentIds: string[];
  reasonCode: string;
  dateKindUsed?: UserDateKind;
  evidenceChunkIds: string[];
}

export interface ActivatedRelationship {
  type: RelationshipType;
  fromDocumentId: string;
  toDocumentId: string;
  affectedSections?: string[];
  reasonCode: string;
}

export interface ApplicabilitySummary {
  manifestVersion: number;
  userTemporal: {
    hasIssueDate: boolean;
    hasRenewalDate: boolean;
    hasEventDate: boolean;
    dateKindsUsed: UserDateKind[];
  };
  versionDecisions: VersionDecision[];
  activatedRelationships: ActivatedRelationship[];
  unresolvedNotes: string[];
  /** Structured lines for the generation prompt (Hebrew, evidence-referenced). */
  promptLines: string[];
}
