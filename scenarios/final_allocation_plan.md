# Final scenario allocation plan (Part C)

Working document, not a deliverable. Targets for `scenarios/support_scenarios.jsonl`: 250 scenarios, ids `support-0001` to `support-0250`.

## Groups

| Group | Count |
| --- | --- |
| coverage | 175 |
| challenge | 75 |

## Carry-over from the pilot

The 30 reviewed pilot scenarios are renumbered `support-0001` to `support-0030`, with the scenario changes from `pilot_review.jsonl` applied. They count toward the totals, so about 220 are newly generated: 157 coverage and 63 challenge, including 24 damaged-record scenarios (the pilot already has one for each of the six records).

## Challenge set (75)

| Slice | Count | Notes |
| --- | --- | --- |
| Damaged records | 30 | 5 for each of the 6 records: orders 8001, 8002, 8003 and products 2, 3, 4. Each is an objective scenario sourced from `data_quality_table`. `validate.py --final` requires exactly 5 per record, so this slice cannot shrink. |
| Store window overrides | 14 | Saltbox 7 days, Juniper 14, Meridian 21, Northwind 45: three or four each, a mix of inside, on the last day and outside the window. |
| Authorization boundary | 9 | Shopper asking about another shopper's order (4); merchant asking about another store's order (5). |
| Above-threshold refunds | 3 | ESC-1: eligible orders over $100, queued for a human. |
| Ambiguous or missing information | 13 | Several matching orders, no identifying detail, or odd and unclear requests meant to push the agent off the happy path. |
| Correction across turns | 6 | The user corrects or adds a detail in a followup that never depends on the agent's reply. |

## Coverage set (175), intent by role

| Intent | Shopper | Merchant | Support | Total |
| --- | --- | --- | --- | --- |
| order_status | 16 | 8 | 6 | 30 |
| refund | 16 | 6 | 8 | 30 |
| return_deadline | 14 | 4 | 4 | 22 |
| cancellation | 9 | 4 | 5 | 18 |
| product_search | 14 | 4 | 2 | 20 |
| policy_question | 11 | 5 | 4 | 20 |
| item_issue | 9 | 1 | 2 | 12 |
| dispute_escalation | 6 | 3 | 3 | 12 |
| out_of_scope | 7 | 2 | 2 | 11 |
| **Total** | **102** | **37** | **36** | **175** |

## Roles overall (250)

| Role | Coverage | Challenge | Total |
| --- | --- | --- | --- |
| shopper | 102 | 51 | 153 |
| merchant | 37 | 14 | 51 |
| support | 36 | 10 | 46 |

## Mix across all 250

| Dimension | Value | Count |
| --- | --- | --- |
| request_precision | order_id_given | 62 |
|  | product_name_and_rough_date | 50 |
|  | product_name_only | 38 |
|  | vague_description_only | 38 |
|  | product_name_and_store | 25 |
|  | store_only | 20 |
|  | not_applicable | 17 |
| user_style | neutral_conversational | 62 |
|  | operational_shorthand | 38 |
|  | terse_fragmentary | 30 |
|  | frustrated_impatient | 30 |
|  | typo_heavy | 25 |
|  | confused_rambling | 25 |
|  | requests_short_plain_answer | 25 |
|  | repetitive_pressuring | 15 |
| difficulty | well_specified | 112 |
|  | ambiguous | 55 |
|  | boundary | 45 |
|  | missing_information | 38 |
| tools_needed | one_lookup | 112 |
|  | several_calls | 55 |
|  | lookup_then_action | 38 |
|  | none | 25 |
|  | lookup_then_escalate | 20 |
| turn_count | 1 turn | 190 |
|  | 2 turns | 45 |
|  | 3 turns | 15 |

### Difficulty by group

| Difficulty | Coverage | Challenge | Total |
| --- | --- | --- | --- |
| well_specified | 105 | 7 | 112 |
| ambiguous | 30 | 25 | 55 |
| boundary | 20 | 25 | 45 |
| missing_information | 20 | 18 | 38 |
| **Total** | **175** | **75** | **250** |

## Rules carried from the pilot

- A message holds only what its `request_precision` label allows (no store or date unless the label says so).
- Followups never depend on what the agent replied.
- `operational_shorthand` is mostly merchants and support staff.
- Every state-changing scenario targets its own order, so no two scenarios touch the same order.
- Extra metadata comes from SQL, `is_refund_eligible`, policy documents or the damaged-records table, never from the model.
- Run `scenarios/lint_alignment.py` and `scenarios.validate` after every batch.

## Review and monitoring picks (proposed after generation)

- 15 for your review: both groups, all three roles and all nine intents.
- 50 for monitoring: stratified by group, role and intent, chosen without regard to whether the agent failed.
