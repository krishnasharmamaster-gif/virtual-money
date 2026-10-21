"""Tiny optional sync server for the Virtual Money virtual savings app.

Run with:  python server.py
Then open: http://localhost:8000

The app still works as a local-only prototype when opened without this server.
When this server is running, each family code is stored in data/families.json so
the child view and parent review view can read the same virtual balance.
"""

from __future__ import annotations

import copy
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "families.json"
LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_family(code: str) -> dict:
    return {
        "familyCode": code,
        "parentPin": "2047",
        "profile": {"childName": "Alex", "parentName": "Dad", "initials": "AK"},
        "balance": 128.5,
        "goal": {"name": "A new bike", "target": 250, "saved": 128.5},
        "streak": 4,
        "week": [5, 0, 10, 0, 20, 0, 0],
        "transactions": [
            {"id": "welcome-1", "amount": 20, "note": "Extra chores", "type": "save", "createdAt": "2026-10-19T10:00:00.000Z"},
            {"id": "welcome-2", "amount": 15, "note": "Gift from Grandma", "type": "gift", "createdAt": "2026-10-16T10:00:00.000Z"},
            {"id": "welcome-3", "amount": 10, "note": "Weekly save", "type": "save", "createdAt": "2026-10-14T10:00:00.000Z"},
        ],
        "parentNote": "",
        "reviewedAt": None,
        "reviewRequestedAt": None,
        "updatedAt": now_iso(),
    }


def read_store() -> dict:
    DATA_DIR.mkdir(exist_ok=True)
    if not DATA_FILE.exists():
        return {}
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def write_store(store: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    DATA_FILE.write_text(json.dumps(store, indent=2), encoding="utf-8")


def family_code_from_path(path: str) -> str | None:
    match = re.fullmatch(r"/api/family/([^/]+)(?:/([^/]+))?", path)
    if not match:
        return None
    code = unquote(match.group(1)).upper()
    if not re.fullmatch(r"[A-Z0-9-]{1,32}", code):
        return None
    return code


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload).encode("utf-8")


class VirtualMoneyHandler(SimpleHTTPRequestHandler):
    """Serve the static app plus three tiny JSON endpoints."""

    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[virtual-money] {self.address_string()} - {format % args}")

    def send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 100_000:
                return {}
            return json.loads(self.rfile.read(size) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    def get_family(self, code: str) -> dict:
        with LOCK:
            store = read_store()
            if code not in store:
                store[code] = default_family(code)
                write_store(store)
            return copy.deepcopy(store[code])

    def save_family(self, code: str, family: dict) -> dict:
        with LOCK:
            store = read_store()
            store[code] = family
            write_store(store)
        return copy.deepcopy(family)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            code = family_code_from_path(parsed.path)
            if code and parsed.path == f"/api/family/{code}":
                self.send_json(200, self.get_family(code))
                return
            self.send_json(404, {"error": "Not found"})
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        code = family_code_from_path(parsed.path)
        if not code:
            self.send_json(404, {"error": "Not found"})
            return

        family = self.get_family(code)
        payload = self.read_json()

        if parsed.path.endswith("/transactions"):
            transaction = payload.get("transaction") or {}
            try:
                amount = round(float(transaction.get("amount", 0)), 2)
            except (TypeError, ValueError):
                amount = 0
            if not 0 < amount <= 100000:
                self.send_json(400, {"error": "Invalid amount"})
                return

            transaction = {
                "id": str(transaction.get("id") or uuid.uuid4()),
                "amount": amount,
                "note": str(transaction.get("note") or "Virtual savings")[:60],
                "type": "save",
                "createdAt": str(transaction.get("createdAt") or now_iso()),
            }
            existing_ids = {item.get("id") for item in family.get("transactions", [])}
            if transaction["id"] not in existing_ids:
                family.setdefault("transactions", []).insert(0, transaction)
                family["balance"] = round(float(family.get("balance", 0)) + amount, 2)
                if payload.get("addToGoal", True):
                    goal = family.setdefault("goal", {})
                    goal["saved"] = round(float(goal.get("saved", 0)) + amount, 2)
                week = family.setdefault("week", [0] * 7)
                week[-1] = round(float(week[-1] or 0) + amount, 2)
                family["reviewRequestedAt"] = now_iso()
            family["updatedAt"] = now_iso()
            self.send_json(200, self.save_family(code, family))
            return

        if parsed.path.endswith("/review"):
            family["parentNote"] = str(payload.get("note") or "")[:500]
            family["reviewedAt"] = str(payload.get("reviewedAt") or now_iso())
            family["updatedAt"] = now_iso()
            self.send_json(200, self.save_family(code, family))
            return

        self.send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), VirtualMoneyHandler)
    print(f"Virtual Money is running at http://localhost:{port}")
    print(f"For a phone on the same Wi-Fi, use this computer's local IP with port {port}.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nVirtual Money stopped.")
    finally:
        server.server_close()
