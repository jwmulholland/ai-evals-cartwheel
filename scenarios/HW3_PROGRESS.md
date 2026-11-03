# HW3 progress note

Model: claude-haiku-4-5 (CARTWHEEL_MODEL in .env)

## Next
- Step 1 preflight: DB generated; Docker + Langfuse + server pending

## Status
- Part A dimension plan APPROVED.
- Pilot: scenarios/pilot_scenarios.jsonl written (30: 18 coverage / 12 challenge), validator passes. Part B DONE: pilot ran 30/30 (claude-haiku-4-5), student reviewed 10, 7 confirmed failures (scenarios/pilot_review.jsonl). NEXT: Part C allocation plan for 250 final scenarios (ids support-NNNN, new, not pilot-*), then generate, critic, lint, student reviews 15, 50 monitoring, validate --final. Data must be reset (seed.generate) before the Part D run.
- Next: student accepts sample -> run pilot -> review >=10 in Langfuse -> pilot_review.jsonl.

## Dimension plan (Part A) - approved
Escalation Reason is NOT a dimension: recorded in expected.reason citing ESC-1..4; used as an HW4 lens.
Intent gains item_issue; return vs policy_process_info boundary: "Can I return this?" = info, "start a return" = action.

## Done
- Preflight: DB generated, Langfuse up, server on 8010, test trace OK (output token counts missing; revisit in Part E)
- Read handout, SPEC.md, SKILL.md

## Deliverables
- [x] scenarios/pilot_scenarios.jsonl
- [x] scenarios/pilot-results.jsonl (30/30 completed; Langfuse trace count not yet checked)
- [x] scenarios/pilot_review.jsonl (10 reviewed, 7 confirmed failures; student verdicts)
- [x] scenarios/support_scenarios.jsonl (250 written; validate --final passes; lint 0 warnings; awaiting student's 15-scenario review)
- [x] scenarios/support_review.jsonl (15 reviewed: 8 accept, 6 revise, 1 reject; revisions applied, 0170 replaced)
- [x] scenarios/monitoring_scenarios.jsonl (50 written; 30 coverage / 20 challenge; 30 shopper / 11 merchant / 9 support)
- [x] scenarios/final-results.jsonl (250/250 completed: 175 coverage, 75 challenge; claude-haiku-4-5)
- [x] reports/smoke-output.txt (final report; includes pilot traces too; output_tokens 0 again)
- [x] traces/support_traces.json (325 traces, 250/250 scenario ids)
- [ ] Video (student)

## Spec gaps noted (HW4 lenses, not scenario changes)
- No requirement to confirm before cancelling (pilot-17): SPEC does not make the agent confirm a cancellation first.
- No escalation rule for a highly frustrated user once a refund is queued (pilot-10): ESC-1..4 do not cover it.
- Order records and list_my_orders carry product_id only, no product title (pilot-14): agent must not invent product names.

## Tools
- scenarios/lint_alignment.py <file>: warns when messages disagree with the tuple (precision, turn_count, followup openers, style). Warnings only; run it after every generation batch alongside validate.py.
- request_precision values: order_id_given, product_name_only, product_name_and_rough_date, product_name_and_store, store_only, vague_description_only, not_applicable.
- scenarios/pilot_viewer_server.py: review UI with flags and comments (scenarios/pilot_comments.json, not a deliverable).
- search_products results carry store_id but no store name, and no tool looks a product up by id (pilot-03, pilot-04): agent cannot compare a product's store to an order's store or map a store id to a name. get_order does add store_name. Candidate spec/tool change for later (not made, so the pilot and final runs use the same agent).

## Carry into Part C (from pilot review)
- Apply scenario_change notes: pilot-03 reason (agent cannot see product store; expect escalate), pilot-05 key (do not quote the bad price), pilot-06 message (full store name), pilot-09 message (explicit refund request).
- Rules learned: message must contain only what request_precision allows (no store/date unless the label says so); followups must not depend on the agent's reply; label tools_needed honestly (lookup_then_action etc.); keep style mix balanced (pilot was neutral-heavy); run scenarios/lint_alignment.py on every batch.
- Damaged records need 5 scenarios each (30 total); pilot has 1 each.

## Part C allocation (scenarios/final_allocation_plan.md)
- Student decisions: carry over the 30 pilots (renumbered support-0001..0030, scenario_change notes applied); more ambiguous/odd challenge cases (13). Damaged records stay 30 because validate.py --final requires exactly 5 per record.
- Status: plan revised, AWAITING student approval before generation.
- Student decision: keep action-scenario keys as is (no two-path rule); lookup_then_action keys still expect the action to complete. Revisit in HW4 if the agent asks before writing.

## Part C status
- support_scenarios.jsonl built: support-0001..0030 are the carried-over pilots (scenario_change applied), support-0031..0250 are new (writers + 5 critics + lint).
- 15 review picks saved in scenarios/review_picks.json (helper); student reviews them in the Final scenarios tab and writes support_review.jsonl. Viewer filters: For review, For monitoring.
- Part C complete. NEXT: Part D (reset data with seed.generate, run support_scenarios.jsonl into final-results.jsonl), then Part E.
- Part D DONE (student ran it): 250/250 completed. NEXT: Part E smoke report, trace export, three traces.
- Part E DONE: smoke report written, 325 traces exported for 250 of 250 scenarios. Student to open three traces (suggested: support-0210 challenge, support-0071 two turns, support-0050 challenge) and record the video.
