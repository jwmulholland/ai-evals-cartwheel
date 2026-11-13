"""Offline tests for the review-app loader. Run: pytest analysis/review_app/test_loader.py
(or: python analysis/review_app/test_loader.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from analysis.review_app import loader  # noqa: E402

TRACE_ID = "4e10f77effcab7e4bc647f77ac1bab5d"


def _export():
    return [loader._coerce(t) for t in loader.load_export()["traces"]]


def test_sessions_group_by_cartwheel_session_id():
    traces = _export()
    assert len(traces) == 325
    sessions = loader.build_sessions(traces)
    assert sum(s["turn_count"] for s in sessions) == 325
    assert all(1 <= s["turn_count"] <= 3 for s in sessions)
    # Langfuse's own sessionId is identical everywhere; grouping must not use it.
    assert len({t.get("sessionId") for t in traces}) == 1
    assert len(sessions) == 250
    ids = {t["id"] for t in traces}
    assert {i for s in sessions for i in s["trace_ids"]} == ids
    for s in sessions:  # oldest first
        stamps = [t["timestamp"] for t in s["turns"]]
        assert stamps == sorted(stamps)


def test_scope_keeps_only_support_scenarios():
    kept, info = loader._scope(
        [{"cartwheel_scenario_id": "support-0001"}, {"cartwheel_scenario_id": "pilot-01"}, {"cartwheel_scenario_id": "preflight-test"}]
    )
    assert [t["cartwheel_scenario_id"] for t in kept] == ["support-0001"]
    assert info == {"filter": "support-*", "excluded": 2}


def test_reconstruct_turn_support_0164():
    trace = next(t for t in _export() if t["id"] == TRACE_ID)
    turn = loader.reconstruct_turn(trace)
    assert [s["call"]["name"] for s in turn["steps"] if s["call"]] == ["find_order", "get_order", "issue_refund"]
    assert turn["tool_count"] == 3
    assert turn["has_thinking"] is True
    assert len(turn["thinking"]) == 1 and turn["thinking"][0].strip()
    assert turn["user"].startswith("Refund the Travel Pencil Set")
    assert turn["final"].startswith("Done!")
    # Clean TOOL-observation results are used, and narration is attached per step.
    assert turn["steps"][2]["result"]["refund_id"] == 583
    assert turn["steps"][0]["narration"].startswith("I'll help you get that refunded")
    assert trace["cartwheel_scenario_id"] == "support-0164"


def test_error_session_yields_badge():
    sessions = loader.build_sessions(_export())
    bad = [s for s in sessions if s["error_badges"]]
    assert bad, "expected at least one session with an ok:false tool result"
    allowed = {"permission_denied", "not_found", "not_eligible", "invalid_argument", "paused"}
    for s in bad:
        assert set(s["error_badges"]) <= allowed
    assert any("permission_denied" in s["error_badges"] for s in bad)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
