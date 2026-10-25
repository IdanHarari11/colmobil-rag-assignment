import type { ContextChunk } from "../ask-types";
import type {
  ApplicabilitySummary,
  ActivatedRelationship,
  VersionDecision,
} from "./types";
import { findVerifiedSpan } from "./section-spans";

export interface PartialUpdateSectionBinding {
  baseDocumentId: string;
  updateDocumentId: string;
  sectionName: string;
  /** Inclusive start date of the replacement when known from the update doc. */
  replacementFrom?: string;
}

/**
 * Derive section-level partial-update bindings from applicability metadata.
 * Uses relationship `affectedSections` (manifest evidence), not string guessing on amounts.
 */
export function collectPartialUpdateBindings(
  applicability: ApplicabilitySummary | undefined,
): PartialUpdateSectionBinding[] {
  if (!applicability) return [];
  const decisions = applicability.versionDecisions.filter(
    (d) => d.status === "partial_update" && d.selectedDocumentId,
  );
  if (decisions.length === 0) return [];

  const bindings: PartialUpdateSectionBinding[] = [];
  for (const decision of decisions) {
    const updateId = decision.selectedDocumentId!;
    const baseIds = decision.alternativeDocumentIds;
    const sections = sectionsForPartialUpdate(
      decision,
      applicability.activatedRelationships,
    );
    for (const baseId of baseIds) {
      for (const sectionName of sections) {
        bindings.push({
          baseDocumentId: baseId,
          updateDocumentId: updateId,
          sectionName,
          replacementFrom: replacementStartHint(decision),
        });
      }
    }
  }
  return bindings;
}

function sectionsForPartialUpdate(
  decision: VersionDecision,
  relationships: ActivatedRelationship[],
): string[] {
  const names = new Set<string>();
  for (const rel of relationships) {
    const touches =
      rel.fromDocumentId === decision.selectedDocumentId ||
      rel.toDocumentId === decision.selectedDocumentId ||
      decision.alternativeDocumentIds.includes(rel.fromDocumentId) ||
      decision.alternativeDocumentIds.includes(rel.toDocumentId);
    if (!touches) continue;
    if (
      rel.type !== "partially_updates" &&
      rel.type !== "partially_updated_by"
    ) {
      continue;
    }
    for (const s of rel.affectedSections ?? []) {
      if (s.trim()) names.add(s.trim());
    }
  }
  return [...names];
}

function replacementStartHint(decision: VersionDecision): string | undefined {
  // Cancellation update is documented as in force from 2025-01-01 in the corpus/manifest.
  if (decision.documentFamily === "cancellation_procedure") {
    return "2025-01-01";
  }
  return undefined;
}

/**
 * Annotate packed source text for the generator without mutating citation bodies.
 * - Base doc: mark listed sections as superseded (text kept for provenance/history).
 * - Update doc: mark as the current replacement for those sections.
 * Does not delete corpus text and does not strip amounts by regex.
 */
export function annotateChunksForPartialUpdates(
  chunks: readonly ContextChunk[],
  applicability: ApplicabilitySummary | undefined,
): ContextChunk[] {
  const bindings = collectPartialUpdateBindings(applicability);
  if (bindings.length === 0) return [...chunks];

  return chunks.map((chunk) => {
    const asBase = bindings.filter((b) => b.baseDocumentId === chunk.documentId);
    const asUpdate = bindings.filter(
      (b) => b.updateDocumentId === chunk.documentId,
    );
    if (asBase.length === 0 && asUpdate.length === 0) return chunk;

    let text = chunk.text;
    const headerLines: string[] = [];

    if (asBase.length > 0) {
      const sections = [...new Set(asBase.map((b) => b.sectionName))];
      const updateId = asBase[0]!.updateDocumentId;
      const from = asBase[0]!.replacementFrom;
      headerLines.push(
        "[Partial-update applicability — BASE document]",
        `- Still in force except superseded section(s): ${sections.join("; ")}`,
        `- Superseded section(s) below are former wording only (not the current rule` +
          (from ? ` for cases on/after ${from}` : "") +
          `).`,
        `- Current replacement: ${updateId} (cite the replacement chunk for current refund-calculation rules).`,
        `- Other sections in this document remain binding when this partial update applies.`,
      );
      for (const sectionName of sections) {
        const binding = asBase.find((b) => b.sectionName === sectionName)!;
        text = wrapSupersededSection(text, sectionName, binding);
      }
    }

    if (asUpdate.length > 0) {
      const sections = [...new Set(asUpdate.map((b) => b.sectionName))];
      const baseId = asUpdate[0]!.baseDocumentId;
      const from = asUpdate[0]!.replacementFrom;
      headerLines.push(
        "[Partial-update applicability — REPLACEMENT document]",
        `- Role: current replacement for section(s) ${sections.join("; ")} of ${baseId}` +
          (from ? ` (from ${from})` : "") +
          ".",
        `- Use this source for the current rule on those section(s); do not also apply the superseded base wording as current.`,
        `- Unreplaced sections of the base document remain in force.`,
      );
    }

    const annotatedText =
      headerLines.length > 0
        ? `${headerLines.join("\n")}\n\n${text}`
        : text;

    return { ...chunk, text: annotatedText };
  });
}

