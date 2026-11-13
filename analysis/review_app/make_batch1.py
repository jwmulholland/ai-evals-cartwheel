"""Draw review batch 1 and the Map projection (HW4 Part B).

Run from the repo root:

    python analysis/review_app/make_batch1.py

Writes analysis/state/sample_manifest.json (the picks and why) and
analysis/state/graph.json (a 2D projection of every trace for the Map tab).
It refuses to overwrite either file unless --force is passed, so a manifest you
have already built on is never replaced by accident.

Batch 1 is 15 uniformly sampled traces plus 15 cluster representatives, with no
trace in both. The unit is one Langfuse trace (one user turn); sessions are NOT
merged, because labels are per trace. The population is the 325 `support-*`
traces. All randomness uses seed 7, so the picks reproduce exactly.

Clusters use the course helper's k-means on five standardized trace features
(turn_count, tool_call_count, distinct_tools, has_retrieval, tokens). The
representative of a cluster is the member nearest its centroid; the helper's
own "representative" step takes the first member in list order, so it is not
used here.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

import numpy as np  # noqa: E402

from analysis.helpers import selection  # noqa: E402
from analysis.helpers.normalization import normalize_trace  # noqa: E402
from analysis.review_app import loader  # noqa: E402

STATE = REPO_ROOT / "analysis" / "state"
SEED = 7
K = 8
N_UNIFORM = 15
N_CLUSTER = 15


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="overwrite an existing manifest and graph")
    args = ap.parse_args()

    manifest_path, graph_path = STATE / "sample_manifest.json", STATE / "graph.json"
    existing = [p.name for p in (manifest_path, graph_path) if p.exists() and p.stat().st_size > 2]
    if existing and not args.force:
        sys.exit(f"{', '.join(existing)} already exists; pass --force to replace it")

    raw = [t for t in loader.load_export()["traces"] if str(t.get("cartwheel_scenario_id") or "").startswith("support-")]
    traces = [normalize_trace(t) for t in raw]  # one record per trace, no session merge
    session_of = {t["id"]: (t["metadata"].get("cartwheel.session_id") or "") for t in traces}

    rng = random.Random(SEED)
    uniform = [t["id"] for t in rng.sample(traces, N_UNIFORM)]

    vecs = selection._standardize([selection._feature_vector(t) for t in traces])
    assign = selection._kmeans(vecs, K, seed=SEED)
    centroid = {}
    for c in range(K):
        members = [vecs[i] for i in range(len(traces)) if assign[i] == c]
        if members:
            centroid[c] = [sum(m[d] for m in members) / len(members) for d in range(len(members[0]))]

    def dist(a, b):
        return sum((x - y) ** 2 for x, y in zip(a, b))

    ranked = {
        c: sorted(
            (i for i in range(len(traces)) if assign[i] == c and traces[i]["id"] not in uniform),
            key=lambda i: dist(vecs[i], centroid[c]),
        )
        for c in centroid
    }
    cluster_picks: list[tuple[int, int]] = []
    depth = 0
    while len(cluster_picks) < N_CLUSTER:
        for c in sorted(ranked):
            if len(cluster_picks) < N_CLUSTER and len(ranked[c]) > depth:
                cluster_picks.append((c, ranked[c][depth]))
        depth += 1

    by_id = {t["id"]: t for t in traces}
    cluster_of = {traces[i]["id"]: assign[i] for i in range(len(traces))}

    def entry(tid: str, method: str, reason: str) -> dict:
        t = by_id[tid]
        return {
            "trace_id": tid,
            "scenario_id": t["meta"].get("scenario_id"),
            "session_id": session_of[tid],
            "role": t["meta"].get("role"),
            "batch": 1,
            "method": method,
            "cluster": cluster_of[tid],
            "reason": reason,
        }

    picks = [entry(t, "uniform", "uniform random sample (seed 7)") for t in uniform]
    picks += [
        entry(traces[i]["id"], "cluster", f"cluster {c} representative (nearest centroid)")
        for c, i in cluster_picks
    ]

    manifest = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "population": {
            "filter": "support-*",
            "traces": len(traces),
            "sessions": len({s for s in session_of.values()}),
            "source": "traces/support_traces.json (same trace ids as the Langfuse project)",
        },
        "method": {
            "seed": SEED,
            "unit": "one Langfuse trace (one user turn); sessions are not merged",
            "batch_1": f"{N_UNIFORM} uniform random + {N_CLUSTER} cluster representatives, no overlap",
            "clustering": f"k-means, k={K}, seed {SEED}, standardized features {list(selection._FEATURES)}",
        },
        "picks": picks,
    }

    # Map: PCA on the same standardized features, plus a tiny seeded jitter so
    # identical feature vectors do not sit exactly on top of each other.
    X = np.array(vecs, dtype=float)
    Xc = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(Xc, full_matrices=False)
    xy = Xc @ vt[:2].T
    jr = np.random.default_rng(SEED)
    xy = xy + jr.normal(0, 0.04, xy.shape)
    sizes = {c: int(sum(1 for a in assign if a == c)) for c in centroid}
    graph = {
        "method": "PCA (2 components) of standardized trace features, small seeded jitter",
        "nodes": [
            {
                "trace_id": traces[i]["id"],
                "scenario_id": traces[i]["meta"].get("scenario_id"),
                "x": round(float(xy[i][0]), 4),
                "y": round(float(xy[i][1]), 4),
                "cluster": int(assign[i]),
            }
            for i in range(len(traces))
        ],
        "clusters": [{"id": c, "label": f"({sizes[c]} traces)"} for c in sorted(sizes)],
    }

    STATE.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    graph_path.write_text(json.dumps(graph, indent=2) + "\n")
    print(f"wrote {manifest_path.relative_to(REPO_ROOT)}: {len(picks)} picks ({len({p['trace_id'] for p in picks})} distinct)")
    print(f"wrote {graph_path.relative_to(REPO_ROOT)}: {len(graph['nodes'])} nodes, {len(graph['clusters'])} clusters")


if __name__ == "__main__":
    main()
