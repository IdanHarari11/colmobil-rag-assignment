import path from "node:path";

export function defaultChunksPath(rootDir = process.cwd()): string {
  return path.join(rootDir, "data", "chunks.json");
}

export function defaultIndexPath(rootDir = process.cwd()): string {
  return path.join(rootDir, "data", "index", "embeddings.json");
}

export function defaultEvalDir(rootDir = process.cwd()): string {
  return path.join(rootDir, "eval_results");
}
