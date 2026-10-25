import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ask, type AskDependencies, type AskOptions } from "../rag/ask";
import type { AskResult } from "../rag/ask-types";
import { GenerationSystemError } from "../rag/ask-types";
import { defaultEvalDir } from "../rag/paths";
import {
  CONVERSATION_FIXTURES,
  type ConversationFixture,
  type ConversationFixtureTurn,
} from "./conversation-fixtures";

export interface ConversationTurnEval {
  fixtureId: string;
  title: string;
  question: string;
  clarificationFixture?: boolean;
  status: AskResult["status"] | "system_error";
  answer: string;
  answerParts: AskResult["answerParts"];
  sourceChunkIds: string[];
  sourceFileNames: string[];
  originalQuestion: string;
  standaloneQuestion: string;
  unresolvedReferences: string[];
  rewriteMs?: number;
  rewritePromptTokens?: number;
  rewriteCompletionTokens?: number;
  standaloneChecks: {
    mustIncludeOk: boolean;
    mustNotIncludeOk: boolean;
    missingIncludes: string[];
    leakedExcludes: string[];
  };
  systemError?: string;
  notes: string;
}

export interface ConversationEvalReport {
  generatedAt: string;
  stageLabel: string;
  retrievalMode: string;
  generationModel: string;
  fixtureCount: number;
  turnCount: number;
  systemErrorCount: number;
  standaloneCheckFailures: number;
  totalRewriteMs: number;
  totalRewritePromptTokens: number;
  totalRewriteCompletionTokens: number;
  turns: ConversationTurnEval[];
}

function checkStandalone(
  standalone: string,
  expect: ConversationFixtureTurn["expectStandalone"],
): ConversationTurnEval["standaloneChecks"] {
  const missingIncludes: string[] = [];
  const leakedExcludes: string[] = [];
  for (const needle of expect.mustInclude ?? []) {
    if (!standalone.includes(needle)) missingIncludes.push(needle);
  }
  for (const needle of expect.mustNotInclude ?? []) {
    if (standalone.includes(needle)) leakedExcludes.push(needle);
  }
  return {
    mustIncludeOk: missingIncludes.length === 0,
    mustNotIncludeOk: leakedExcludes.length === 0,
    missingIncludes,
    leakedExcludes,
  };
}

async function evalTurn(
  fixture: ConversationFixture,
  turn: ConversationFixtureTurn,
  askOptions: AskOptions,
  deps: AskDependencies,
): Promise<ConversationTurnEval> {
  try {
    const result = await ask(
      turn.question,
      { ...askOptions, history: turn.history },
      deps,
    );
    const standalone = result.standaloneQuestion;
    return {
      fixtureId: fixture.id,
      title: fixture.title,
      question: turn.question,
      clarificationFixture: turn.clarificationFixture,
      status: result.status,
      answer: result.answer,
      answerParts: result.answerParts,
      sourceChunkIds: result.sources.map((s) => s.chunkId),
      sourceFileNames: result.sources.map((s) => s.fileName),
      originalQuestion: result.question,
      standaloneQuestion: standalone,
      unresolvedReferences: result.unresolvedReferences,
      rewriteMs: result.timingsMs.rewriteMs,
      rewritePromptTokens: result.usage?.rewritePromptTokens,
      rewriteCompletionTokens: result.usage?.rewriteCompletionTokens,
      standaloneChecks: checkStandalone(standalone, turn.expectStandalone),
      notes: turn.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      fixtureId: fixture.id,
      title: fixture.title,
      question: turn.question,
      clarificationFixture: turn.clarificationFixture,
      status: "system_error",
      answer: "",
      answerParts: [],
      sourceChunkIds: [],
      sourceFileNames: [],
      originalQuestion: turn.question,
      standaloneQuestion: "",
      unresolvedReferences: [],
      standaloneChecks: {
        mustIncludeOk: false,
        mustNotIncludeOk: false,
        missingIncludes: turn.expectStandalone.mustInclude ?? [],
        leakedExcludes: [],
      },
      systemError:
        error instanceof GenerationSystemError
          ? `[generation] ${message}`
          : message,
      notes: turn.notes,
    };
  }
}

