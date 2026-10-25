import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { TRACE_LOG_POLICY, type TraceEvent } from "./types";

export interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
}

export interface JsonlTraceWriterOptions {
  directory?: string;
  maxFileBytes?: number;
  maxRotatedFiles?: number;
  /** Injected clock for tests. */
  now?: () => Date;
}

/**
 * Append-only JSONL writer with size-based rotation.
 * A lock file serializes rotation across CLI and Next.js processes.
 * Append uses O_APPEND (atomic for typical line sizes on POSIX).
 */
export class JsonlTraceWriter implements TraceWriter {
  readonly directory: string;
  readonly maxFileBytes: number;
  readonly maxRotatedFiles: number;
  private readonly now: () => Date;
  private readonly activePath: string;
  private readonly lockPath: string;

  constructor(options: JsonlTraceWriterOptions = {}) {
    // Static "data/traces" segments keep Turbopack from tracing the whole repo.
    this.directory =
      options.directory ?? path.join(process.cwd(), "data", "traces");
    this.maxFileBytes = options.maxFileBytes ?? TRACE_LOG_POLICY.maxFileBytes;
    this.maxRotatedFiles =
      options.maxRotatedFiles ?? TRACE_LOG_POLICY.maxRotatedFiles;
    this.now = options.now ?? (() => new Date());
    this.activePath = path.join(
      this.directory,
      TRACE_LOG_POLICY.activeFileName,
    );
    this.lockPath = path.join(this.directory, ".ask-traces.rotate.lock");
  }

  async append(event: TraceEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await this.rotateIfNeeded();
    const line = `${JSON.stringify(event)}\n`;
    const handle = await open(this.activePath, "a");
    try {
      await handle.write(line, undefined, "utf8");
    } finally {
      await handle.close();
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    let size = 0;
    try {
      size = (await stat(this.activePath)).size;
    } catch {
      return;
    }
    if (size < this.maxFileBytes) return;

    const unlocked = await this.tryAcquireLock();
    if (!unlocked) {
      // Another process is rotating; skip this time (append still safe).
      return;
    }
    try {
      // Re-check under lock.
      try {
        size = (await stat(this.activePath)).size;
      } catch {
        return;
      }
      if (size < this.maxFileBytes) return;

      const stamp = this.now()
        .toISOString()
        .replace(/[:.]/g, "-");
      const rotated = path.join(
        this.directory,
        `ask-traces.${stamp}.jsonl`,
      );
      await rename(this.activePath, rotated);
      await this.pruneRotated();
    } finally {
      await this.releaseLock();
    }
  }

  private async tryAcquireLock(): Promise<boolean> {
    const deadline = Date.now() + 200;
    while (Date.now() < deadline) {
      try {
        const handle = await open(this.lockPath, "wx");
        await handle.writeFile(String(process.pid), "utf8");
        await handle.close();
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    return false;
  }

  private async releaseLock(): Promise<void> {
    try {
      await unlink(this.lockPath);
    } catch {
      // ignore
    }
  }

  private async pruneRotated(): Promise<void> {
    const names = (await readdir(this.directory))
      .filter(
        (name) =>
          name.startsWith("ask-traces.") &&
          name.endsWith(".jsonl") &&
          name !== TRACE_LOG_POLICY.activeFileName,
      )
      .sort();
    const excess = names.length - this.maxRotatedFiles;
    if (excess <= 0) return;
    for (const name of names.slice(0, excess)) {
      try {
        await unlink(path.join(this.directory, name));
      } catch {
        // ignore
      }
    }
  }
}

let defaultWriter: JsonlTraceWriter | undefined;

/** Shared default writer (stateless aside from path config). Safe across requests. */
export function getDefaultTraceWriter(): TraceWriter {
  if (!defaultWriter) {
    defaultWriter = new JsonlTraceWriter();
  }
  return defaultWriter;
}

/** Test helper to reset singleton. */
export function resetDefaultTraceWriter(): void {
  defaultWriter = undefined;
}

/** In-memory writer for unit tests. */
export class MemoryTraceWriter implements TraceWriter {
  readonly events: TraceEvent[] = [];
  failNext = false;

  async append(event: TraceEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("synthetic_trace_write_failure");
    }
    this.events.push(event);
  }
}
