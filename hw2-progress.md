# HW2 progress note

## Deliverables
- [ ] `observability/instrument.py` (Part A)
- [ ] `server/app.py` (Parts B, C)
- [ ] `tests/test_observability.py` (Part D)
- [ ] `hw2-traces.json` (exactly 2 traces)
- [ ] Checks pass: create_session test, `-k hw2` tests, `test_observability.py`, full suite
- [ ] At least 5 traced requests from `hw1-session.jsonl` (Part E)
- [ ] Prompt-version comparison, two different hashes (Part F)
- [ ] Video, 5 min max (student)
- [ ] Assessments (student)

## Done
- Step 1: `uv sync` run

- Concepts: trace, span, attribute, gen_ai.* vs cartwheel.*
- Part A: both functions in `observability/instrument.py` done; offline fake-span check passed (live check in Langfuse comes in Part E)

- Part B: `create_session` written; `create_session_binds` test passed (1 passed)
- Part C: `post_message` written (student); untested until Part E (needs a live model)

- Part D: `tests/test_observability.py` written; `-k hw2` 1 passed, observability 2 passed
- Full suite (offline, Langfuse down): 148 passed, 1 failed. The failure is a Module 2 test (`test_m2_run_judge_persists_store_predictions_for_prevalence`) that needs Langfuse at localhost:3000. RE-RUN `uv run pytest` after Part E.

- Part E setup: .env has all needed settings (TRACELOOP_TRACE_CONTENT=true confirmed by student); Docker Desktop installed; Langfuse stack started (7 containers). Note: docker lives in ~/.docker/bin (not on the assistant shell's PATH).

## Next
- Part E: sign in at http://localhost:3000, start server, create session, 5+ traced requests
