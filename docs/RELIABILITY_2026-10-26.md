# Reliability review — 26 October 2026

## Scope and evidence

This review concerns the existing Colmobil assignment demo for Hyundai Tucson Hybrid 2025. It is not a certification for roadside or production use. The original 620-page PDF is technical authority; eight synthetic dialogues are style examples only. The index contains 646 real text-embedding-3-small vectors. Technical answers use bounded history, query rewriting, BM25/vector Hybrid retrieval and cited original pages. The added intent router reads user context before retrieval and has no technical knowledge source of its own.

The evaluation inputs contain 40 original development cases, 12 later fresh cases and 24 robustness cases: **76 exposed cases**, plus two actual-history conversations totalling six turns. “Fresh” describes when a set was authored; after diagnosis these are no longer blind tests. Source-ID validation, accepted status and reference-page hits are separate from semantic correctness. No population accuracy percentage is inferred.

## Failures found and corrections

- A TV-remote battery question received vehicle-key advice. Scope is now classified before retrieval; unrelated/other-vehicle requests return a bounded refusal without technical sources.
- Relevant prices, personal warranty and dispatch were treated inconsistently. They now explicitly state the demo's capability limit and that no service was ordered.
- A driving paraphrase received app instructions. Explicit present driving now pauses troubleshooting; a completed trip is not current driving.
- “Steady without prior flashing” was called a TPMS malfunction. The low-pressure answer now requires the actual retrieved original low-pressure passage and explicit user no-flash wording. Unspecified prior flashing is clarified, including in actual-history conversations.
- Unsafe high-voltage work was briefly classified as unrelated, and an earlier answer volunteered an emergency cable procedure. Relevant high-voltage work now receives a professional-assistance boundary without disconnection steps.
- Hot coolant-cap answers volunteered later opening procedures. A bounded prohibition replaces that procedure. Engine hood/steam and coolant cap are treated separately, with the hood warning anchored to page 507.
- A bare “it is still flashing” was refused or inferred to be the Ready light from retrieval. The router now has an ambiguous-symptom branch that asks for the symbol before retrieval.
- Oil follow-ups and charging advice omitted material shutdown context or volunteered roadside inspection. Active pressure-warning triage is source-anchored to immediate engine shutdown and professional assistance; generation policy also limits charging advice to safe triage.

Failed and intermediate outputs remain in `eval_results`; they have not been replaced by successful runs. Prompt changes alone did not solve every case, which is why source-grounded server guards and real generated-history regressions were added.

## Review method and interpretation

The offline reviewer is a separate gpt-4.1 call receiving the actual answer, user history, rubric, cited pages and relevant reference pages extracted directly from the original PDF. Source hashes are checked. It does not review chunks as a substitute for the original pages. The reference pressure table was also visually checked: full-size tyres normal load 35/35 PSI; maximum load 35/40; temporary spare 60. Numbers require applicable tyre/load details.

This is model-assisted review, not independent human automotive review. It produced contradictory oil-warning demands (first demanding fewer procedures, later demanding the full oil-check procedure) and accepted some structural/context failures. Agent adjudication therefore inspects the actual answer and original source. A safe short triage answer is not failed merely for omitting an unsolicited maintenance procedure or hypothetical steam symptoms. Conversely, passing the reviewer cannot override a real context error. Raw verdicts are retained, including false positives.

## UI and voice

The composer uses a waveform action when empty, a send arrow for text and an end-call action during voice. The mobile menu opens a native modal sidebar with new chat, close/backdrop/Escape and focus behavior. Local build and checks pass. The user reported all voice functionality working in their browser. Earlier provider testing verified actual Hebrew VAD/transcription, RAG and output audio; approved text matched the provider output transcript. These are different evidence types.

The reported iPhone 16 Pro Max test was Chrome desktop emulation. Visual verification of the latest drawer, physical iPhone audio/layout, extended noise/echo and broad pronunciation coverage are not claimed. Browser-origin access was declined; no automated visual check was substituted through another channel.

## Limits relevant to submission

This is a bounded assignment demo with a real connected key and protected deployment. PDF extraction fragments Hebrew words and flattens tables; icons/images are not interpreted. Sessions remain in browser memory. Dispatch/CRM/personal warranty and pricing are unavailable and are explicitly simulated or refused. Routing adds a provider call, latency and tokens; generation-only usage logs do not represent total cost. Finite exposed regressions cannot establish correctness for arbitrary future questions. The dedicated key was created with a 30-day lifetime and requires renewal for later demonstrations.

