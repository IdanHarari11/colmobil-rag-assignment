# Live QA continuation — 2026-10-25

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
