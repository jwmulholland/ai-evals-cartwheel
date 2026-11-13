# Cartwheel trace review app

A local, offline-capable review UI for HW4 error analysis. Standard-library Python server plus a static UI (no CDN).

## Run

    python analysis/review_app/server.py              # http://127.0.0.1:8030/
    python analysis/review_app/server.py --port 8031
    python analysis/review_app/server.py --offline    # never try Langfuse

If `LANGFUSE_*` is configured the server tries `langfuse_io.fetch_traces()` at startup and falls back to
`traces/support_traces.json` when it errors or returns nothing. The source used is shown under "details" in the
header and at `GET /api/source`.

Tests (offline): `python -m pytest analysis/review_app/test_loader.py` or `python analysis/review_app/test_loader.py`.

## Files

- `server.py` HTTP server and persistence. `loader.py` trace loading, session grouping, turn reconstruction.
- `static/index.html`, `app.js`, `style.css`, `md.js` (built-in markdown renderer for the spec modal).

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/samples` | sessions, each with rebuilt `turns` |
| GET | `/api/source` | `{source: langfuse or local_export, detail, trace_count, session_count}` |
| GET | `/api/spec` | `{text}` from repo-root `SPEC.md` |
| GET/POST | `/api/annotations` | list; notes (`trace_id, block, start, end, quote, note, ts, id`) and `kind: "no_failure"` marks. Writes `state/annotations.json` |
| GET/POST | `/api/patterns` | `{modes: [{name, definition, status, ...}]}` to `state/patterns.json` |
| GET/POST | `/api/suggestions` | list with `status` pending, accepted or rejected (rejected ones are kept) to `state/suggestions.json` |
| GET | `/api/graph` | `{nodes:[{x,y,trace_id,cluster,sampled?}], clusters}` from `state/graph.json` (empty shows a Part B message) |
| GET/POST | `/api/labels` | POST `{trace_id, mode, label: 0, 1 or null}` (1 = failure present). Replaces the trace row in `state/labels/<mode>.jsonl`; also a Langfuse score only when `is_configured()`. `unsupported_policy_claim` is reserved and never written |

All writes are atomic (temp file then replace). The browser also keeps a localStorage backup (try/catch guarded).

## Data facts

- Export: `{exported_at, scenario_count, trace_count, traces[]}`, 325 traces over 250 scenarios.
- Sessions group by `metadata.attributes["cartwheel.session_id"]` (Langfuse `sessionId` is identical everywhere and ignored), oldest trace first; 1 to 3 traces each.
- A turn = the trace input (user), the messages after the last user message in the LAST generation's input (narration, tool calls), and the trace output (final reply). Wrapper spans are ignored.
- Tool results prefer clean TOOL observations (paired by name and args, in start order); the Python-repr string in the generation input is the fallback.
- Thinking text is never available; only "no thinking recorded" is shown when a thinking part exists.
- Block ids for annotations: `<trace_id>:user`, `<trace_id>:reply`, `<trace_id>:step:<n>` (narration). Offsets are characters within that block's plain text.
