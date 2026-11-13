"""Trace-review app server (standard library only).

    python analysis/review_app/server.py            # http://127.0.0.1:8030/
    python analysis/review_app/server.py --port 8031 --offline

GET  /                  static UI
GET  /api/samples       sessions (grouped by cartwheel.session_id) with rebuilt turns
GET  /api/source        which data source was used
GET  /api/spec          {"text": <SPEC.md>}
GET  /api/drafts          drafted suggestions per mode (not labels)
GET  /api/annotations | /api/graph | /api/patterns | /api/suggestions | /api/labels
POST /api/annotations | /api/patterns | /api/suggestions
POST /api/labels        {"trace_id", "mode", "label": 0|1|null}  (1 = failure present)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.review_app import loader  # noqa: E402

STATIC_DIR = HERE / "static"
STATE_DIR = REPO_ROOT / "analysis" / "state"
SPEC_PATH = REPO_ROOT / "SPEC.md"
# The HW4 hand-built label file belongs to another workflow; never touch it.
RESERVED_MODES = {"unsupported_policy_claim"}

FILES = {
    "annotations": ("annotations.json", []),
    "patterns": ("patterns.json", {"modes": []}),
    "suggestions": ("suggestions.json", []),
    "graph": ("graph.json", {"nodes": [], "clusters": []}),
    "samples_state": ("samples.json", []),
}
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}

DATA: dict[str, Any] = {"sessions": [], "source": {}}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text()) if path.exists() else default
    except (json.JSONDecodeError, OSError):
        return default


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def write_json(path: Path, data: Any) -> None:
    write_atomic(path, json.dumps(data, indent=2))


def state_file(key: str) -> Path:
    return STATE_DIR / FILES[key][0]


def safe_mode(mode: Any) -> str | None:
    m = str(mode or "").strip()
    return m if re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", m) else None


def label_path(mode: str) -> Path:
    return STATE_DIR / "labels" / f"{mode}.jsonl"


def read_label_rows(mode: str) -> list[dict]:
    p = label_path(mode)
    rows = []
    if p.exists():
        for line in p.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def all_labels() -> dict[str, dict[str, int]]:
    """{trace_id: {mode: label}} from labels/*.jsonl (reserved files skipped)."""
    out: dict[str, dict[str, int]] = {}
    d = STATE_DIR / "labels"
    if d.is_dir():
        for p in sorted(d.glob("*.jsonl")):
            if p.stem in RESERVED_MODES:
                continue
            for r in read_label_rows(p.stem):
                if r.get("trace_id") is not None and r.get("label") in (0, 1):
                    out.setdefault(r["trace_id"], {})[p.stem] = r["label"]
    return out


def save_label(trace_id: str, mode: str, label: Any, comment: str | None = None) -> dict:
    """Replace this trace's row in labels/<mode>.jsonl; null label removes it."""
    rows = [r for r in read_label_rows(mode) if r.get("trace_id") != trace_id]
    if label in (0, 1):
        row = {"trace_id": trace_id, "label": int(label), "source": "human",
               "ts": now(), "label_id": f"{trace_id}#0"}
        if comment:
            row["comment"] = comment
        rows.append(row)
    write_atomic(label_path(mode), "".join(json.dumps(r) + "\n" for r in rows))
    result: dict[str, Any] = {"ok": True, "langfuse": "skipped"}
    if label in (0, 1):
        try:
            from analysis.helpers import langfuse_io
            if langfuse_io.is_configured():
                # One score per (trace, mode): a fixed score id makes a re-save overwrite
                # instead of piling up duplicates (fast repeated clicks did exactly that).
                lf = langfuse_io._client()
                lf.create_score(name=mode, value=int(label),
                                trace_id=langfuse_io.logical_to_langfuse_id(trace_id, lf),
                                data_type="NUMERIC", comment=comment,
                                score_id=f"{trace_id}-{mode}"[:64])
                lf.flush()
                result["langfuse"] = "written"
        except Exception as exc:  # local file is already saved
            result["langfuse"] = "failed"
            result["langfuse_error"] = str(exc)
    return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a: Any) -> None:
        return

    def _json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel: str) -> None:
        p = (STATIC_DIR / rel).resolve()
        if STATIC_DIR not in p.parents or not p.is_file():
            return self._json({"error": "not found"}, 404)
        body = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(p.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            return self._static("index.html")
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        if path == "/api/samples":
            return self._json(DATA["sessions"])
        if path == "/api/source":
            return self._json({**DATA["source"], "trace_count": sum(s["turn_count"] for s in DATA["sessions"]),
                               "session_count": len(DATA["sessions"])})
        if path == "/api/spec":
            try:
                return self._json({"text": SPEC_PATH.read_text(encoding="utf-8")})
            except OSError:
                return self._json({"error": "SPEC.md not found"}, 404)
        if path == "/api/labels":
            return self._json(all_labels())
        if path == "/api/drafts":  # agent-drafted pass/fail suggestions per mode; never labels
            return self._json(read_json(STATE_DIR / "drafts.json", {}))
        if path == "/api/manifest":  # review batches: which traces were drawn, and why
            return self._json(read_json(STATE_DIR / "sample_manifest.json", {"picks": []}))
        key = path[len("/api/"):] if path.startswith("/api/") else None
        if key == "samples_state":  # optional sampled-trace ids for the Map tab
            return self._json(read_json(state_file("samples_state"), []))
        if key in ("annotations", "patterns", "suggestions", "graph"):
            data = read_json(state_file(key), FILES[key][1])
            if key == "annotations" and isinstance(data, dict):
                data = data.get("annotations", [])
            return self._json(data)
        self._json({"error": f"unknown path {path}"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n)) if n else None
        except (ValueError, json.JSONDecodeError):
            data = None
        if data is None:
            return self._json({"error": "expected a JSON body"}, 400)
        if path in ("/api/annotations", "/api/suggestions"):
            if isinstance(data, dict):
                data = data.get("annotations" if "annotations" in path else "suggestions", [])
            if not isinstance(data, list):
                return self._json({"error": "expected a list"}, 400)
            write_json(state_file(path.split("/")[-1]), data)
            return self._json({"ok": True, "count": len(data)})
        if path == "/api/patterns":
            if not isinstance(data, (dict, list)):
                return self._json({"error": "expected an object"}, 400)
            write_json(state_file("patterns"), data)
            return self._json({"ok": True, "count": len(data)})
        if path == "/api/labels":
            tid, mode = data.get("trace_id"), safe_mode(data.get("mode"))
            if not tid or not mode:
                return self._json({"error": "trace_id and a valid mode are required"}, 400)
            if mode in RESERVED_MODES:
                return self._json({"error": f"mode {mode} is reserved; not written"}, 403)
            if data.get("label") not in (0, 1, None):
                return self._json({"error": "label must be 0, 1 or null"}, 400)
            return self._json(save_label(str(tid), mode, data.get("label"), data.get("comment")))
        self._json({"error": f"cannot POST to {path}"}, 404)


def load_env() -> None:
    """Load LANGFUSE_* (and other) settings from the repo-root .env, never overriding the environment.

    Values are not printed. Skipped with --offline so offline stays offline: no
    Langfuse reads, and saved labels are not written to Langfuse as scores.
    """
    path = loader.REPO_ROOT / ".env"
    if not path.is_file():
        return
    import os

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def load_data(offline: bool = False) -> None:
    traces, source = loader.load_traces(prefer_live=not offline)
    DATA["sessions"] = loader.build_sessions(traces)
    DATA["source"] = source


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8030)
    ap.add_argument("--offline", action="store_true", help="skip the live Langfuse fetch")
    args = ap.parse_args()
    if not args.offline:
        load_env()
    load_data(args.offline)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"trace review on http://127.0.0.1:{args.port}/  source={DATA['source'].get('source')}"
          f"  sessions={len(DATA['sessions'])}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
