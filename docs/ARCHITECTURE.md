# Architecture and decisions

## Scope and boundaries

One Next.js application avoids a separate long-lived audio server. Realtime media travels directly between browser and OpenAI using WebRTC; Vercel only exchanges SDP once and serves stateless RAG requests. Server credentials are never returned to the browser.

The supported knowledge base is the supplied 620-page Hyundai Tucson Hybrid 2025 manual. The confirmed scenario is an external customer who has stopped at the roadside. The supported vehicle is fixed to Tucson Hybrid 2025; repeated model/year or parking questions are unnecessary unless the customer contradicts that scenario. Different trims/options may still need clarification. Architecture is the primary assessment criterion. Unrelated questions and other vehicles receive a short scope refusal, while relevant questions lacking evidence receive an explicit evidence-gap response. These requirements were clarified by the user; no direct outreach to Dan was performed by this agent.

## Ingestion and enrichment

`scripts/prepare_colmobil.py` uses PyMuPDF content-stream block order instead of sorting all lines across the PDF's columns. It removes direction-control characters, preserves Hebrew text, groups blocks into ~2300-character chunks with ~220-character carryover, and records source SHA-256, PDF page and extraction limitations. The final groups can exceed the target if one source block is large. These are character heuristics, not tokenizer measurements. Each page is a separate document ID, so sibling expansion cannot accidentally pull the entire manual into context. No inherited insurance relationships manifest is used by the new service.

The ingestion report records low-text pages. It does not certify that a page was read correctly. Images, warning-light icons and structured tables are not reconstructed. Future improvement: layout-aware columns/tables, icon descriptions and verified topic/vehicle metadata, measured against a manually checked set before enrichment is indexed.

## Storage and retrieval

Chunks, embeddings and the original PDF are versioned files for a single small assignment corpus. Hybrid retrieval reuses the existing implementation: BM25 and cosine rankings combined by equal-weight RRF, top 6. `buildLocalIndex` validates hashes and reuses unchanged real embeddings. Query embedding dimensions/model must match the manifest.

When real vectors have not been created, BM25 alone works for local retrieval diagnostics and is explicitly reported as `lexical_pending_embeddings`. Provider/index errors do not silently fall back to lexical. No Redis or hosted vector database is required for this stateless demo. Production would use access-controlled object storage, a vector/search service, durable sessions, quotas and observability, based on measured needs.

Synthetic dialogue examples are searched separately with BM25. One example is passed as style-only material. Technical source IDs come exclusively from original-manual retrieval. This demonstrates using prior service interactions without allowing a fabricated conversation to overrule the manufacturer. The original example transcript contains unverified actions and is excluded from technical retrieval.

## Agent components and routing

1. Validate question and bounded user/assistant history.
2. Rewrite follow-ups to a standalone query using confirmed user details. History is context, not factual authority.
3. Retrieve manual evidence and a separately labeled dialogue example.
4. Generate strict JSON with answer status, cited IDs, escalation level and reason.
5. Validate schema, allowed IDs and evidence presence for routine answered results.
6. Render Hebrew text with source excerpts; expose a simulated handoff summary when required.
7. In voice mode, read the validated text through an isolated Realtime response.

Policy resides in `src/support/policy.ts`; retrieval in `retrieval.ts`; generation/validation in `service.ts`; HTTP boundaries under `src/app/api/`; voice lifecycle in `voice-client.ts`. These are narrow components rather than multiple autonomous agents. There is no unnecessary agent framework migration from the requested original stack.

## Conversation and voice lifecycle

Text and voice share browser-memory messages and server history caps. Refresh clears the conversation. New conversation cancels pending work, closes voice and clears history. Voice uses server VAD (650ms silence) with automatic answers disabled. Speech start cancels pending RAG/audio and invalidates the request sequence. Repeated or stale transcript IDs are discarded. A completed transcript invokes `/api/support`. The current approved answer is then spoken. Muting disables microphone tracks. End/disconnect/unmount stops media tracks, peer connection, data channel, timers and pending requests. A client timer ends voice after ten minutes for demo convenience; it is not a server-enforced cost quota.

Interrupted audio may mean the customer heard only part of the visible answer. The text remains visible. No claim is made that the text history precisely represents what was heard. Production should track actually delivered speech before relying on it as conversation state.

## Errors and handoff

Invalid input/history → 400. Missing project key → 503 and a Hebrew setup message. Upstream failures or invalid grounding payload → safe 502 without secrets or provider diagnostics. Microphone denial or network failure → visible Hebrew error and text remains available. Voice does not respond automatically before RAG approval. Retry is user-driven; the main answer call has automatic retries disabled.

Escalation levels are none, service and urgent. A handoff contains the issue, rationale and last answer, clearly marked simulated. No external service is called. Metadata-only logs contain request IDs, timings, source IDs and usage, without transcript/body/key values.

## Main tradeoffs

- File index: low setup cost and reproducibility; unsuitable for independently updating a large production corpus.
- Existing direct OpenAI SDK: honors the requested reused stack and keeps Realtime integration direct; no unnecessary AI Gateway migration.
- RAG before speech: consistent evidence policy and source display, with more latency than a free-form speech agent.
- Prompt safety and structural validation: practical assignment scope; no claim of clinical/mechanical or semantic certification.
- Private new repository and protected Preview: reviewable work before deciding submission visibility.
