# Build prompt for the review interface (HW4 Part A)

The prompt given to the coding agent (a subagent) to build `analysis/review_app/`, kept as sent. It followed the design proposal and the decisions recorded in `friction_notes.md`. Corrections and follow-up changes made after the first build are listed at the end, so the record shows what the prompt got wrong and what was changed by hand afterward.

## Prompt as sent

You are building a trace-review web interface for a course repo at `/Users/jamesmulholland/Documents/GitHub/ai-evals-cartwheel` (Cartwheel support-agent homework, HW4). Write ONLY under `analysis/review_app/` (create it). Do NOT modify `analysis/server.py`, `analysis/ui/index.html`, `analysis/helpers/`, `SPEC.md`, or anything in `analysis/state/` (do not overwrite or delete any existing file there, especially `analysis/state/labels/unsupported_policy_claim.jsonl`). Do not run any live model calls, do not print or read secret values from `.env`, do not run git commands that change anything, do not commit. You may start the server briefly on a local port ONLY to smoke test it against GET endpoints with curl, and must stop it afterwards. Report exactly what you built and what you tested.

Read first: `analysis/server.py` (reference API/server), `analysis/ui/index.html` (reference UI), `analysis/helpers/langfuse_io.py` (`is_configured`, `fetch_traces`, `write_label_score`), `SPEC.md`. Reuse the API shape (`/api/samples`, `/api/annotations`, `/api/graph`, `/api/patterns`, `/api/suggestions`) but the result must not be the reference unchanged.

### Data facts (verified)

- Local export: `traces/support_traces.json` = `{exported_at, scenario_count, trace_count, traces:[...]}`, 325 traces / 250 scenarios. Each trace has `id` (32 hex), `cartwheel_scenario_id`, `timestamp`, `input` (list of `{role, parts:[{type,content}]}`), `output` (same shape; final assistant reply), `latency`, `totalCost`, `scores`, `metadata.attributes` with keys `cartwheel.session_id`, `cartwheel.user_role`, `cartwheel.user_id`, `cartwheel.scenario_id`, `cartwheel.prompt_version`, and `observations[]`.
- Langfuse's own `sessionId` is identical for all traces: DO NOT use it. Group sessions by `metadata.attributes["cartwheel.session_id"]`; order a session's traces oldest first by timestamp. Sessions have 1-3 traces.
- Observations: wrapper spans `cartwheel.session_message`, "Agent Workflow", `cartwheel-support.agent` carry no useful content; ignore them. GENERATION observations (name `openai.response`, sort by `startTime`) have output null. The assistant's narration, tool calls, and tool results appear only as messages inside the LAST generation's input: roles system/user/assistant/tool, assistant parts of type text, thinking, tool_call (`{id,name,arguments}`); tool parts of type `tool_call_response` (`{id, response}`) where response is a Python-repr string (True, single quotes). The final reply is the trace output. Rebuild each turn from the last generation's input (messages after the first user message of this turn) plus the trace output.
- TOOL observations (type TOOL, name = tool name, input = args dict, output = clean JSON dict, sort by `startTime`) hold clean tool results; prefer them over the Python-repr strings (pair by order / name+args). Tool result shapes: `ok:true` with `orders` (list), `order` (dict), `products` (list), `results` (list of help-center hits), `refund_id`/`status`, `ticket_id`; `get_policy` returns policy body. Failures: `ok:false` with `error` in {`permission_denied`, `not_found`, `not_eligible`, `invalid_argument`, `paused`} and `reason`.
- Thinking text is never available. Never invent reasoning. *(This statement was wrong. See corrections below.)*
- Roles: shopper, merchant, support.

### Loading

If `analysis.helpers.langfuse_io.is_configured()` is true, try the live fetch (`langfuse_io.fetch_traces`) but fall back to the local export if it returns nothing or errors; otherwise use the local export. Expose which source was used in the header details and in a `/api/source` endpoint. Keep the 32-char Langfuse trace id as the identifier everywhere. Provide a loader module so tests run offline against the export.

### Layout (information hierarchy)

