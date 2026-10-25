# Colmobil RAG handoff to Codex

## Goal and authorization

Continue the existing implementation; do not rebuild from scratch. The user is Idan Harari, GitHub `IdanHarari11`. The user authorized publishing the project to their public GitHub repository, deploying it separately to Vercel, creating a NEW assignment-specific OpenAI key, and deep QA/evaluation. Never use another GitHub account. Existing Mint/Ofek code and deployments must remain unchanged.

This is the Colmobil vehicle-service assignment, distinct from the original Ofek insurance assignment and from unrelated Madlan/Tobi/Colors work.

## Confirmed requirements

- External end customer who has already stopped at the roadside.
- Hyundai Tucson Hybrid 2025 ONLY; no repeated model/year or parking questions unless contradicted or material equipment information is missing.
- Architecture correctness is the main assessment priority.
- Hebrew text and full RTL, plus continuous voice with automatic end-of-speech and interruption/barge-in.
- Technical answers only from supplied evidence. Clear scope refusal for unrelated requests/other vehicles; distinct clarification and insufficient-evidence responses. Handle mixed requests and prompt injection.
- No invented mechanical diagnosis, safe-to-drive claim, contacts, price, warranty, towing dispatch or booking. Human handoff is explicitly simulated.
- Preserve readable development-process documentation and explain design choices, checks and limitations.
- User wanted completion as soon as possible; proceed autonomously within authorization, but do not claim unperformed live checks succeeded.

## Repository and deployment identifiers

- Target repository: https://github.com/IdanHarari11/colmobil-rag-assignment
- Last observed: PUBLIC, EMPTY. Metadata showed owner push/admin rights, but the ChatGPT GitHub integration rejected `create_file` with HTTP 403 `Resource not accessible by integration`. Shell `git push` lacked HTTPS credentials. Metadata is NOT proof integration write access works. Inspect current remote state before any push; never force-overwrite new remote work.
- The ZIP contains the working-tree snapshot, not `.git` history. Original local commit: `a36c69b` (reference only; unavailable in the ZIP). Initialize a fresh repository if needed, or integrate into a fresh target checkout after checking its contents. Do not use `git add -A` on an uninspected parent directory.
- Vercel project created, NOT deployed/validated: `prj_FZdkhHEy0UOYtDotPUbxo52IhNxP`, name `colmobil-rag-assignment`.
- Vercel team: `team_l45i2SVLcGc8Kyhi20esmeCE`, slug `idanharari11s-projects`.
- Original source/reference only: https://github.com/IdanHarari11/ofek-rag-assignment . Do not push to it.

## Current implementation

Next.js 16.4.2, React 19.3.0, TypeScript, pnpm, Tailwind, OpenAI SDK. Active Colmobil code is `src/support/`; inherited generic RAG utilities remain in `src/rag/`. Historical UI/utilities/tests are retained; not every inherited test is an active release gate for this domain.

- `src/support/policy.ts`: source authority, scope, Hebrew behavior, safety and voice-rendering policy.
- `src/support/service.ts`: history -> rewrite -> manual retrieval plus style example -> structured generation -> validation -> displayed answer/handoff.
- `retrieval.ts`: real Hybrid BM25/cosine/RRF if a genuine index exists; otherwise explicitly `lexical_pending_embeddings`. No fake vectors and no silent provider-error fallback.
- `dialogue.ts`: separate retrieval of one synthetic conversation for style only. Synthetic text never supplies technical citation IDs.
- `voice-client.ts`: WebRTC microphone and Realtime data channel, VAD transcription -> same RAG -> approved text read in an isolated response. Sequence invalidation, AbortControllers, stale/duplicate transcript handling and cleanup.
- `support-chat.tsx`: Hebrew chat, sources/PDF links and simulated handoff.
- `/api/support`: new answer API; `/api/ask` aliases it. Legacy `/api/thread-title` returns 410.
- `/api/voice`: server-side SDP negotiation; no permanent key sent to browser.
- `/api/manual`: original manual.

Default generation model is `gpt-4.1-mini`, embedding `text-embedding-3-small`/1536. Realtime defaults to `gpt-realtime` with `gpt-4o-transcribe`. Verify current provider support and actual request schemas before live deployment. Defaults are not proof model access works.

## Supplied data and extraction

- `corpus/colmobil/manual.pdf`: original 620-page Hebrew vehicle manual.
- `corpus/colmobil/example-transcript.txt`: supplied service transcript. Contains unverified technical advice; retained but excluded as technical authority.
- `synthetic-conversations.json`: eight explicitly synthetic style examples.
- `data/colmobil-chunks.json`: 646 chunks with original PDF-page provenance.
- `data/colmobil-ingestion-report.json`: extraction notes and source hash.
- Additional original task document is in `assignment/colmobil-home-assignment.docx` in this handoff package.

PyMuPDF content-stream block extraction was chosen after global line-order extraction interleaved columns. It still fragments some words and does not reconstruct tables/icons. Check safety guidance against the original PDF. Page citations are 1-based PDF page positions, not printed chapter-page labels. Chunk target ~2300 characters, overlap ~220, not exact model tokens. Source SHA and index hashes must remain consistent if extraction changes.

## Credentials and security

