import { describe, expect, it } from "vitest";
import { buildCitationNumberMap } from "./citation-numbers";
import type { AskDisplaySource } from "./ask-display";

function src(chunkId: string): AskDisplaySource {
  return {
    chunkId,
    documentId: "d",
    fileName: `${chunkId}.md`,
    relativePath: `${chunkId}.md`,
    text: "body",
    origin: "retrieved",
    claims: [],
  };
}

describe("buildCitationNumberMap", () => {
  it("assigns stable numbers by first appearance and reuses on repeat", () => {
    const sources = [src("a"), src("b"), src("c")];
    const map = buildCitationNumberMap(
      [
        { text: "p1", sourceChunkIds: ["b", "a"] },
        { text: "p2", sourceChunkIds: ["b", "c"] },
      ],
      sources,
    );
    expect(map.get("b")).toBe(1);
    expect(map.get("a")).toBe(2);
    expect(map.get("c")).toBe(3);
  });

  it("ignores unknown chunk ids in parts", () => {
    const map = buildCitationNumberMap(
      [{ text: "p", sourceChunkIds: ["missing", "a"] }],
      [src("a")],
    );
    expect(map.get("a")).toBe(1);
    expect(map.has("missing")).toBe(false);
  });
});
