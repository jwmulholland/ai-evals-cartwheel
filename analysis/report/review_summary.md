# HW4 review summary (DRAFT for the student to edit)

Status: drafted by the coding agent from the saved state files. The student owns the final wording, the SPEC.md revisions and the video. Items marked **PENDING** are not done.

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

## Relationship to SPEC.md

| Mode | Requirement | Note |
|---|---|---|
| `escalation_handling` | ESC-3, ESC-4, RESP-4 | tension: ESC-3/ESC-4 say escalate when unresolved or unsure; the student's notes say not to offer it once policy settles the case |
| `claim_exceeds_evidence` | RESP-1 to RESP-3 | |
| `over_explaining` | RESP-5 | tension: RESP-5 asks for language that explains the decision, which pulls against saying each fact once |
| `write_without_confirmation` | confirmation before writes | the first-turn directive does not replace a second turn |
| `misses_available_lookup` | AUTH-1 / TOOL | RESP-3 allows asking for missing information; a new requirement would say to look up orders and context first |
| `editorial_commentary` | RESP-4 | |

**PENDING (student):** the exact SPEC.md revision wording, each with the motivating annotation. Candidate annotations: the 0001/0161/0206 notes (proactive escalation), the 0225 and 0189 notes (ungrounded claims), the 0137 and 0184 notes (cancel before confirmation), and the 0003 and 0144 notes (tool gaps). Not specifically sampled: RESP-4 and AUTH-1 (see the manifest).

## Open items

- **PENDING:** the student's video, SPEC.md wording, and final reading of this summary.
- Label questions raised during Part E and resolved by the student: 0137 turn 2 and 0184 turn 2 (`write_without_confirmation`, both now pass, since the agent named the cancel and the user continued); 0072 and 0206 (`misses_available_lookup`, both now fail); 0137 turn 2 (`editorial_commentary`, now pass). Still worth a last look: the emoji cases 0074 and 0215 (`editorial_commentary`, pass), because the student's own test sentence with an emoji was a fail, and 0161 turn 2 and 0227 turn 2 (fail with no reaction phrase found).
- Part C (Raindrop Workshop) was skipped, so there is no `workshop_notes.md`.
- No judge models were used. All labels are the student's; the agent only drafted suggestions, shown as pre-marks and never saved.
