"""HW5: prepare judge inputs, split labels, run development and test batches.

Mode: editorial_commentary. Run from the repository root.
HW4 labels use 1 = failure present. HW5 labels use 1 = Pass (failure absent).
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

MODE = "editorial_commentary"
HW4_LABELS = Path("analysis/state/labels") / f"{MODE}.jsonl"
HW5_LABELS = Path("analysis/state/hw5_labels") / f"{MODE}.jsonl"
TRACE_EXPORT = Path("traces/support_traces.json")
TRACE_INPUTS = Path("analysis/state/hw5_trace_inputs.json")


def _text(parts_list) -> str:
    """Join the text parts of a Langfuse message list's content."""
    out = []
    for message in parts_list:
        for part in message.get("parts") or []:
            if part.get("type") == "text" and part.get("content"):
                out.append(part["content"])
    return "\n".join(out).strip()


def export_hw5_labels(mode: str = MODE) -> int:
    """Copy HW4 labels to the HW5 folder with Pass = 1. HW4 files stay unchanged."""
    rows = [json.loads(line) for line in HW4_LABELS.read_text().splitlines() if line.strip()]
    live = [row for row in rows if not row.get("superseded_by")]
    HW5_LABELS.parent.mkdir(parents=True, exist_ok=True)
    with HW5_LABELS.open("w") as handle:
        for row in live:
            out = {**row, "label": 1 - int(row["label"]), "convention": "1=Pass,0=Fail"}
            handle.write(json.dumps(out) + "\n")
    return len(live)


def eligible_records(mode: str = MODE) -> list[dict]:
    """One trace per session: the earliest labeled turn (the rule ignores labels)."""
    traces = {t["id"]: t for t in json.loads(TRACE_EXPORT.read_text())["traces"]}
    labeled = [
        json.loads(line)["trace_id"]
        for line in HW4_LABELS.read_text().splitlines()
        if line.strip() and not json.loads(line).get("superseded_by")
    ]
    by_session = defaultdict(list)
    for trace_id in labeled:
        trace = traces[trace_id]
        session = trace["metadata"]["attributes"]["cartwheel.session_id"]
        by_session[session].append((trace["createdAt"], trace_id))
    return [traces[min(items)[1]] for items in by_session.values()]


def prepare_inputs() -> list[dict]:
    """Save one judge input per eligible trace: this turn's user message and reply.

    editorial_commentary is judged from the single turn. No earlier turns, tool
    data, labels, notes, or scenario metadata are included.
    """
    records = []
    for trace in sorted(eligible_records(), key=lambda t: t["id"]):
        user_messages = [m for m in trace["input"] if m.get("role") == "user"]
        reply = _text([m for m in trace["output"] if m.get("role") == "assistant"])
        request = _text(user_messages[-1:])
        if not request or not reply:
            raise ValueError(f"trace {trace['id']} has no user request or assistant reply")
        records.append(
            {
                "trace_id": trace["id"],
                "trace": [
                    {"role": "user", "text": request},
                    {"role": "assistant", "text": reply},
                ],
            }
        )
    TRACE_INPUTS.parent.mkdir(parents=True, exist_ok=True)
    TRACE_INPUTS.write_text(json.dumps(records, indent=2))
    return records


JUDGE_MODEL = "anthropic/claude-sonnet-4-5"  # student choice: same ANTHROPIC_API_KEY as the agent; handout default is gpt-4o-mini
REPORT_DIR = Path("analysis/report")


def register_version(mode: str, prompt_path: str, model: str = JUDGE_MODEL) -> str:
    """Register a prompt file as a judge version. Reuses the id if this exact prompt and model exist."""
    from analysis.helpers import register_judge

    text = Path(prompt_path).read_text()
    for path in sorted(Path("analysis/state/judges").glob(f"{mode}-v*.json")):
        saved = json.loads(path.read_text())
        if saved["prompt_text"] == text and saved["model"] == model:
            return saved["judge_id"]
    return register_judge(mode=mode, prompt_text=text, judge_model=model)["judge_id"]


def run_development(mode: str, prompt_path: str) -> dict:
    """Register the prompt (once), run it on dev traces, save metrics. Paid when predictions are missing."""
    import os

    from analysis.helpers import judge_alignment, run_judge

    # Use the saved inputs even when Langfuse is configured.
    os.environ["CARTWHEEL_JUDGE_TRACE_SOURCE"] = str(TRACE_INPUTS.resolve())
    judge_id = register_version(mode, prompt_path)
    run_judge(judge_id, split="dev", batch_size=10)
    development = judge_alignment(judge_id, split="dev")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"dev-{judge_id}.json").write_text(
        json.dumps({"judge_id": judge_id, **development}, indent=2)
    )
    return {"judge_id": judge_id, **development}


def split_data(mode: str = MODE) -> dict[str, list[str]]:
    """20% train, 40% dev, 40% test, stratified by label, seed 7."""
    from analysis.helpers import split_labels

    records = json.loads(TRACE_INPUTS.read_text())
    return split_labels(
        mode,
        fractions=(0.20, 0.40, 0.40),
        seed=7,
        min_per_class=10,
        eligible_trace_ids=[record["trace_id"] for record in records],
    )


def run_test(judge_id: str) -> dict:
    """Freeze the judge, evaluate the test split once, and save metrics. Paid when predictions are missing.

    Resume after an interruption by calling run_test again with the same judge id:
    freezing is skipped if the judge is already frozen, and cached batches are not repaid.
    """
    import os

    from analysis.helpers import freeze_judge, judge_alignment, run_judge

    os.environ["CARTWHEEL_JUDGE_TRACE_SOURCE"] = str(TRACE_INPUTS.resolve())
    saved = json.loads((Path("analysis/state/judges") / f"{judge_id}.json").read_text())
    if saved.get("status") != "frozen":
        freeze_judge(judge_id)
    run_judge(judge_id, split="test", batch_size=10)
    test = judge_alignment(judge_id, split="test")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"test-{judge_id}.json").write_text(
        json.dumps({"judge_id": judge_id, **test}, indent=2)
    )
    return {"judge_id": judge_id, **test}


def recalculate_test(judge_id: str) -> dict:
    """Recompute test metrics from saved predictions and labels. Free: no model call, nothing written."""
    from analysis.helpers import judge_alignment

    m = judge_alignment(judge_id, split="test")
    pass_n, fail_n = m["tp"] + m["fn"], m["tn"] + m["fp"]
    print(f"{judge_id} on the test split (n={m['n']}: {pass_n} human Pass, {fail_n} human Fail)")
    print("                 Human Pass   Human Fail")
    print(f"  Judge Pass     TP = {m['tp']:<7}  FP = {m['fp']}")
    print(f"  Judge Fail     FN = {m['fn']:<7}  TN = {m['tn']}")
    lo, hi = m["tpr_interval"]
    print(f"  TPR = {m['tp']}/{pass_n} = {m['tpr']:.3f}   95% Wilson {lo:.3f} to {hi:.3f}")
    lo, hi = m["tnr_interval"]
    print(f"  TNR = {m['tn']}/{fail_n} = {m['tnr']:.3f}   95% Wilson {lo:.3f} to {hi:.3f}")
    print(f"  Agreement = {m['agreement']:.3f}   Disagreements: {[t[:8] for t in m['disagreements']]}")
    return m
