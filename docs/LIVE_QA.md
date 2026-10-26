# Live QA history — 2026-10-25 onward

Earlier entries below are chronological snapshots, including resolved blockers. Current candidate findings are in [RELIABILITY_2026-10-26.md](RELIABILITY_2026-10-26.md).

This is a tested development candidate, not a production-ready release. Final deployment and acoustic results are recorded below as they complete.

## Evidence so far

- Read START_HERE, CODEX_HANDOFF, original assignment DOCX and architecture/process/evaluation/QA documents.
- Created dedicated key Colmobil in selected Personal/Default project, 30-day lifetime, ignored `.env.local`; never committed or logged the value.
- Real indexing: 646 newly embedded chunks, text-embedding-3-small, 1536 dimensions. Source SHA-256: `29c33530abe4d7b37fd1862f18a294295456c317ef27d30fbe984668eb9f562d`.
- Original PDF pages 131 and 528 visually reviewed. Oil pressure differs from oil level. Towing guidance distinguishes 2WD and 4WD; unsolicited towing instructions are unsuitable when the customer merely requests dispatch.
- Balanced pilot: 10/10 provider calls completed. First run failed the towing response status and returned unsolicited towing procedures. Follow-up oil query missed page 131. Subsequent runs retained in eval_results, not overwritten.
- Added search-only bridge from everyday oil-pressure wording to manufacturer wording. Follow-up now retrieves/cites page 131 in measured regressions.
- Full initial development run: 40/40 completed, 0 provider errors; 2 status failures (`vague`, `tyre-value`). Semantic review found unsolicited numbers, coolant-cap procedure, irrelevant Bluelink advice and unsupported gas-containment wording. Those are failures despite valid citations.
- Eight-case targeted regression after clearer missing-context policy and temperature=0: 8/8 structural statuses accepted. Vague warning now asks for clarification; tyre size required before PSI; driving instruction limited to safe stopping; smoke answer removed invented gas containment. Hot-cap answer still volunteers a later opening procedure despite the prompt; this remains a known response-quality limitation, not a claimed fix.
- Local selected tests initially failed because missing-key test reloaded the newly provisioned `.env.local`; fixed the test to set an explicit empty variable. Local lint initially included static preview bundle; excluded the separately built archive. Subsequent selected gates passed before later changes; final candidate gates must be rerun.

## Interpretation

Quality review is AI-assisted, not independent human adjudication. Reference-page hits do not show that every claim is supported. Five-question historical smoke results, seven-question comparison, pilots and the exposed 40-case suite are distinct denominators. No blind generalization claim is made. Human microphone/listening/mobile/noise validation remains a release gate until actually performed.

## Latest candidate evidence

- `pnpm test:gates`: TypeScript, lint, 24 support tests, 16 core tests and production build passed on the latest application source. One new timeout regression covers microphone permission that never resolves.
- Latest 40-case report `eval_results/colmobil-answers-1792951879499.json`: 40/40 completed, 0 provider errors, 40/40 allowed-status checks and 40/40 allowed-escalation checks. This is structural behavior, not 40 semantically certified answers. Source claims were spot-checked with AI assistance; complete independent review remains pending.
- Fresh 12-case report `colmobil-answers-1792950957326.json`: 11 responses, 1 safe validation/error result; two escalation mismatches and TPMS interpretation/retrieval gaps were observed. The set became exposed during diagnosis; no blind quality claim is made.
- Latest six-turn actual-history conversation report: no provider errors. Oil-to-tyre correction now distinguishes the one-minute TPMS malfunction sequence, vehicle switch refuses, unknown steady indicator asks whether it flashed, and tow request does not claim dispatch. Fixture histories and actual generated histories remain distinct.
- A deterministic server safety pause prevents model-generated app procedures when the current question explicitly says driving resumed. A hot-cap guard suppresses volunteered opening steps in the measured scenario. Professional-help recommendations get consistent service escalation. Narrow patterns do not establish universal safety.
- Real Realtime provider test: synthetic Hebrew PCM input → actual server VAD → gpt-4o-transcribe Hebrew → supportAsk Hybrid → isolated speech response. Recognized: “נדלקה לי נורה צהובה בלוח המכוונים. מה לעשות?” The small spelling error did not change the meaning. Approved answer and provider output-audio transcript matched exactly; 288,000 PCM output bytes (~6 seconds at 24kHz mono PCM16). No error events. Report: `eval_results/colmobil-voice-provider.json`.
- This audio test used WebSocket transport, not browser WebRTC. It does not establish acoustic fidelity, pronunciation, live microphone, noise, echo, barge-in or mobile success. A synthetic fixture is included under `eval/audio` for reproducibility and is not indexed as knowledge.
- Real Chrome UI showed Hebrew/RTL, generated an answer and opened numbered source cards with PDF-page links. Microphone setup remained “connecting”; manually ending it restored the text composer. The new connection deadline addresses that hang, but no successful browser audio round trip is claimed.
- The original protected Vercel deployment `dpl_9XkbuU93CDxdxNwiiAkzMbLcx5vK` built source `b062b469c44d123e469f56b8e9b01bbaa7f79df1`. Authenticated GET `/api/support` returned 200 and `configured:false`. This proves the app is deployed but the dedicated hosted key is absent. GitHub upload is verified separately from hosted AI readiness.

