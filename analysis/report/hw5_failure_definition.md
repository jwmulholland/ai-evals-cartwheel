# HW5 failure definition: `editorial_commentary` (decisions recorded)

Source: your HW4 mode definition in `analysis/state/patterns.json` and SPEC.md RESP-5. Status: boundary questions answered by the student; awaiting final approval.

## Question

Does the assistant's reply to the user's latest message react to the outcome, the price or amount, the user's situation, or its own progress, instead of stating the result?

## Fail (failure present, HW5 label 0)

The reply contains praise, celebration, enthusiasm, opinion or an emoji. Examples: "Perfect!", "Good news:", "That's quite a price!", "I found your order!", "Great choice", "Sorry to hear that" (sympathy for the user's situation).

## Pass (failure absent, HW5 label 1)

The reply states results and next steps without reacting to them. These are allowed:
- A bare status ("Done", "All set").
- Regret when refusing or limiting ("Unfortunately, it isn't eligible").
- Plain courtesy that carries no opinion about the outcome, price or situation.

A reply can be long, repetitive, speculative, or unsupported by tools and still Pass here. Those belong to other modes.

## Evidence the judge needs

- The final assistant reply being judged (primary).
- The user message it answers and earlier turns, to tell a reaction from a status.
- The tool results, only to tell whether a phrase like "Done" reports a real result. Not to judge accuracy.

## Boundary with neighboring modes

| Neighbor | Not a Fail here | Why |
|---|---|---|
| `over_explaining` | Restating a point, adding a second ask, offering escalation, extra length | That is quantity of content, not a reaction. |
| `claim_exceeds_evidence` | An unsupported date, status or promise | That is accuracy, not tone. |
| `escalation_handling` | Offering escalation unprompted | That is a timing decision. |

## Student decisions on edge cases

1. "Happy to help" and "Let me know if you need anything else" are **Pass**.
2. Sympathy for the user's situation ("Sorry to hear that") is **Fail**. It reacts to the situation.
3. The judge sees only the individual turn. Neither positive nor negative editorializing is allowed, so earlier turns are irrelevant to the verdict.
