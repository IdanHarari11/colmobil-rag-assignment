import { governingPolicyDate, isOnOrAfter } from "./dates";
import { isMultiScenarioPolicyComparison } from "./multi-scenario";
import type {
  ActivatedRelationship,
  ApplicabilitySummary,
  DocumentRelationsManifest,
  ManifestDocument,
  UserTemporalFacts,
  VersionDecision,
} from "./types";

/**
 * Decide which document versions apply given explicit user temporal facts.
 * Never uses event-only dates to pick issue/renewal-gated versions.
 *
 * @param questionTexts — optional user/standalone texts; when a multi-scenario
 * comparison is detected, car comprehensive keeps both versions (no demotion).
 */
export function resolveVersionDecisions(
  manifest: DocumentRelationsManifest,
  facts: UserTemporalFacts,
  relevantDocumentIds: ReadonlySet<string>,
  questionTexts: readonly string[] = [],
): VersionDecision[] {
  const byFamily = new Map<string, ManifestDocument[]>();
  for (const doc of manifest.documents) {
    if (
      !relevantDocumentIds.has(doc.documentId) &&
      !familyTouched(doc, relevantDocumentIds, manifest)
    ) {
      continue;
    }
    const list = byFamily.get(doc.documentFamily) ?? [];
    list.push(doc);
    byFamily.set(doc.documentFamily, list);
  }

  const decisions: VersionDecision[] = [];

  const multiScenario = isMultiScenarioPolicyComparison(questionTexts);

  for (const [family, docs] of byFamily) {
    if (family === "car_comprehensive_policy") {
      decisions.push(resolveCarComprehensive(docs, facts, multiScenario));
      continue;
    }
    if (family === "cancellation_procedure") {
      decisions.push(resolveCancellation(docs, facts));
      continue;
    }
    if (family === "car_marketing") {
      decisions.push({
        documentFamily: family,
        status: "selected",
        selectedDocumentId: docs[0]?.documentId,
        alternativeDocumentIds: [],
        reasonCode: "marketing_non_binding",
        evidenceChunkIds: docs.flatMap((d) =>
          d.evidence.flatMap((e) => e.chunkIds),
        ),
      });
      continue;
    }
    decisions.push({
      documentFamily: family,
      status: "unresolved",
      alternativeDocumentIds: docs.map((d) => d.documentId),
      reasonCode: "no_machine_rule",
      evidenceChunkIds: docs.flatMap((d) =>
        d.evidence.flatMap((e) => e.chunkIds),
      ),
    });
  }

  return decisions;
}

function familyTouched(
  doc: ManifestDocument,
  relevant: ReadonlySet<string>,
  manifest: DocumentRelationsManifest,
): boolean {
  if (relevant.has(doc.documentId)) return true;
  return manifest.documents.some(
    (other) =>
      relevant.has(other.documentId) &&
      other.documentFamily === doc.documentFamily,
  );
}

function resolveCarComprehensive(
  docs: ManifestDocument[],
  facts: UserTemporalFacts,
  multiScenarioComparison: boolean,
): VersionDecision {
  const v2024 = docs.find((d) => d.versionLabel === "2024");
  const v2026 = docs.find((d) => d.versionLabel === "2026");
  const evidenceChunkIds = docs.flatMap((d) =>
    d.evidence.flatMap((e) => e.chunkIds),
  );
  const alternatives = docs.map((d) => d.documentId);

  // Comparison across independent issue/renewal scenarios: do not pick one
  // global version (that would demote the other from generation context).
  if (multiScenarioComparison) {
    return {
      documentFamily: "car_comprehensive_policy",
      status: "unresolved",
      alternativeDocumentIds: alternatives,
      reasonCode: "multi_scenario_comparison_keep_versions",
      evidenceChunkIds,
    };
  }

  const governing = governingPolicyDate(facts);

  if (!governing) {
    return {
      documentFamily: "car_comprehensive_policy",
      status: "unresolved",
      alternativeDocumentIds: alternatives,
      reasonCode: facts.event
        ? "event_date_without_issue_or_renewal"
        : "missing_issue_or_renewal_date",
      dateKindUsed: facts.event ? "event" : undefined,
      evidenceChunkIds,
    };
  }

  const threshold = "2026-03-01";
  const onOrAfter = isOnOrAfter(governing.date, threshold);
  if (onOrAfter === undefined) {
    return {
      documentFamily: "car_comprehensive_policy",
      status: "unresolved",
      alternativeDocumentIds: alternatives,
      reasonCode: "ambiguous_date_precision",
      dateKindUsed: governing.kind,
      evidenceChunkIds,
    };
  }

  if (onOrAfter) {
    return {
      documentFamily: "car_comprehensive_policy",
      status: "selected",
      selectedDocumentId: v2026?.documentId,
      alternativeDocumentIds: v2024 ? [v2024.documentId] : [],
      reasonCode: "issue_or_renewal_on_or_after_2026_03_01",
      dateKindUsed: governing.kind,
      evidenceChunkIds,
    };
  }

  return {
    documentFamily: "car_comprehensive_policy",
    status: "selected",
    selectedDocumentId: v2024?.documentId,
    alternativeDocumentIds: v2026 ? [v2026.documentId] : [],
    reasonCode: "issue_or_renewal_before_2026_03_01",
    dateKindUsed: governing.kind,
    evidenceChunkIds,
  };
}

