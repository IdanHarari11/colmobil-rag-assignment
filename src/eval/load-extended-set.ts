import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DevQuestion } from "./run-retrieval-eval";

export interface ExtendedEvidence {
  fileName: string;
  chunkId: string;
  quoteSnippet: string;
}

export interface ExtendedEvalQuestion {
  id: string;
  category: string;
  tags?: string[];
  question: string;
  expectedBehavior: string;
  materialFacts: string[];
  evidence: ExtendedEvidence[];
  acceptableSourceAlternatives: string[][];
  reference_answer: string;
  forbiddenAssumptions: string[];
  sources: string[];
  crossLingualNote?: string;
}

export interface ExtendedEvalSet {
  schemaVersion: number;
  setId: string;
  title: string;
  notes: string[];
  questions: ExtendedEvalQuestion[];
}

export function defaultExtendedSetPath(rootDir = process.cwd()): string {
  return path.join(rootDir, "dev_set", "extended_eval_stage6.json");
}

export function defaultExtendedSetHashPath(rootDir = process.cwd()): string {
  return path.join(rootDir, "dev_set", "extended_eval_stage6.sha256");
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Load the Stage 6 holdout set and verify it matches the frozen SHA-256 sidecar.
 * Throws if the file was modified after freeze (silent edits are not allowed).
 */
export async function loadExtendedEvalSet(options?: {
  setPath?: string;
  hashPath?: string;
  /** When false, skip hash check (tests only). */
  verifyHash?: boolean;
}): Promise<{
  set: ExtendedEvalSet;
  setPath: string;
  contentSha256: string;
  hashMatched: boolean;
}> {
  const setPath = options?.setPath ?? defaultExtendedSetPath();
  const hashPath = options?.hashPath ?? defaultExtendedSetHashPath();
  const raw = await readFile(setPath);
  const contentSha256 = sha256Hex(raw);
  let hashMatched = true;
  if (options?.verifyHash !== false) {
    const expected = (await readFile(hashPath, "utf8")).trim();
    if (expected !== contentSha256) {
      throw new Error(
        `Extended eval set hash mismatch.\n` +
          `  file: ${setPath}\n` +
          `  expected (freeze): ${expected}\n` +
          `  actual: ${contentSha256}\n` +
          `Document a versioned correction — do not silently edit.`,
      );
    }
  } else {
    hashMatched = false;
  }

  const set = JSON.parse(raw.toString("utf8")) as ExtendedEvalSet;
  if (!Array.isArray(set.questions) || set.questions.length === 0) {
    throw new Error("Extended eval set has no questions.");
  }
  return { set, setPath, contentSha256, hashMatched };
}

/** Map to the minimal DevQuestion shape used by ask/retrieval runners. */
export function toDevQuestions(
  questions: readonly ExtendedEvalQuestion[],
): DevQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    category: q.category,
    question: q.question,
    reference_answer: q.reference_answer,
    sources: q.sources,
  }));
}
