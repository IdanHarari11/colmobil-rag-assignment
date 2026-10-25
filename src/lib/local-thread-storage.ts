import type { AsyncStorageLike } from "@assistant-ui/core/react";

/**
 * Browser localStorage bridge for assistant-ui createLocalStorageAdapter.
 * Quota / privacy errors surface as thrown errors so callers do not claim success.
 * Corrupt reads return null instead of crashing the app.
 */
export function createBrowserAsyncStorage(): AsyncStorageLike {
  return {
    async getItem(key: string): Promise<string | null> {
      try {
        if (typeof localStorage === "undefined") return null;
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      if (typeof localStorage === "undefined") {
        throw new Error("Local storage is unavailable in this environment.");
      }
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        const name =
          error instanceof DOMException ? error.name : "StorageError";
        if (
          name === "QuotaExceededError" ||
          name === "NS_ERROR_DOM_QUOTA_REACHED"
        ) {
          throw new Error(
            "Local storage quota exceeded; conversation was not saved.",
          );
        }
        throw error instanceof Error
          ? error
          : new Error("Failed to write local conversation history.");
      }
    },
    async removeItem(key: string): Promise<void> {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem(key);
      } catch {
        // Ignore remove failures — deletion metadata is best-effort.
      }
    },
  };
}

/** Storage key prefix for Ofek RAG thread list + messages. */
export const OFEK_THREAD_STORAGE_PREFIX = "ofek-rag:";