function resolveCancellation(
  docs: ManifestDocument[],
  facts: UserTemporalFacts,
): VersionDecision {
  const base = docs.find((d) => d.versionLabel === "2023");
  const update = docs.find((d) => d.versionLabel === "2025_partial_update");
  const evidenceChunkIds = docs.flatMap((d) =>
    d.evidence.flatMap((e) => e.chunkIds),
  );

  const when = facts.event ?? facts.issue ?? facts.renewal;
  if (!when) {
    return {
      documentFamily: "cancellation_procedure",
      status: "partial_update",
      selectedDocumentId: update?.documentId,
      alternativeDocumentIds: base ? [base.documentId] : [],
      reasonCode: "partial_update_keep_base_and_update",
      evidenceChunkIds,
    };
  }

  const afterUpdate = isOnOrAfter(when, "2025-01-01");
  if (afterUpdate === false) {
    return {
      documentFamily: "cancellation_procedure",
      status: "selected",
      selectedDocumentId: base?.documentId,
      alternativeDocumentIds: update ? [update.documentId] : [],
      reasonCode: "before_2025_partial_update",
      dateKindUsed: when.kind,
      evidenceChunkIds,
    };
  }

  return {
    documentFamily: "cancellation_procedure",
    status: "partial_update",
    selectedDocumentId: update?.documentId,
    alternativeDocumentIds: base ? [base.documentId] : [],
    reasonCode: "partial_update_refund_section_from_2025",
    dateKindUsed: when.kind,
    evidenceChunkIds,
  };
}

