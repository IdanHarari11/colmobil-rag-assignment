import path from "node:path";
import { loadEnv, TRACE_LOG_POLICY } from "../src/rag";
import {
  loadTraceEvents,
  summarizeTraceEvents,
} from "../src/rag/trace/read";

const ROOT = process.cwd();

async function main(): Promise<void> {
  loadEnv(ROOT);
  const requestId = process.argv
    .slice(2)
    .filter((a) => a !== "--")
    .join(" ")
    .trim();
  if (!requestId) {
    console.error(
      `Usage: pnpm trace -- <requestId>\nLogs: ${TRACE_LOG_POLICY.directoryRelative}/${TRACE_LOG_POLICY.activeFileName}`,
    );
    process.exitCode = 1;
    return;
  }

  const dir = path.join(ROOT, TRACE_LOG_POLICY.directoryRelative);
  const events = await loadTraceEvents(requestId, dir);
  const summary = summarizeTraceEvents(events);
  if (!summary) {
    console.error(`No trace events found for requestId=${requestId}`);
    console.error(`Searched: ${dir}`);
    process.exitCode = 1;
    return;
  }

  console.log(`requestId=${summary.requestId}`);
  console.log(
    `outcome=${summary.outcome ?? "-"} answerStatus=${summary.answerStatus ?? "-"}`,
  );
  console.log(
    `totalMs=${summary.totalDurationMs?.toFixed?.(0) ?? summary.totalDurationMs ?? "-"} ` +
      `history=${summary.historyPresent ? `yes(${summary.historyMessageCount})` : "no"} ` +
      `unresolvedRefs=${summary.unresolvedReferenceCount ?? 0}`,
  );
  console.log("stages:");
  for (const stage of summary.stages) {
    const nest = stage.nestedUnder
      ? ` nestedUnder=${stage.nestedUnder}`
      : stage.includesNested?.length
        ? ` includes=${stage.includesNested.join(",")}`
        : "";
    const usage = stage.usage
      ? ` tokens(in=${stage.usage.inputTokens ?? "null"},out=${stage.usage.outputTokens ?? "null"},cached=${stage.usage.cachedInputTokens ?? "null"})`
      : "";
    console.log(
      `  - ${stage.stage}: ${stage.status} ` +
        `ms=${stage.durationMs ?? "null"}` +
        nest +
        (stage.errorCode ? ` error=${stage.errorCode}` : "") +
        usage,
    );
  }
  console.log(
    `tokenTotals: input=${summary.tokenTotals.inputTokens ?? "null"} ` +
      `output=${summary.tokenTotals.outputTokens ?? "null"} ` +
      `cachedInput=${summary.tokenTotals.cachedInputTokens ?? "null"} ` +
      `(cached is part of input when reported — not double-counted)`,
  );
  console.log(
    `citedChunkIds=${(summary.citedChunkIds ?? []).join(", ") || "(none)"}`,
  );
  if (summary.scopeNote) console.log(`scope: ${summary.scopeNote}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
