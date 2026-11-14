# HW4 review summary (DRAFT for the student to edit)

Status: drafted by the coding agent from the saved state files, for the student to edit. Items marked **PENDING** are not done.

## Reviewed sample: size and composition

105 distinct traces, drawn from 325 `support-*` traces (250 sessions) in the Module 1 trace store. One Langfuse trace is one user turn; multi-turn scenarios are reviewed as threads and judged turn by turn.

| Batch | Method | Traces | Why |
|---|---|---|---|
| 1 | uniform | 15 | unbiased baseline |
| 1 | cluster (k-means on trace features) | 15 | variety across behavior clusters |
| 2 | stratified by action type | 30 | make sure write actions are represented |
| 3 | depth search (retrieval signals, every suggestion reviewed) | 25 | look for more instances of confirmed modes; 5 suggestions accepted, 10 rejected |
| 4 | uniform | 15 | convergence check (the final 15) |
| thread siblings | other turns of sampled threads | 5 | context for multi-turn judgments |

Because of the clustering, stratification and depth search, the sample is deliberately not representative. All fractions below are **sample fractions, not prevalence estimates**. HW5 will estimate prevalence on the full trace store.

## New modes in the final 15 traces

**0.** The convergence rule was recorded before the batch-4 review (a new mode is a failure that fits none of the six modes and either violates a SPEC.md requirement or would plausibly mislead or harm the user). Two design observations were raised and set aside by the reviewer as not failure modes: `df294f4e` (the `search_products` store parameter is ambiguous between name and id) and `500f25c9` (no product-to-store lookup).

Limit: the batch-4 draw contained no write-tool traces, so it cannot show whether `write_without_confirmation` has settled. It is a 15-trace sample.

## Failure modes and sample fractions (Part E)

Every mode was judged for every trace, separately (a trace can fail several modes). Scores are in Langfuse (one per trace and mode, 105 each) and in `analysis/state/labels/<mode>.jsonl`.

| Mode | Fail | Pass | Sample fraction |
|---|---|---|---|
| `over_explaining` | 63 | 42 | 60% |
| `editorial_commentary` | 40 | 65 | 38% |
| `claim_exceeds_evidence` | 27 | 78 | 26% |
| `write_without_confirmation` | 24 | 81 | 23% |
| `escalation_handling` | 23 | 82 | 22% |
| `misses_available_lookup` | 14 | 91 | 13% |

Traces with no failure in any mode: 18 of 105. Traces failing 1, 2, 3 and 4 modes: 26, 27, 25 and 9.

HW5 needs at least 30 Pass and 30 Fail per mode. Every mode has 30 or more Pass. Four modes have fewer than 30 Fail and need synthetic scenarios: `misses_available_lookup` (14), `escalation_handling` (23), `write_without_confirmation` (24) and `claim_exceeds_evidence` (27). `over_explaining` (63) and `editorial_commentary` (40) are enough. **PENDING:** generating the synthetic scenarios.

## One taxonomy revision

`claim_exceeds_evidence` was widened during Part E. It started as two parts: (a) a capped search result presented as the whole set, and (b) a promised outcome (what a human "will" do). While judging, the student failed several replies that were neither: 0012 turn 2, 0048 turn 2 (a product name copied from the user's wording), 0065, 0126 turn 2, 0189 (a date not in the result) and 0231. A third part (c) was added: a fact, status, cause or date that the tool output or policy does not give. The history entry is in `patterns.json`.

Other revisions made from the student's own test cases: `escalation_handling` was narrowed from "wording of an escalation message" to *when* escalation is offered; `editorial_commentary` was rewritten from "any exclamation or valence word" to reaction versus status after the student's labels contradicted the first draft; `asks_for_retrievable_info` was renamed `misses_available_lookup` and defined by what the platform holds, with a cause tag (agent choice or tool gap).

## SPEC.md revisions

Error analysis showed behaviors the specification did not require, so `SPEC.md` was revised (the revisions are in the same commit). Each is tied to the annotations that motivated it. SPEC.md does not change the running agent; `agent/agent.py` still carries the old prompt.

| Revision | Mode | Motivating annotations |
|---|---|---|
| **RESP-6** (new): name a write action in an earlier turn and proceed only after the user continues; a first-turn directive does not replace this | `write_without_confirmation` | 0137: "Offer to cancel instead of canceling out right"; 0184: "should not jump to cancel right away"; first-turn refunds such as 0009 |
| **ESC-5** (new): do not offer escalation unprompted once policy or a lookup gives a clear answer; offer it on request or after pushback | `escalation_handling` | 0206: "don't proactively escalate"; 0161 turn 2; 0152 turn 2: "no reason to believe this needs to be escalated" |
| **RESP-7** (new): state only what tool output or a cited policy supports; say when a result is capped; describe a human's follow-up only as a response within the SLA, never as an outcome | `claim_exceeds_evidence` | 0108 (capped list as a "collection"); 0034 turn 3 ("arrange a replacement"); 0132 ("process the refund within 24 hours"); 0048 turn 2 comment |
| **RESP-5** (amended): explain the decision once, with no praise, celebration or opinion; bare status and regret when refusing are allowed | `editorial_commentary`, `over_explaining` | 0153: "Do not exclaim or be overexcitable"; 0161 turn 1: "No celebration needed"; 0230 turn 1: "why are we excited about this"; 0104: "too much explanation" |

Requirement sources for the other mode: `misses_available_lookup` maps to AUTH-1 and the tools section, with RESP-3 as the nearest rule. RESP-3 currently allows asking for missing information, so a requirement to look up orders and context first is a candidate but was not added. RESP-4 and AUTH-1 were not specifically sampled (see the manifest).

## Additional Notes
- Part C (Raindrop Workshop) was skipped, so there is no `workshop_notes.md`.
- No LLM judge was run; in Part E the coding agent drafted a present, absent or unsure pre-mark for every trace and mode from the written rules. The student reviewed each pair and saved every label.
