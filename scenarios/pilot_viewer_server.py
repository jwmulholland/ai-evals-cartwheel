"""Serve pilot_viewer.html and save reviewer notes: scenario-design flags and comments to
scenarios/pilot_comments.json, pilot-run comments to scenarios/pilot_run_comments.json,
final-scenario notes to final_scenario_comments.json and final-run notes to final_run_comments.json.

Run from the repository root:  uv run python scenarios/pilot_viewer_server.py
Then open http://127.0.0.1:8765
"""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).parent
VIEWER = HERE / "pilot_viewer.html"
STORES = {
    "/comments": HERE / "pilot_comments.json",
    "/run_comments": HERE / "pilot_run_comments.json",
    "/final_comments": HERE / "final_scenario_comments.json",
    "/frun_comments": HERE / "final_run_comments.json",
}
REVIEW = HERE / "pilot_review.jsonl"
FINAL_RESULTS = HERE / "final-results.jsonl"
DOCS = {
    "/doc/spec": HERE.parent / "SPEC.md",
    "/doc/plan": HERE / "final_allocation_plan.md",
}
PORT = 8765


def read_comments(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            self._send(200, VIEWER.read_bytes(), "text/html; charset=utf-8")
        elif self.path in DOCS:
            self._send(200, DOCS[self.path].read_bytes(), "text/plain; charset=utf-8")
        elif self.path == "/final_results":
            try:
                records = [json.loads(line) for line in FINAL_RESULTS.read_text().splitlines() if line.strip()]
            except FileNotFoundError:
                records = []
            self._send(200, json.dumps(records).encode(), "application/json")
        elif self.path == "/review":
            try:
                records = [json.loads(line) for line in REVIEW.read_text().splitlines() if line.strip()]
            except FileNotFoundError:
                records = []
            self._send(200, json.dumps(records).encode(), "application/json")
        elif self.path in STORES:
            self._send(200, json.dumps(read_comments(STORES[self.path])).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        if self.path not in STORES:
            self._send(404, b"not found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            scenario_id = str(payload["id"])
            comment = str(payload.get("comment", ""))
            flags = [str(f) for f in payload.get("flags", [])]
        except (ValueError, KeyError, json.JSONDecodeError):
            self._send(400, b"bad request", "text/plain")
            return
        store = STORES[self.path]
        comments = read_comments(store)
        if comment.strip() or flags:
            comments[scenario_id] = {"comment": comment, "flags": flags}
        else:
            comments.pop(scenario_id, None)
        tmp = store.with_suffix(".tmp")
        tmp.write_text(json.dumps(comments, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        os.replace(tmp, store)
        self._send(200, b"{}", "application/json")

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    saved_to = ", ".join(str(path) for path in STORES.values())
    print(f"Pilot viewer: http://127.0.0.1:{PORT}  (notes -> {saved_to})")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
