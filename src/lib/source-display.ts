import type { AskDisplaySource } from "./ask-display";

/**
 * User-facing source heading (Hebrew UI).
 * Prefer verified versionLabel from the relations manifest when present;
 * otherwise fall back to fileName (not title alone) so versions are not blurred.
 */
export function sourceDisplayHeading(source: AskDisplaySource): string {
  const version = source.versionLabel?.trim();
  const base =
    source.documentTitle?.trim() ||
    source.fileName ||
    source.relativePath ||
    source.chunkId;

  if (!version) {
    // No verified version metadata — show file name for disambiguation.
    return source.fileName || base;
  }

  const versionHe = formatVersionLabelHe(version);
  if (source.documentTitle?.trim()) {
    return `${source.documentTitle.trim()} · ${versionHe}`;
  }
  return `${source.fileName} · ${versionHe}`;
}

export function formatVersionLabelHe(versionLabel: string): string {
  if (/^\d{4}$/.test(versionLabel)) return `גרסה ${versionLabel}`;
  if (versionLabel === "2025_partial_update") return "עדכון חלקי 2025";
  return versionLabel;
}

export function sourceSectionLabel(source: AskDisplaySource): string | null {
  if (!source.sectionPath?.length) return null;
  const joined = source.sectionPath.filter(Boolean).join(" › ").trim();
  if (!joined) return null;
  // Skip when section metadata only repeats the document title.
  if (joined === source.documentTitle?.trim()) return null;
  return joined;
}

export function sourcePagesLabel(source: AskDisplaySource): string | null {
  if (!source.pages?.length) return null;
  return `עמודים ${source.pages.join(", ")}`;
}