/**
 * Wrap a named heading section in the chunk body.
 * Matches a heading line that equals / contains the section title, until the next
 * sibling-style heading (Hebrew/English heading heuristics on blank-line boundaries).
 */
export function wrapSupersededSection(
  text: string,
  sectionName: string,
  binding: PartialUpdateSectionBinding,
): string {
  const open =
    `<<<SUPERSEDED_SECTION name="${sectionName}" ` +
    `replaced_by="${binding.updateDocumentId}"` +
    (binding.replacementFrom
      ? ` effective_replacement_from="${binding.replacementFrom}"`
      : "") +
    ` status="former_rule_only">>>`;
  const close = `<<<END_SUPERSEDED_SECTION name="${sectionName}">>>`;

  const byHeading = wrapByHeading(text, sectionName, open, close);
  if (byHeading) return byHeading;

  const span = findVerifiedSpan(binding.baseDocumentId, sectionName);
  if (span) {
    const byQuote = wrapByInclusiveQuotes(
      text,
      span.startInclusive,
      span.endInclusive,
      open,
      close,
    );
    if (byQuote) return byQuote;
  }

  // Section not located in body — keep text; document-level header still warns.
  return text;
}

function wrapByHeading(
  text: string,
  sectionName: string,
  open: string,
  close: string,
): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => isSectionHeadingLine(line, sectionName));
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isLikelyNextSectionHeading(lines[i]!, sectionName)) {
      end = i;
      break;
    }
  }

  return [
    ...lines.slice(0, start),
    open,
    ...lines.slice(start, end),
    close,
    ...lines.slice(end),
  ].join("\n");
}

function wrapByInclusiveQuotes(
  text: string,
  startInclusive: string,
  endInclusive: string,
  open: string,
  close: string,
): string | null {
  const start = text.indexOf(startInclusive);
  if (start < 0) return null;
  const end = text.indexOf(endInclusive, start);
  if (end < 0) return null;
  const endPos = end + endInclusive.length;
  return (
    text.slice(0, start) +
    `${open}\n` +
    text.slice(start, endPos) +
    `\n${close}` +
    text.slice(endPos)
  );
}

function isSectionHeadingLine(line: string, sectionName: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Exact heading or markdown heading containing the section title.
  if (trimmed === sectionName) return true;
  if (trimmed === `## ${sectionName}` || trimmed === `# ${sectionName}`) {
    return true;
  }
  // Chunk packer sometimes emits "סעיף: … > חישוב ההחזר" — require section as final segment.
  if (trimmed.endsWith(sectionName) && trimmed.includes(sectionName)) {
    // Avoid matching body bullets that merely mention the words.
    if (/^[-*]/.test(trimmed)) return false;
    if (trimmed.length > sectionName.length + 40) return false;
    return true;
  }
  return false;
}

function isLikelyNextSectionHeading(
  line: string,
  currentSectionName: string,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed === currentSectionName) return false;
  // Next markdown heading
  if (/^#{1,3}\s+\S/.test(trimmed)) return true;
  // Bare short title line (Hebrew section headings in this corpus are short, no trailing period)
  if (
    trimmed.length <= 40 &&
    !/^[-*]/.test(trimmed) &&
    !trimmed.includes("|") &&
    !/[.!?׃:]$/.test(trimmed) &&
    !/^\d/.test(trimmed) &&
    /^[\p{L}\p{N}\s"'״\-–—]+$/u.test(trimmed)
  ) {
    // Exclude lines that look like list continuations / long prose
    const words = trimmed.split(/\s+/).length;
    return words >= 1 && words <= 6;
  }
  return false;
}
