# QA and release gates

## Objective

Verify evidence-based Hebrew service for an external, safely stopped customer with a Hyundai Tucson Hybrid 2025. Architecture and failure handling are assessed explicitly. No finite test set establishes correct behavior for every possible input.

## Audit findings and fixes

| Finding | Change | Evidence |
| --- | --- | --- |
| An `answered` payload could omit sources when escalation was set | Require a source for every `answered` payload, irrespective of escalation; an unsupported case must use another status | Regression in `service.test.ts` |
| Human handoff could have an empty reason | Require a nonempty escalation reason | Regression in `service.test.ts` |
| Ending voice while negotiating SDP did not abort the negotiation request | Separate connection AbortController; stop aborts negotiation and pending RAG | Regression in `voice-client.test.ts` |
| Malformed data-channel JSON could throw before normal error handling | Catch event parsing failures and show a safe Hebrew error | Regression in `voice-client.test.ts` |

These are local contract and lifecycle checks, not provider-backed acoustic or semantic verification.

## Test layers

1. **Contracts:** malformed HTTP bodies, question/history limits, invalid source IDs, unsupported statuses, missing evidence/reasons, safe failure responses and absence of secret values.
2. **Retrieval:** manually labeled original PDF pages, everyday paraphrases, spelling variation and vector/BM25/Hybrid comparison on the same question set. Preserve mode and denominator; do not call source-page hit rate answer accuracy.
3. **Conversation:** reference resolution, user corrections, topic changes, vehicle changes and evidence limited to current sources. Include the fixed initial scenario so the assistant does not repeatedly ask model/year or whether the customer has stopped.
4. **Semantic answers:** compare every safety-related instruction, condition, number and warning with the original PDF. Check unsupported statements, invented contact details/dispatch and whether refusals remain useful and short. Current ID validation is not semantic verification; answer-level citations do not prove each sentence is supported.
5. **Scope and adversarial behavior:** unrelated requests, hidden-prompt/key requests, role overrides, forged source instructions, fake prior statements and mixed relevant/irrelevant questions. The scope decision is model-based and must be measured, not assumed from prompt wording.
6. **Voice:** real microphone, Hebrew pronunciation and numerals, no extra spoken claims, pauses, echo/noise, interruption during retrieval and playback, delayed/duplicate transcripts, permission denial, reconnect, mute, finish and component unmount. Compare actual spoken wording with approved text.
7. **Deployment:** run on the exact Vercel commit, with a dedicated key and real index. Test desktop/mobile RTL, source-page links, live text and multi-turn voice, safe upstream failures and protection against anonymous paid-API abuse. Preserve deployment protection during testing.

## Development evaluation dataset

`eval/colmobil-cases.json` contains **40 exposed development cases**, covering scope, manual questions, clarification, unsupported services, safety, adversarial requests and follow-ups. It is not a blind holdout and is not indexed as knowledge. Reference PDF pages are starting labels that require human verification; an accepted status is not proof of a correct answer.

`pnpm eval:answers:colmobil` lists the suite without provider calls. Run a bounded live pilot with the new key:

```sh
pnpm eval:answers:colmobil --live --limit=10
```

Only after reviewing the pilot, run the full development set:

```sh
pnpm eval:answers:colmobil --live --limit=40
```

The runner is serial, stops after two provider failures, uses no automatic retry for the main generation, and records results for human review. It does not report semantic pass/fail automatically. Rewriting and embedding are separate provider operations and contribute additional latency/cost; a bounded case count is not a hard monetary spending cap. Dataset order puts scope cases first; select a balanced sample manually before interpreting a pilot as representative.

Create a separate unseen test set before claiming generalization. Include independently written noisy Hebrew and multi-turn cases; do not tune prompts on that set.

## Release criteria

- All selected local checks pass on the candidate SHA.
- No known unsafe instruction, invented action/contact or leaked secret in the evaluated safety/adversarial cases. Any such failure blocks submission until understood and retested.
- Every reviewed technical claim has applicable source evidence. A structural source ID alone is insufficient.
- Uncertainty and unsupported vehicles/topics receive appropriate responses; no general-knowledge answering path bypasses RAG.
- Real vectors are built and Hybrid is actually exercised before describing the deployment as Hybrid.
- Multi-turn text and continuous Hebrew voice work on the deployed candidate; microphone and stale-response cleanup are verified.
- Results report exact suite size, failures, remaining limitations, model settings and deployment SHA. Do not hide failures behind averages.

## Current pending checks

Live generation, real embeddings, acoustic QA, browser visual QA of the deployment and production behavior remain pending credentials/deployment. GitHub additionally requested account re-authentication before making the repository public. Repository upload and the change to public visibility must be verified separately; an open confirmation form is not a successful publication.
