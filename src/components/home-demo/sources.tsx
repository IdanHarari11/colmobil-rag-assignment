"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo, useState, type ReactNode } from "react";
import {
  ASK_CUSTOM_METADATA_KEY,
  isAskDisplayResponse,
  type AskDisplayResponse,
  type AskDisplaySource,
} from "@/lib/ask-display";
import { buildCitationNumberMap } from "@/lib/citation-numbers";
import {
  sourceDisplayHeading,
  sourcePagesLabel,
  sourceSectionLabel,
} from "@/lib/source-display";
import { cn } from "@/lib/utils";

function readRagPayload(custom: unknown): AskDisplayResponse | null {
  if (!custom || typeof custom !== "object") return null;
  const rag = (custom as Record<string, unknown>)[ASK_CUSTOM_METADATA_KEY];
  return isAskDisplayResponse(rag) ? rag : null;
}

/**
 * Fixed RAG source renderer — reads structured metadata.custom.rag only.
 * Citation numbers are consistent across the whole assistant answer.
 * Chunk text is index body only (no retrieval aliases / computed facts).
 * chunkId validity ≠ semantic verification — do not claim otherwise.
 */
export function Sources(): ReactNode {
  const custom = useAuiState((s) => s.message.metadata?.custom);
  const rag = readRagPayload(custom);
  const [openId, setOpenId] = useState<string | null>(null);

  const numbers = useMemo(() => {
    if (!rag) return new Map<string, number>();
    return buildCitationNumberMap(rag.answerParts, rag.sources);
  }, [rag]);

  if (!rag || rag.status === "insufficient_evidence" || rag.sources.length === 0) {
    return null;
  }

  const ordered = [...rag.sources].sort(
    (a, b) => (numbers.get(a.chunkId) ?? 0) - (numbers.get(b.chunkId) ?? 0),
  );

  return (
    <div className="mt-4 border-t border-foreground/10 pt-3" dir="rtl">
      <p className="text-muted-foreground mb-2 text-[12px]">
        מקורות שצוטטו בתשובה
        {rag.generationModel ? (
          <span className="text-muted-foreground/70"> · {rag.generationModel}</span>
        ) : null}
      </p>
      <ul className="flex flex-col gap-2">
        {ordered.map((source) => {
          const n = numbers.get(source.chunkId) ?? 0;
          const isOpen = openId === source.chunkId;
          const pages = sourcePagesLabel(source);
          const section = sourceSectionLabel(source);
          const heading = sourceDisplayHeading(source);
          return (
            <li key={source.chunkId} className="text-[13px]">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : source.chunkId)}
                className={cn(
                  "text-muted-foreground hover:text-foreground rounded-control w-full text-start text-[12px] underline-offset-2 hover:underline",
                )}
                aria-expanded={isOpen}
                aria-label={`מקור ${n}: ${heading}`}
              >
                <span className="text-foreground/80 font-medium tabular-nums">
                  [{n}]
                </span>{" "}
                {heading}
                {section ? ` · ${section}` : ""}
                {pages ? ` · ${pages}` : ""}
              </button>
              {isOpen ? (
                <SourceCard source={source} citationNumber={n} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SourceCard({
  source,
  citationNumber,
}: {
  source: AskDisplaySource;
  citationNumber: number;
}): ReactNode {
  const section = sourceSectionLabel(source);
  const pages = sourcePagesLabel(source);
  return (
    <div
      className="border-foreground/10 bg-muted/40 mt-1 rounded-control border px-3 py-2 text-[12px] leading-relaxed"
      dir="auto"
    >
      <p className="text-muted-foreground mb-1 text-[11px]">
        <span className="font-medium tabular-nums text-foreground/80">
          [{citationNumber}]
        </span>{" "}
        <span className="font-mono" dir="ltr">
          {source.fileName}
        </span>
        {source.versionLabel ? (
          <span dir="rtl"> · {sourceDisplayHeading(source)}</span>
        ) : null}
        {section ? <span dir="rtl"> · {section}</span> : null}
        {pages ? <span dir="rtl"> · {pages}</span> : null}
      </p>
      <p className="whitespace-pre-wrap wrap-break-word">
        {source.text || "(אין טקסט קטע זמין)"}
      </p>
    </div>
  );
}

/** Inline citation chips next to an answer part — same numbers as the source list. */
export function PartCitations({
  sourceChunkIds,
  sources,
  numbers,
}: {
  sourceChunkIds: string[];
  sources: AskDisplaySource[];
  numbers: Map<string, number>;
}): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  const indexed = useMemo(() => {
    return sourceChunkIds
      .map((id) => sources.find((s) => s.chunkId === id))
      .filter((s): s is AskDisplaySource => Boolean(s));
  }, [sourceChunkIds, sources]);

  if (indexed.length === 0) return null;

  return (
    <span className="ms-1 inline-flex flex-wrap items-center gap-1 align-super">
      {indexed.map((source) => {
        const n = numbers.get(source.chunkId) ?? 0;
        const isOpen = openId === source.chunkId;
        const heading = sourceDisplayHeading(source);
        return (
          <span key={source.chunkId} className="relative inline-block">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded-control border-foreground/15 border px-1 py-px text-[10px] leading-none tabular-nums"
              aria-label={`מקור ${n}: ${heading}`}
              onClick={() => setOpenId(isOpen ? null : source.chunkId)}
            >
              [{n}]
            </button>
            {isOpen ? (
              <span
                className="border-foreground/10 bg-background absolute end-0 top-full z-20 mt-1 w-[min(22rem,70vw)] rounded-control border p-2 text-[12px] shadow-sm"
                dir="auto"
              >
                <span className="text-muted-foreground mb-1 block text-[11px]">
                  <span className="font-medium tabular-nums text-foreground/80">
                    [{n}]
                  </span>{" "}
                  {heading}
                  {sourceSectionLabel(source)
                    ? ` · ${sourceSectionLabel(source)}`
                    : ""}
                  {sourcePagesLabel(source)
                    ? ` · ${sourcePagesLabel(source)}`
                    : ""}
                </span>
                <span className="block whitespace-pre-wrap wrap-break-word">
                  {source.text || "(אין טקסט קטע זמין)"}
                </span>
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

export function useMessageRag(): AskDisplayResponse | null {
  const custom = useAuiState((s) => s.message.metadata?.custom);
  return readRagPayload(custom);
}

export function useCitationNumbers(
  rag: AskDisplayResponse | null,
): Map<string, number> {
  return useMemo(() => {
    if (!rag) return new Map();
    return buildCitationNumberMap(rag.answerParts, rag.sources);
  }, [rag]);
}
