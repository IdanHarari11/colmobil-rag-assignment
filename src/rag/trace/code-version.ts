import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { REVIEW_SYSTEM_PROMPT } from "../answer-review/review";
import { REVISE_SYSTEM_EXTRA } from "../answer-review/revise";
import { REWRITE_SYSTEM_PROMPT } from "../rewrite-query";
import { buildSystemPrompt } from "../generate";
import type { TraceCodeVersion } from "./types";

/**
 * Best-effort code identity. We do not run `git status` (cost / race),
 * so localChangesUnknown stays true unless an explicit env override is set.
 */
export function resolveCodeVersion(rootDir = process.cwd()): TraceCodeVersion {
  const fromEnv =
    process.env.OFEK_CODE_VERSION?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromEnv) {
    return {
      value: fromEnv,
      localChangesUnknown: process.env.OFEK_CODE_DIRTY !== "0",
    };
  }
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
    if (sha) {
      return { value: sha, localChangesUnknown: true };
    }
  } catch {
    // git unavailable
  }
  return { value: "unknown", localChangesUnknown: true };
}

/**
 * Stable id over prompt *constants* (not runtime filled prompts).
 * Changing prompt text changes this hash; we do not log the text itself.
 */
export function resolvePromptBundleId(): string {
  const systemSkeleton = buildSystemPrompt(["__chunk__"]);
  const digest = createHash("sha256")
    .update(REWRITE_SYSTEM_PROMPT)
    .update("\n---\n")
    .update(systemSkeleton)
    .update("\n---\n")
    .update(REVIEW_SYSTEM_PROMPT)
    .update("\n---\n")
    .update(REVISE_SYSTEM_EXTRA)
    .digest("hex")
    .slice(0, 16);
  return `prompt-${digest}`;
}