## Final run evidence

- Complete 76-case regression on frozen runtime candidate `59a342d`: 40 + 12 + 24 responses, **0 execution errors**, **76/76 accepted status/escalation/source-contract checks**. Reports: `colmobil-answers-1793026999633.json`, `colmobil-answers-1793026922445.json`, `colmobil-answers-1793026970941.json`.
- Separate original-source model review: **76/76 reviewed, 0 reviewer errors**; raw verdicts: 72 severity-none, 2 minor, 2 major. Both majors concern the oil-warning triage boundary; they are retained and explicitly adjudicated in `semantic-adjudication-20261026.json`, not silently counted as passes. The two minors concern charging-procedure completeness and the pre-start oil-level distinction. The latter was corrected; charging guidance was then bounded server-side after a hosted answer drifted back to a belt inspection despite the generation policy. The hosted failure remains recorded.
- Final isolated oil-level correction: **3/3 actual provider responses**, no errors, accepted contracts. The corrected distinction passes the separate original-source reviewer; oil/pressure regression remains safe triage with the same documented reviewer disagreement. Report `colmobil-answers-1793027127027.json`; review `audit-final-oil-distinction.json`.
- The final source is `33873b247aff2873715d3343411e99287040b393`. The full 76 set was run before two final narrow source-backed branches: oil-level distinction (3-case regression), then charging-warning triage (2-case regression, including the oil-level branch). No new full-76 run is claimed after these isolated patches. `final-runtime-snapshot.json` records file hashes and candid parent-commit/dirty-worktree provenance. This is not described as a new clean 76-case run on the last commit.
- Latest local gates: TypeScript, ESLint, **32 support + 16 core tests**, production build passed after the final source change. Actual-history regression: **6/6 turns, 0 errors**; correction, other-vehicle refusal, unknown prior flashing clarification and no dispatch confirmed.
- Measured local/provider latency over the full 76-case set: median **3.35 seconds**, observed p95 **5.21 seconds**, maximum **7.05 seconds**. This is one run under its observed conditions, not a production SLA or perceived browser/voice latency. Early exits are included.
- The intermediate Vercel deployment `dpl_HuiBBGzsCUysLmtF56r5EMkbM3Lz` was READY and matched source bfdf00f. The final charging branch is verified separately below. Exact URL: https://colmobil-rag-assignment-1a2jkzli8-idanharari11s-projects.vercel.app . Stable alias: https://colmobil-rag-assignment.vercel.app . Deployment protection is retained.
- Hosted full regression on preceding source `59a342d`: 11 valid single-turn questions returned HTTP200 with expected behaviors; invalid empty input400; health/home200. Actual hosted four-turn history used generated answers, correctly asked about flashing, then identified minute-flash malfunction and declined dispatch. Invalid voice SDP400. Original manual bytes/hash matched; anonymous endpoint302 to authentication. Final-patch hosted checks are recorded separately below.

## Conclusion within the measured scope

The evaluated material failures were corrected and retested. The project demonstrates the requested architecture, real Hybrid evidence retrieval, Hebrew text/voice and explicit scope/capability boundaries. It is suitable to present as an assignment demo with the evidence and limitations stated here. It is not a claim that every future answer is correct, nor that all devices or acoustic environments were tested. Current visual confirmation of the new drawer and physical-device/noise testing remain unverified.


## Final deployed source

The last charging-warning correction is source `33873b247aff2873715d3343411e99287040b393`. Vercel reports READY for `dpl_2UHSJFTJgcKUFN9LhB5mV5nTnbzq`, exact URL https://colmobil-rag-assignment-6tm0bkmxg-idanharari11s-projects.vercel.app ; the stable alias points to it. Git SHA is verified in `final-vercel-metadata.json`. Final local gates passed. The two-case targeted response report is `colmobil-answers-1793027352130.json`, with both source-backed branches returning the intended bounded answer.

Final hosted response evidence: `colmobil-deployed-33873b2.json`. Broader 14 valid-question hosted checks on preceding source are preserved in `colmobil-deployed-bfdf00f.json`; they do not substitute for testing the final changed branch. The final hosted run rechecks charging, oil distinction, active oil warning, unknown steady TPMS, input validation, health, Hebrew/RTL home, original manual hash and anonymous protection. Raw generated responses are retained so HTTP success alone is not mistaken for correct content.