export function collectActivatedRelationships(
  manifest: DocumentRelationsManifest,
  presentDocumentIds: ReadonlySet<string>,
): ActivatedRelationship[] {
  const activated: ActivatedRelationship[] = [];
  const byId = new Map(manifest.documents.map((d) => [d.documentId, d]));

  for (const docId of presentDocumentIds) {
    const doc = byId.get(docId);
    if (!doc) continue;
    for (const rel of doc.relationships) {
      if (!shouldActivateRelationship(rel.type)) continue;
      activated.push({
        type: rel.type,
        fromDocumentId: doc.documentId,
        toDocumentId: rel.targetDocumentId,
        affectedSections: rel.affectedSections,
        reasonCode: `relationship_${rel.type}`,
      });
    }
  }

  const seen = new Set<string>();
  return activated.filter((a) => {
    const key = `${a.type}:${a.fromDocumentId}->${a.toDocumentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldActivateRelationship(type: string): boolean {
  return (
    type === "partially_updates" ||
    type === "partially_updated_by" ||
    type === "supplemented_by" ||
    type === "defers_to" ||
    type === "supersedes" ||
    type === "superseded_by"
  );
}

export function buildApplicabilitySummary(options: {
  manifest: DocumentRelationsManifest;
  facts: UserTemporalFacts;
  decisions: VersionDecision[];
  activatedRelationships: ActivatedRelationship[];
}): ApplicabilitySummary {
  const unresolvedNotes: string[] = [];
  const promptLines: string[] = [
    "Applicability and document-relationship summary (source-based metadata — not a substitute for source text):",
  ];

  for (const d of options.decisions) {
    if (d.status === "unresolved") {
      unresolvedNotes.push(`${d.documentFamily}:${d.reasonCode}`);
      if (d.reasonCode === "multi_scenario_comparison_keep_versions") {
        promptLines.push(
          `- Family ${d.documentFamily}: multi-scenario comparison — keep all listed versions in context and apply each case's own issue/renewal date (${d.reasonCode}). Versions: ${d.alternativeDocumentIds.join(", ") || "(none)"}. Do not apply one case's version to the others. Evidence: ${d.evidenceChunkIds.join(", ")}`,
        );
      } else {
        promptLines.push(
          `- Family ${d.documentFamily}: cannot decide version (${d.reasonCode}). Alternatives: ${d.alternativeDocumentIds.join(", ") || "(none)"}. Evidence: ${d.evidenceChunkIds.join(", ")}`,
        );
      }
    } else if (d.status === "partial_update") {
      const sectionNames = [
        ...new Set(
          options.activatedRelationships
            .filter(
              (r) =>
                (r.type === "partially_updates" ||
                  r.type === "partially_updated_by") &&
                (r.fromDocumentId === d.selectedDocumentId ||
                  r.toDocumentId === d.selectedDocumentId ||
                  d.alternativeDocumentIds.includes(r.fromDocumentId) ||
                  d.alternativeDocumentIds.includes(r.toDocumentId)),
            )
            .flatMap((r) => r.affectedSections ?? []),
        ),
      ];
      const sectionNote = sectionNames.length
        ? ` Replaced section(s): ${sectionNames.join("; ")}.`
        : "";
      promptLines.push(
        `- Family ${d.documentFamily}: partial update — use ${d.selectedDocumentId} for replaced sections; keep ${d.alternativeDocumentIds.join(", ")} for unreplaced sections (${d.reasonCode}).${sectionNote} Do not apply superseded section wording as the current rule. Evidence: ${d.evidenceChunkIds.join(", ")}`,
      );
    } else if (d.status === "selected") {
      promptLines.push(
        `- Family ${d.documentFamily}: selected ${d.selectedDocumentId} (${d.reasonCode}${d.dateKindUsed ? `, dateKind=${d.dateKindUsed}` : ""}). Evidence: ${d.evidenceChunkIds.join(", ")}`,
      );
    }
  }

  for (const rel of options.activatedRelationships) {
    const sections = rel.affectedSections?.length
      ? ` sections: ${rel.affectedSections.join(", ")}`
      : "";
    promptLines.push(
      `- Relationship ${rel.type}: ${rel.fromDocumentId} → ${rel.toDocumentId}${sections}`,
    );
  }

  const marketing = options.manifest.documents.find(
    (d) => d.documentRole === "marketing",
  );
  if (marketing) {
    promptLines.push(
      `- Marketing document ${marketing.documentId}: marketing only; binding terms are the policy conditions and service riders (see evidence in the manifest).`,
    );
  }

  return {
    manifestVersion: options.manifest.manifestVersion,
    userTemporal: {
      hasIssueDate: Boolean(options.facts.issue),
      hasRenewalDate: Boolean(options.facts.renewal),
      hasEventDate: Boolean(options.facts.event),
      dateKindsUsed: options.facts.dateKindsUsed,
    },
    versionDecisions: options.decisions,
    activatedRelationships: options.activatedRelationships,
    unresolvedNotes,
    promptLines,
  };
}

/** Documents that should be pulled into context via relationships. */
export function linkedDocumentIdsToFetch(
  activated: ActivatedRelationship[],
  alreadyPresent: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const rel of activated) {
    for (const id of [rel.fromDocumentId, rel.toDocumentId]) {
      if (!alreadyPresent.has(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function demotedDocumentIds(decisions: VersionDecision[]): Set<string> {
  const demoted = new Set<string>();
  for (const d of decisions) {
    if (d.status === "selected" && d.selectedDocumentId) {
      for (const id of d.alternativeDocumentIds) demoted.add(id);
    }
  }
  return demoted;
}
