/**
 * Detect when a question compares multiple independent policy applicability
 * scenarios (not merely issue+renewal of one policy).
 *
 * Not based on raw date count alone: one issue + one renewal is a single scenario.
 */

/**
 * Count distinct "issued / was issued" policy-case anchors in user wording.
 * "הונפקה ב-2024 וחודשה ב-1.4.2026" counts as one issue anchor.
 */
export function countPolicyIssueAnchors(text: string): number {
  const matches = text.matchAll(/הונפק[הו]?|שהונפק[הת]?/g);
  return [...matches].length;
}

/**
 * True when a single question text compares more than one independent
 * issue-or-renewal scenario (not merely issue+renewal of one policy).
 */
export function isMultiScenarioInSingleText(text: string): boolean {
  if (!text.trim()) return false;

  const issueAnchors = countPolicyIssueAnchors(text);
  const explicitCompare =
    /בכל אחד מהמקרים|בכל מקרה מהבאים|השווה בין|השוו בין|לעומת המקרים|שלוש(?:ה)?\s+פוליס/.test(
      text,
    );

  // Explicit multi-case framing with at least one issue anchor → treat as multi.
  if (explicitCompare && issueAnchors >= 1) return true;

  // Two or more separate "הונפקה" anchors → independent scenarios (not just renewal).
  if (issueAnchors >= 2) return true;

  return false;
}

/**
 * True when the user asks to apply / compare more than one independent
 * issue-or-renewal scenario in one question.
 *
 * Evaluates each text independently (OR). Do not join original + standalone:
 * both usually repeat the same scenario and would falsely double issue anchors
 * (e.g. single issue+renewal, or a conversation correction restated once).
 */
export function isMultiScenarioPolicyComparison(
  texts: readonly string[],
): boolean {
  return texts.some((text) => isMultiScenarioInSingleText(text));
}
