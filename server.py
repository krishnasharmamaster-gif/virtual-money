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
import math
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
        "pendingRequests": [],
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
    match = re.fullmatch(r"/api/family/([^/]+)(?:/.*)?", path)
    if not match:
        return None
    code = unquote(match.group(1)).upper()
    if not re.fullmatch(r"[A-Z0-9-]{1,32}", code):
        return None
    return code


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload).encode("utf-8")


class VirtualMoneyHandler(SimpleHTTPRequestHandler):
    """Serve the static app and its small family-sync JSON API."""

    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[virtual-money] {self.address_string()} - {format % args}")

    def send_json(self, status: int, payload: dict) -> None:
        if "familyCode" in payload:
            payload = copy.deepcopy(payload)
            payload.pop("parentPin", None)
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
            payload = json.loads(self.rfile.read(size) or b"{}")
            return payload if isinstance(payload, dict) else {}
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
                public_family = self.get_family(code)
                public_family.pop("parentPin", None)
                self.send_json(200, public_family)
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

        if parsed.path == f"/api/family/{code}/transactions":
            self.send_json(403, {"error": "Parent approval is required for money changes"})
            return

        if parsed.path == f"/api/family/{code}/requests":
            request = payload.get("request") or {}
            if not isinstance(request, dict):
                self.send_json(400, {"error": "Invalid request"})
                return
            try:
                amount = round(float(request.get("amount", 0)), 2)
            except (TypeError, ValueError, OverflowError):
                amount = 0
            if not math.isfinite(amount) or not 0 < amount <= 100000:
                self.send_json(400, {"error": "Invalid amount"})
                return
            action = request.get("action")
            if action not in ("add", "deduct"):
                self.send_json(400, {"error": "Invalid request action"})
                return
            if action == "deduct":
                pending_deductions = sum(
                    float(item.get("amount", 0) or 0)
                    for item in family.get("pendingRequests", [])
                    if item.get("status") == "pending" and item.get("action") == "deduct"
                )
                available = round(float(family.get("balance", 0)) - pending_deductions, 2)
                if amount > available:
                    self.send_json(400, {"error": "Requested deduction exceeds available balance"})
                    return

            request_id = str(request.get("id") or uuid.uuid4())[:100]
            pending_requests = family.setdefault("pendingRequests", [])
            existing = next((item for item in pending_requests if item.get("id") == request_id), None)
            if existing:
                self.send_json(200, family)
                return
            pending_requests.insert(0, {
                "id": request_id,
                "amount": amount,
                "action": action,
                "note": str(request.get("note") or ("Virtual spending" if action == "deduct" else "Virtual savings"))[:60],
                "addToGoal": bool(request.get("addToGoal", True)),
                "status": "pending",
                "requestedAt": now_iso(),
            })
            family["reviewRequestedAt"] = now_iso()
            family["updatedAt"] = now_iso()
            self.send_json(200, self.save_family(code, family))
            return

        decision_match = re.fullmatch(rf"/api/family/{re.escape(code)}/requests/([^/]+)/decision", parsed.path)
        if decision_match:
            parent_pin = str(payload.get("parentPin") or "")
            if parent_pin != str(family.get("parentPin", "2047")):
                self.send_json(403, {"error": "Parent code is incorrect"})
                return
            decision = payload.get("decision")
            if decision not in ("approve", "decline"):
                self.send_json(400, {"error": "Invalid decision"})
                return
            request_id = unquote(decision_match.group(1))
            request = next(
                (item for item in family.get("pendingRequests", []) if item.get("id") == request_id),
                None,
            )
            if not request or request.get("status") != "pending":
                self.send_json(404, {"error": "Pending request not found"})
                return

            reviewed_at = now_iso()
            request["status"] = "approved" if decision == "approve" else "declined"
            request["reviewedAt"] = reviewed_at
            if decision == "approve":
                amount = round(float(request.get("amount", 0)), 2)
                is_deduction = request.get("action") == "deduct"
                balance = float(family.get("balance", 0))
                if is_deduction and amount > balance:
                    request["status"] = "pending"
                    request.pop("reviewedAt", None)
                    self.send_json(400, {"error": "Balance is too low to approve this deduction"})
                    return
                family["balance"] = round(balance + (-amount if is_deduction else amount), 2)
                if request.get("addToGoal"):
                    goal = family.setdefault("goal", {})
                    goal_saved = float(goal.get("saved", 0))
                    goal["saved"] = round(max(0, goal_saved + (-amount if is_deduction else amount)), 2)
                family.setdefault("transactions", []).insert(0, {
                    "id": request_id,
                    "amount": amount,
                    "note": str(request.get("note") or ("Virtual spending" if is_deduction else "Virtual savings"))[:60],
                    "type": "spend" if is_deduction else "save",
                    "createdAt": reviewed_at,
                })
                if not is_deduction:
                    week = family.setdefault("week", [0] * 7)
                    while len(week) < 7:
                        week.insert(0, 0)
                    week[-1] = round(float(week[-1] or 0) + amount, 2)
                    family["streak"] = max(1, int(family.get("streak", 0)))
            family["reviewedAt"] = reviewed_at
            family["reviewRequestedAt"] = reviewed_at if any(
                item.get("status") == "pending" for item in family.get("pendingRequests", [])
            ) else None
            family["updatedAt"] = reviewed_at
            self.send_json(200, self.save_family(code, family))
            return

        if parsed.path == f"/api/family/{code}/review":
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
