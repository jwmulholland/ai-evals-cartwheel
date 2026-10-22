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

- Part E: Langfuse signed in; server running on :8010. Five requests sent (hw1-session #1, #4, #5, #6, #9). prompt_version for all = dc1aea7242e1.
  - #1 shopper 1: get_order allowed (student saw role/user_id/permission_denied=false on tool span)
  - #4 merchant 9002: get_order DENIED (permission_denied=true, reason recorded) then list_my_orders; store_id "2" present. Candidate for hw2-traces.json.
  - #6 shopper 1: no tool span (model refusal)
  - Still to inspect: root span attributes (user_role, user_id, prompt_version, gen_ai.input/output.messages), a model-call span

- Part C verified live on #9 root span: session_id, user_role, user_id, prompt_version present; scenario_id absent. (Input panel not yet confirmed by student.)
- `hw2-traces.json` saved by student (traces #4 = 780f135f…, #9 = dd142ec6…); structure validated (2 objects, 7 fields each).
- Observed oddity: model-call spans show 0 output tokens (cause unknown; may be a pinned-integration gap).

- Part F: baseline (current prompt) `dc1aea7242e1` vs earlier HW1 prompt (the "Answer policy questions concisely" line removed) `d108f6949e5e`. Student confirmed B in Langfuse. Prompt restored: `git diff` on agent/agent.py is empty and identical to saved copy; server restarted (active_sessions 0).

- Restored prompt confirmed live: dc1aea7242e1.
- Full suite: with Langfuse configured and holding only HW2 traces, 148 passed + 1 failed (Module 2 test `test_m2_run_judge_persists_store_predictions_for_prevalence` wants Module 2 trace slice from Langfuse). With `LANGFUSE_PUBLIC_KEY= LANGFUSE_SECRET_KEY=` blanked for the command: 149 passed, 4 skipped, 18 xfailed, 9 xpassed, 0 failed.

## Remaining (student)
- Video (5 min max) and assessments
- Decide what to commit (do not commit .sessions.db-wal/-shm, hw2-progress.md optional)
- Re-run full suite (`uv run pytest`) now that Langfuse is up
- Final: confirm Files to commit exist; video + assessments are the student's