export async function runConversationEval(options?: {
  askOptions?: AskOptions;
  deps?: AskDependencies;
  fixtures?: ConversationFixture[];
}): Promise<ConversationEvalReport> {
  const fixtures = options?.fixtures ?? CONVERSATION_FIXTURES;
  const askOptions: AskOptions = {
    mode: "hybrid",
    topK: 5,
    ...options?.askOptions,
  };
  const deps = options?.deps ?? {};
  const turns: ConversationTurnEval[] = [];

  for (const fixture of fixtures) {
    for (const turn of fixture.turns) {
      turns.push(await evalTurn(fixture, turn, askOptions, deps));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    stageLabel: "stage2-conversation-fixtures",
    retrievalMode: askOptions.mode ?? "hybrid",
    generationModel: turns.find((t) => t.status !== "system_error")
      ? (options?.askOptions?.generationModel ?? "from-ask-result")
      : "n/a",
    fixtureCount: fixtures.length,
    turnCount: turns.length,
    systemErrorCount: turns.filter((t) => t.status === "system_error").length,
    standaloneCheckFailures: turns.filter(
      (t) =>
        !t.standaloneChecks.mustIncludeOk ||
        !t.standaloneChecks.mustNotIncludeOk,
    ).length,
    totalRewriteMs: turns.reduce((s, t) => s + (t.rewriteMs ?? 0), 0),
    totalRewritePromptTokens: turns.reduce(
      (s, t) => s + (t.rewritePromptTokens ?? 0),
      0,
    ),
    totalRewriteCompletionTokens: turns.reduce(
      (s, t) => s + (t.rewriteCompletionTokens ?? 0),
      0,
    ),
    turns,
  };
}

export async function writeConversationEvalReport(
  report: ConversationEvalReport,
  outDir: string = defaultEvalDir(),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `conversation-eval-${stamp}.json`);
  const mdPath = path.join(outDir, `conversation-eval-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [
    "# Conversation eval (Stage 2)",
    "",
    `generatedAt: ${report.generatedAt}`,
    `fixtures: ${report.fixtureCount}, turns: ${report.turnCount}`,
    `systemErrorCount: ${report.systemErrorCount}`,
    `standaloneCheckFailures: ${report.standaloneCheckFailures}`,
    `rewrite: ${report.totalRewriteMs.toFixed(0)}ms, promptTokens=${report.totalRewritePromptTokens}, completionTokens=${report.totalRewriteCompletionTokens}`,
    "",
  ];
  for (const turn of report.turns) {
    lines.push(`## ${turn.fixtureId} — ${turn.title}`);
    lines.push(`- question: ${turn.question}`);
    lines.push(`- standalone: ${turn.standaloneQuestion || "(none)"}`);
    lines.push(
      `- unresolved: ${turn.unresolvedReferences.join("; ") || "(none)"}`,
    );
    lines.push(`- status: ${turn.status}`);
    lines.push(
      `- standaloneChecks: include=${turn.standaloneChecks.mustIncludeOk} exclude=${turn.standaloneChecks.mustNotIncludeOk}`,
    );
    if (turn.standaloneChecks.missingIncludes.length) {
      lines.push(
        `  - missingIncludes: ${turn.standaloneChecks.missingIncludes.join(", ")}`,
      );
    }
    if (turn.standaloneChecks.leakedExcludes.length) {
      lines.push(
        `  - leakedExcludes: ${turn.standaloneChecks.leakedExcludes.join(", ")}`,
      );
    }
    lines.push(`- answer: ${turn.answer.slice(0, 400)}`);
    lines.push(
      `- sources: ${turn.sourceFileNames.join(", ") || "(none)"} (${turn.sourceChunkIds.join(", ")})`,
    );
    if (turn.systemError) lines.push(`- systemError: ${turn.systemError}`);
    lines.push(`- notes: ${turn.notes}`);
    lines.push("");
  }
  await writeFile(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, mdPath };
}