## Remaining release gates

1. Renew local Vercel authentication, save the existing dedicated key as a sensitive server env variable in the existing project, rebuild and verify the exact candidate SHA. Do not create another OpenAI key.
2. Run provider-backed HTTP/UI text on the deployed candidate and inspect source links/manual bytes. Preserve deployment protection.
3. Complete real microphone and listening checks in Hebrew, numerals and vehicle terms, interruptions during retrieval/playback, permission denial, reconnect, noise/echo and actual mobile layout.
4. Independently review technical claims and safety completeness, including oil shutdown advice, TPMS distinctions and table extraction. Prompt/ID/regex validation does not prove grounding.

The first two are currently blocked by expired local Vercel authentication, for which a device-login approval was requested. Work is not labeled ready while these gates are open.


## Hosted completion update

Vercel authentication was renewed after the user approved device login. The existing Colmobil key was saved as a **Secret** for Production and Preview on the original project; no new key was created. A fresh production build used application-source SHA `66588709d1f86c7c24d2ffa4329b7ffab26fa708`.

- Deployment: `dpl_HL1xaT4MVEQXHNoKmYrqydm8g78G`, READY. Exact URL: https://colmobil-rag-assignment-b82xxzjah-idanharari11s-projects.vercel.app . Stable alias: https://colmobil-rag-assignment.vercel.app .
- Authenticated GET health/home: 200; health `configured:true`; Hebrew/RTL homepage. Anonymous health request: 302 to authentication; deployment protection retained.
- Actual hosted model calls: TPMS 200/answered/Hybrid, unrelated code request 200/out_of_scope, hot cap 200/insufficient_evidence with bounded safe wording, resumed driving 200/clarification_needed/safety_pause. Empty question: 400.
- Hosted PDF: 21,850,407 bytes, SHA-256 identical to the original supplied manual.
- Actual hosted four-turn conversation: unknown yellow light → clarification; steady TPMS → asks about preceding flash; confirmed minute flashing → grounded malfunction answer; tow request → states it cannot dispatch. Malformed SDP: 400.
- Chrome on the exact hosted deployment generated a Hebrew TPMS answer, displayed simulated handoff, expanded numbered sources and linked PDF pages 510 and 512. Screenshot visually confirmed the RTL layout.
- Reports: `eval_results/colmobil-deployed.json` and `colmobil-deployed-conversation.json`.

The earlier expired-authentication blocker is resolved. Remaining gates are actual browser microphone/audio/listening, interruption/noise/mobile tests and independent semantic review. The user was offered an assisted microphone test; no response or successful acoustic test is assumed. This final documentation update changes no application source relative to the tested SHA.


## Continuation — 2026-10-26

See `SOURCE_REVIEW_2026-10-26.md` for the original-PDF review, failed high-voltage/diagnostic claims and measured corrections. The user is operating the browser themselves after declining the browser-origin permission. Their screenshot revealed a hidden voice footer, which was fixed by keeping composer controls in the viewport. A single circular voice/send/end-call action was implemented at their request. Actual visual/mobile and human microphone results must still be reported; no acoustic success is inferred.

## User-assisted voice and responsive feedback

On 2026-10-26 the user reported that the waveform button and all voice-related functionality worked in their browser. This is user-reported confirmation, distinct from instrumented acoustic measurements. They clarified that their mobile observation was Chrome desktop device emulation for iPhone 16 Pro Max, not a physical iPhone. They found that new chat was unavailable because the sidebar was hidden.

Added a mobile menu button and native modal sidebar with new-chat access, close button, backdrop dismissal, Escape handling and native focus containment. New chat closes the drawer and resets the text composer. TypeScript, lint and production build passed. Visual/emulated-device verification of this drawer remains user-assisted; no physical-device success is claimed.


## Final audit continuation — 26 October 2026

Current findings, closed defects, review disagreements and remaining visual/device limits are in RELIABILITY_2026-10-26.md. Final application source is 33873b247aff2873715d3343411e99287040b393. Complete exposed76 regression, all76 original-source model reviews, actual-history conversations, targeted final-patch regressions and final local gates are retained. The report separates their source versions and does not label reviewer disagreements as automatic passes.
