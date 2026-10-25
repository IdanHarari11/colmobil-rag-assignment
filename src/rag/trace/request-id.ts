import { randomUUID } from "node:crypto";

/** Server-side id for one ask() invocation (not a client-supplied secret). */
export function createRequestId(): string {
  return randomUUID();
}
