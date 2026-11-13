"""Load Cartwheel traces and rebuild readable sessions/turns from them.

Source order: live Langfuse (only when ``is_configured()``) with a fallback to
``traces/support_traces.json``. Everything here is offline-safe and uses only
the standard library; Langfuse is imported lazily.

Key facts about the data (see README):
- sessions are grouped by ``metadata.attributes["cartwheel.session_id"]``
  (Langfuse's own ``sessionId`` is identical for every trace and is ignored);
- a turn is rebuilt from the LAST generation's input (messages after the last
  user message) plus the trace output (the final reply);
- clean tool results come from TOOL observations, with the Python-repr string
  in the generation input as a fallback;
- thinking text is in the "thinking" field of assistant parts with type "thinking".
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_PATH = REPO_ROOT / "traces" / "support_traces.json"


# ---------------------------------------------------------------- loading


def load_export(path: Path = EXPORT_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_traces(prefer_live: bool = True, path: Path = EXPORT_PATH) -> tuple[list[dict], dict]:
    """Return ``(traces, source_info)``.

    ``source_info`` = {"source": "langfuse"|"local_export", "detail": str, ...}.
    Live is tried only when Langfuse is configured; any error or empty result
    falls back to the local export.
    """
    note = ""
    if prefer_live:
        try:
            from analysis.helpers import langfuse_io

            if langfuse_io.is_configured():
                try:
                    live = langfuse_io.fetch_traces()
                    if live:
                        traces, info = _scope([_coerce(t) for t in live])
                        return traces, {
                            "source": "langfuse",
                            "detail": f"{len(live)} traces fetched live",
                            **info,
                        }
                    note = "Langfuse returned no traces; using local export. "
                except Exception as exc:  # network / SDK problems
                    note = f"Langfuse fetch failed ({type(exc).__name__}); using local export. "
            else:
                note = "Langfuse not configured (LANGFUSE_* not set in the environment); using local export. "
        except Exception:
            pass
    data = load_export(path)
    traces, info = _scope([_coerce(t) for t in data.get("traces", [])])
    return traces, {
        "source": "local_export",
        "detail": note + f"{path.name}, exported_at {data.get('exported_at')}",
        "exported_at": data.get("exported_at"),
        **info,
    }


# Only the course's final scenarios are reviewed. Langfuse also holds the HW3
# pilot runs (pilot-NN) and a preflight test, which are excluded.
SCOPE_PREFIX = "support-"


def _scope(traces: list[dict]) -> tuple[list[dict], dict]:
    kept = [t for t in traces if str(t.get("cartwheel_scenario_id") or "").startswith(SCOPE_PREFIX)]
    return kept, {"filter": SCOPE_PREFIX + "*", "excluded": len(traces) - len(kept)}


def _attrs(t: dict) -> dict:
    md = t.get("metadata") or {}
    return md.get("attributes") if isinstance(md.get("attributes"), dict) else md


def _coerce(t: dict) -> dict:
    """Accept raw export traces or normalized live traces; return export shape."""
    first = (t.get("observations") or [{}])[0]
    if "startTime" in first or "createdAt" in t:
        return t  # already the raw export shape
    out = dict(t)
    out["id"] = str(t.get("id") or t.get("trace_id"))
    attrs = _attrs(t)
    out.setdefault("cartwheel_scenario_id", attrs.get("cartwheel.scenario_id") or (t.get("meta") or {}).get("scenario_id"))
    if "attributes" not in (t.get("metadata") or {}):
        out["metadata"] = {"attributes": dict(attrs)}
    obs = []
    for o in t.get("observations") or []:
        o = dict(o)
        o["startTime"] = o.get("startTime") or o.get("start_time") or ""
        obs.append(o)
    out["observations"] = obs
    return out


# ---------------------------------------------------------------- helpers


def _text_of(messages: Any, roles: tuple[str, ...]) -> str:
    out = []
    for m in messages or []:
        if isinstance(m, dict) and m.get("role") in roles:
            for p in m.get("parts") or []:
                if p.get("type") == "text" and p.get("content"):
                    out.append(str(p["content"]))
    return "\n\n".join(out)


def _parse_repr(s: Any) -> Any:
    if not isinstance(s, str):
        return s
    try:
        return ast.literal_eval(s)
    except Exception:
        try:
            return json.loads(s)
        except Exception:
            return {"raw": s}


def _last_generation(trace: dict) -> dict | None:
    gens = [o for o in trace.get("observations", []) if o.get("type") == "GENERATION"]
    gens.sort(key=lambda o: o.get("startTime") or "")
    return gens[-1] if gens else None


def _tool_obs(trace: dict) -> list[dict]:
    obs = [o for o in trace.get("observations", []) if o.get("type") == "TOOL"]
    obs.sort(key=lambda o: o.get("startTime") or "")
    return obs


def _error_of(result: Any) -> tuple[str | None, str | None]:
    if isinstance(result, dict) and result.get("ok") is False:
        return str(result.get("error") or "error"), result.get("reason")
    return None, None


# ---------------------------------------------------------------- turns


def reconstruct_turn(trace: dict) -> dict:
    """Rebuild one trace into {user, steps, final, ...}. Never invents content."""
    attrs = _attrs(trace)
    gen = _last_generation(trace)
    gen_input = (gen or {}).get("input") or []

    user = _text_of(trace.get("input"), ("user",))
    last_user_idx = None
    for i, m in enumerate(gen_input):
        if m.get("role") == "user":
            last_user_idx = i
    if not user and last_user_idx is not None:
        user = _text_of([gen_input[last_user_idx]], ("user",))
    system = _text_of(gen_input, ("system",))
    tail = gen_input[(last_user_idx + 1) :] if last_user_idx is not None else []

    tool_obs = _tool_obs(trace)
    used: set[int] = set()

    def clean_result(name: str, args: Any, fallback: Any) -> Any:
        for pass_ in (0, 1):  # exact name+args first, then name only
            for i, o in enumerate(tool_obs):
                if i in used or o.get("name") != name:
                    continue
                if pass_ == 0 and o.get("input") != args:
                    continue
                if isinstance(o.get("output"), (dict, list)):
                    used.add(i)
                    return o["output"]
        return fallback

    responses: dict[str, Any] = {}
    for m in tail:
        if m.get("role") == "tool":
            for p in m.get("parts") or []:
                if p.get("type") == "tool_call_response":
                    responses[p.get("id")] = p.get("response")

    steps: list[dict] = []
    has_thinking = False
    thinking: list[str] = []
    for m in tail:
        if m.get("role") != "assistant":
            continue
        narration = []
        calls = []
        for p in m.get("parts") or []:
            if p.get("type") == "thinking":
                # The reasoning text is in "thinking"; "signature" is an opaque blob.
                has_thinking = True
                if p.get("thinking"):
                    thinking.append(str(p["thinking"]))
            elif p.get("type") == "text" and p.get("content"):
                narration.append(str(p["content"]))
            elif p.get("type") == "tool_call":
                calls.append(p)
        text = "\n\n".join(narration) or None
        if not calls:
            if text:
                steps.append({"index": len(steps), "narration": text, "call": None, "result": None})
            continue
        for j, c in enumerate(calls):
            args = c.get("arguments") or {}
            result = clean_result(c.get("name"), args, _parse_repr(responses.get(c.get("id"))))
            err, reason = _error_of(result)
            steps.append(
                {
                    "index": len(steps),
                    "narration": text if j == 0 else None,
                    "call": {"id": c.get("id"), "name": c.get("name"), "arguments": args},
                    "result": result,
                    "error": err,
                    "reason": reason,
                }
            )

    errors = [s["error"] for s in steps if s.get("error")]
    return {
        "trace_id": trace["id"],
        "timestamp": trace.get("timestamp"),
        "user": user,
        "steps": steps,
        "final": _text_of(trace.get("output"), ("assistant",)),
        "has_thinking": has_thinking,
        "thinking": thinking,
        "tool_count": sum(1 for s in steps if s.get("call")),
        "errors": errors,
        "latency": trace.get("latency"),
        "cost": trace.get("totalCost"),
        "model": (gen or {}).get("model"),
        "prompt_version": attrs.get("cartwheel.prompt_version"),
        "system": system,
    }


# ---------------------------------------------------------------- sessions


def build_sessions(traces: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for t in traces:
        sid = _attrs(t).get("cartwheel.session_id") or t["id"]
        groups.setdefault(sid, []).append(t)
    sessions = []
    for sid, ts in groups.items():
        ts.sort(key=lambda t: t.get("timestamp") or "")
        turns = [reconstruct_turn(t) for t in ts]
        a = _attrs(ts[0])
        errors: list[str] = []
        for t in turns:
            for e in t["errors"]:
                if e not in errors:
                    errors.append(e)
        costs = [t["cost"] for t in turns if isinstance(t["cost"], (int, float))]
        lats = [t["latency"] for t in turns if isinstance(t["latency"], (int, float))]
        sessions.append(
            {
                "session_id": sid,
                "scenario_id": ts[0].get("cartwheel_scenario_id") or a.get("cartwheel.scenario_id"),
                "role": a.get("cartwheel.user_role"),
                "user_id": a.get("cartwheel.user_id"),
                "prompt_version": a.get("cartwheel.prompt_version"),
                "model": next((t["model"] for t in turns if t["model"]), None),
                "system": next((t["system"] for t in turns if t["system"]), ""),
                "turn_count": len(turns),
                "trace_ids": [t["trace_id"] for t in turns],
                "error_badges": errors,
                "cost": round(sum(costs), 6) if costs else None,
                "latency": round(sum(lats), 3) if lats else None,
                "timestamp": turns[0]["timestamp"],
                "turns": turns,
            }
        )
    sessions.sort(key=lambda s: (str(s["scenario_id"]), s["timestamp"] or ""))
    return sessions