NO dedicated OpenAI key has been created or connected. Last safe local inspection found no `OPENAI_API_KEY`. `.env.example` is a template. Never commit `.env.local`, keys, browser state or vendor credentials.

The user explicitly chose a NEW key, so do not re-ask reuse-vs-new. The previous secure-setup skill required confirming the local destination; the proposed destination was the project’s ignored `.env.local`, but a specific confirmation was not completed. Follow the available secure credential setup flow; never ask the user to paste a plaintext key into chat. Do not assume browser sessions, connector accounts or secret values transfer into Codex.

One OpenAI key can serve generation/embeddings/Realtime if its scopes/project/model access permit. ElevenLabs was considered but not integrated; no measured Hebrew-quality comparison supports adding it yet.

Keep secret values server-only, and configure hosted environments securely. Preserve deployment protection while testing paid APIs; the demo lacks distributed quotas and end-user authentication. User authorization to publish source does not authorize exposing secrets or disabling safeguards.

## Verified versus pending

Completed on the prior local snapshot:
- 36 selected tests passed across 7 files.
- TypeScript, relevant ESLint checks and Production build passed.
- Real local HTTP checks: Hebrew/RTL home 200, original PDF 200, invalid question 400, missing key 503.
- Five keyword-heavy BM25 retrieval smoke cases hit expected pages within top 6; MRR 0.85. This is NOT answer accuracy, Hybrid validation, or a blind holdout.
- Fixes: answered responses need evidence even with escalation; escalation needs a reason; malformed voice events are caught; ending during SDP negotiation aborts its request; stale audio/RAG results are discarded.

NOT completed:
- successful upload of the full source to target GitHub;
- real embeddings/Hybrid index;
- any provider-backed generated answer evaluation;
- Hebrew acoustic/continuous voice QA;
- full-stack Vercel deployment or production verification.

Citation checks validate source IDs, not semantic truth. Source IDs associated with the whole answer do not prove every sentence is supported. Scope classification is model-driven. Do not overstate guarantees or say the system is ready for every possible scenario.

## Existing ChatGPT Site preview

https://colmobil-service-preview.idanharari.chatgpt.site

This is a separately published owner-private STATIC preview, not the full backend. Its source snapshot is included in `site-preview/`. It uses the same React interface and genuine browser-local BM25 retrieval, but intercepts `/api/support` locally to return an explicit non-AI preview notice and source excerpts. Voice does not activate the microphone without a key. Do not mistake this for a deployed RAG service or try adding a secret to its client bundle.

Sites project: `appgprj_6ade29c536ec8191ab8883791b1fd519`.
Published version: `appgprj_6ade29c536ec8191ab8883791b1fd519~appgver_efb86ce583a481918dfaffe424ebdbc7`.
Published source commit: `8b5140c367f4054ea5a93d810c8a08f708770545`.
Treat the manifest’s project identity/audience as belonging to that existing preview. Do not reuse its identity for an unrelated new Site. Do not persist/reuse expired source credentials.

## Local setup and commands

Node >=22. The original project specifies pnpm 12.x; installed pnpm 11.25.0 successfully installed the existing frozen lockfile. Preserve the lockfile; check the actual local package manager.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:colmobil
pnpm test:core
pnpm eval:colmobil
pnpm build
```

Rebuild extraction only if needed (`pip install pymupdf`): `pnpm prepare:colmobil`.
After secure key setup: `pnpm index:colmobil` writes the real local index. Verify and commit that non-secret index for serverless deployment. Do not rebuild/call embeddings during every production build.

`pnpm eval:answers:colmobil` is a no-cost dry run. For actual calls, the runner requires `--live --limit=10` or `--live --limit=40`. Confirm argument forwarding with the installed package manager. It runs serially and stops after two provider failures; it has no hard dollar cap. The first 10 cases are scope-heavy, so choose a balanced pilot before extrapolating.

## QA and delivery plan

Read README, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PROCESS.md`, `docs/EVALUATION.md` and `docs/QA_PLAN.md` first. `eval/colmobil-cases.json` has 40 exposed development cases, NOT an unseen holdout. Results require manual source review; the runner’s structural checks do not certify safety or grounding.

1. Inspect current local and remote state; resolve write access to the user’s target repository without creating another account or overwriting remote work. Upload the inspected source and document the actual SHA.
2. Provision a new dedicated OpenAI key through the secure available flow, with the confirmed destination. Do not recreate keys blindly after errors.
3. Generate real embeddings; validate source/index hashes and rerun retrieval comparison.
4. Run a balanced bounded live pilot. Inspect actual errors and all safety/grounding failures; fix only evidence-backed issues, then run wider tests. Add an independent holdout and real multi-turn cases.
5. Verify exact model/API compatibility, Hebrew text and speech, numbers, names/acronyms, pauses, noise, interrupted retrieval/playback, permission denial, disconnection and cleanup.
6. Deploy to the existing separate Vercel project with server-only secrets. Test the exact deployed SHA in desktop/mobile browser and through HTTP. Do not silently switch the target project or change the original Ofek project.
7. Update documentation and provide the real public GitHub URL, live deployment URL, exact test results and remaining limitations. Do not label mocks or the static preview as live AI verification.

Proceed through all authorized work. Ask only for missing credentials/mandatory approvals or genuine blockers; explain the exact source of any required stop.