- Left rail: sessions, searchable by scenario id, message text, role (instant client-side search, no filter setup). Each row: scenario id, role badge, turn count, reviewed dot.
- Header (always visible): scenario id, role badge, user id, turn count, red status badge(s) when any tool in the session returned `ok:false` showing the error code (e.g. `permission_denied`). Cost, latency, model, prompt version, data source behind a closed "details" toggle. A "View spec" button (see below) is in the top bar on every view. Tabs: Review, Taxonomy, Label, Progress, Suggestions, Map.
- Review (thread): oldest turn first, one block per trace with a divider and the trace id shown small.
  - USER message, full prominence.
  - Collapsed row under it: "no thinking recorded" (plain text, not clickable; render it only when that turn's assistant messages contain a thinking part) • "▸ Tool calls (n)" (clickable toggle; plain text, not clickable, when n=0). Error badges (e.g. `permission_denied`) stay visible in this row even when closed.
  - Expanded tool calls: ordered steps, each with the assistant narration for that step, call name and arguments (compact single line), and the result as a table or card (orders list/order dict/products/search results/refund & ticket confirmation as a small card; errors as a red status badge with reason); lists longer than 5 rows show 5 plus a "show all N rows" toggle. Only the compact JSON fallback for unknown shapes.
  - Final assistant reply, full prominence.
  - System prompt shown once per session, collapsed, not dimmed.
  - Keyboard shortcut to expand/collapse all tool-call rows in the session.
- Quiet metric defaults: cost/latency hidden.

### Required features

1. Whole conversation (user, narration, retrieval, tool calls, tool results, reply) grouped by session.
2. Free-text annotation: select text, popover, Enter saves; highlight plus a right-margin note aligned to the highlight; no JSON editing. Anchor to the selected occurrence (store the block id and character offsets, not first-indexOf), so repeated phrases highlight correctly. Each annotation stores `trace_id`, block id, offsets, quote, note, `ts`, `id`. Allow marking a trace "no failure observed". Save on every change; keep a localStorage backup wrapped in try/catch.
3. Taxonomy view: modes from `/api/patterns` (definition, status, supporting annotations/trace ids, click to jump).
4. Label view: for each trace and each final mode a present/absent (Fail/Pass) choice; incomplete judgments clearly indicated. Saved judgments are stored per trace id.
5. Progress view: reviewed vs unreviewed traces and incomplete judgments per mode.
6. Suggestions: AI suggestions from `/api/suggestions` shown separately from human annotations (dashed style, "agent suggestion" tag), explicit accept and reject; accepted ones become human annotations marked `source: accepted_suggestion`; rejections must be recorded (keep a rejected list in the POST so rejected suggestions are retained, e.g. status field), because the homework requires at least one rejected suggestion saved.
7. Map tab: 2D scatter from `/api/graph` (nodes with x, y, `trace_id`, cluster), cluster colors, sampled larger nodes with dark border, annotated nodes orange, hover tooltip, click a sampled node to open its session. Show a clear empty state when `graph.json` is empty/missing ("No projection yet; generated in Part B").
8. Persist accepted binary judgments: via the existing server path they become Langfuse scores (use `langfuse_io.write_label_score` only when `is_configured()`; offline it must silently skip) AND matching local files, one JSONL per mode under `analysis/state/labels/<mode>.jsonl` (append/replace per `trace_id`). Never write or modify `unsupported_policy_claim.jsonl`. Notes -> `analysis/state/annotations.json`, patterns -> `patterns.json`, suggestions -> `suggestions.json` (same files the reference uses; these are currently empty). Write atomically. The app server should expose POST endpoints for these.
9. VIEW SPEC button (top bar, all views): opens a large scrollable modal showing a rendered markdown preview of the repo-root `SPEC.md`, with a table-of-contents navigation column on the left generated from its headings (h1/h2/h3) so the reader can jump to a section quickly (clicking scrolls the content pane; highlight the section currently in view). Add a `GET /api/spec` endpoint serving SPEC.md's text read from the repo root. Implement a small built-in markdown renderer (no CDN) that handles headings, paragraphs, bold/italic, inline code, lists, tables, and horizontal rules; requirement ids like **RESP-2.** should stand out. Close with Esc, the close button, or clicking the backdrop. Also make requirement-ID tokens (patterns like AUTH-1, ESC-3, RESP-2, SCOPE-1, TOOL-7, PURPOSE-1) in the app (e.g. in the Taxonomy view) open the spec modal at that requirement if easy; skip if it complicates things.

### Constraints

- Python 3 standard-library-only server (`http.server`) at `analysis/review_app/server.py`, default port 8030 (`--port` flag), serving a static UI (`analysis/review_app/static/` or a single `index.html`). No CDN, works offline. Bind 127.0.0.1.
- Visual design: clear information hierarchy; user message and final reply most prominent, tool activity secondary, metrics tertiary; consistent role colors; accessible contrast; tool/error badges unobtrusive but visible.
- Add `analysis/review_app/README.md` (how to run, API list, the data facts above briefly) and `analysis/review_app/test_loader.py` (pytest-compatible and runnable offline) that loads the export, checks session grouping uses `cartwheel.session_id` (325 traces; sessions of size 1-3), and reconstructs one turn (support-0164 trace `4e10f77effcab7e4bc647f77ac1bab5d`: 3 tool calls `find_order`, `get_order`, `issue_refund` in order, final reply starting "Done!"), plus one test that a session with an error (find any trace with an `ok:false` tool result) yields an error badge value. Run the test and report the result.
- Do not create `analysis/report` files; do not touch git.

When done, reply with: the file list, how to start it, what you smoke-tested and the results, and anything you could not implement or are unsure about.

## Corrections and follow-up changes after the first build

- **Thinking text.** The prompt said thinking text was never available. That was wrong: each thinking part holds its text in a `thinking` field, next to an opaque `signature`. The loader now reads it, and the interface shows a `Thinking` toggle beside `Tool calls (n)`. Thinking is display only, not annotatable. Each turn has at most one thinking block of its own; the apparent extras in follow-up turns are earlier turns' history repeated in the input.
- **Tabs.** The tabs moved to the top bar, because Taxonomy, Label, Progress, Suggestions and Map work across all records. The session rail and session header show only on Review.
- **Colors.** User messages are white with a border and a green accent; assistant replies carry a pink accent; the page background is lighter; tool calls sit in a tinted panel. Role badges are teal (shopper), purple (merchant) and blue (support) to avoid clashing with the green and pink.
- **Environment loading.** The server does not load `.env`, so it silently falls back to the local export even when Langfuse is available (found when testing live loading).
