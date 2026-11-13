# Langfuse review friction notes (HW4 Part A)

Raw notes from reviewing Cartwheel traces in the standard Langfuse view. The reviewer's words are kept as written. Lines marked "Implies" are a design requirement drawn from the note, for the interface proposal.

Reviewed: the three-trace session for scenario `support-0196` (trace IDs `641c1cd306f50a4c925ad2cfe6e362c0`, `f0aba6d092acf555ba151724fb5aa77e`, `3fd37883152bd3c5f69d31e355396e34`). The reviewer judged this enough to plan the interface.

## Finding and grouping

- Finding/filtering by scenario should be a first class activity. I should not need to establish the filter at any point.
  - Implies: scenario and session lookup built into the interface, with no filter setup.
- Threads are of course impossible to analyze properly across multiple trace records. Recency order matters but for threads should be reversed in order to replay the history.
  - Implies: merge a session's traces into one conversation, oldest first.

## Structure and hierarchy

- The 4 top-level nestings (session message, agent workflow, .agent) are distinctions that don't matter much for the analysis here. Much of the information is repeated or you have to narrowly choose the correct level.
  - Implies: flatten the wrapper layers into one view.
- The conversation content is most important as that's what's being evaluated. Everything else should be in the context of that. Sequence and context are lost as you dig deeper into things like the tool calls.
  - Implies: conversation is the main column; tool and model activity sit inside it, in sequence.
- The tool call hierarchy should be listed in order, with the LLM response to it as a sub-item of that given that there's a clear relationship to the two. The LLM calls I'm not sure are in the correct order but it's hard to tell. The initial call of the LLM includes a 'thinking' note that is critical context that is very different than processed inputs from tool call responses.
  - Implies: each tool call shown in order with the model's response beneath it; the model's initial reasoning shown apart from tool outputs.
- The timeline view is unimportant to me right now. The graph view is basically linear so it's not useful at the scale of the single trace.
  - Implies: leave out timeline and graph views.

## Emphasis and prominence

- Cost and seconds metrics are not useful upfront.
  - Implies: hide or demote cost and latency.
- Opening the hierarchies of the JSON responses is tedious. If there are any standard data structures, they should be shown as a table instead.
  - Implies: render common tool-result shapes (for example order records, result lists) as tables.
- Permission denied on a tool should be a top-level response flag (like a status badge).
  - Implies: surface tool error status, such as `permission_denied`, as a badge at the top level.
- Role established in the trace is good context to have at top level.
  - Implies: show user role in the trace header.
- Side thought: these issues are all about information architecture: emphasis, prominence through hierarchy, relative importance, and process that drives it.

## Input

- The corrected output option is highly technical in form, fully flexible in JSON format but would prevent flexible input.
  - Implies: take annotations as free-form text beside the content, not as JSON editing.
