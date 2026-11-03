#!/usr/bin/env python3
"""Offline check of fresh_clients.py against an in-memory loopback fake (no network egress).
Verifies report shape, token non-disclosure, and auth-call instrumentation."""
import http.server, json, os, secrets, subprocess, sys, threading, uuid

EV_A, EV_B, CODE = str(uuid.uuid4()), str(uuid.uuid4()), "fixturecode"
sessions, requests, votes, ops, issued, sids = {}, {}, {}, {}, [], {}
BROKEN = {"resume": False}
lock = threading.Lock()


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body):
        b = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        a, p = d.get("action"), d.get("payload", {})
        with lock:
            if a == "contract":
                return self.reply(200, {"ok": True, "contract": "guest-token-probe-v1"})
            if a not in ("join", "request", "read", "vote"):
                return self.reply(400, {"ok": False, "error": "invalid_action"})
            tok = p.get("token")
            if a == "join" and tok is None:
                if p.get("event_id") != EV_A or p.get("code") != CODE:
                    return self.reply(404, {"ok": False, "error": "invalid_event_or_code"})
                t = secrets.token_hex(32); issued.append(t); sessions[t] = EV_A; sids[t] = str(uuid.uuid4())
                return self.reply(200, {"ok": True, "resumed": False, "token": t, "session_id": sids[t]})
            if sessions.get(tok) != p.get("event_id"):
                return self.reply(401, {"ok": False, "error": "invalid_session"})
            if a == "join":
                return self.reply(200, {"ok": True, "resumed": True, "session_id": str(uuid.uuid4()) if BROKEN["resume"] else sids[tok]})
            ops[tok] = ops.get(tok, 0) + 1
            if ops[tok] > 30:
                return self.reply(429, {"ok": False, "error": "guest_rate_limited"})
            if a == "request":
                k = (tok, p["idempotency_key"])
                rep = k in requests
                requests.setdefault(k, str(uuid.uuid4()))
                return self.reply(200, {"ok": True, "replayed": rep, "request_id": requests[k]})
            if a == "read":
                return self.reply(200, {"ok": True, "requests": [{"id": v, "mine": k[0] == tok} for k, v in requests.items()]})
            k = (tok, p["request_id"]); ch = votes.get(k, 0) != p["value"]; votes[k] = p["value"]
            up = sum(1 for (t2, r2), v in votes.items() if r2 == p["request_id"] and v == 1)
            return self.reply(200, {"ok": True, "changed": ch, "my_vote": p["value"], "request_id": p["request_id"], "upvotes": up})


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
env = dict(os.environ, PROBE_URL=f"http://127.0.0.1:{srv.server_port}/functions/v1/guest-token-probe",
           PROBE_EVENT_A=EV_A, PROBE_CODE_A=CODE, PROBE_EVENT_B=EV_B)
RUN = [sys.executable, os.path.join(os.path.dirname(__file__), "fresh_clients.py"), "--stages", "25,50,100", "--workers", "100"]
p = subprocess.run(RUN, env=env, capture_output=True, text=True)
assert p.returncode == 0, p.stdout[-2000:] + p.stderr[-2000:]
out = p.stdout
rep = json.loads(out)
assert rep["pass"] is True and rep["contract_ok"] is True
assert [s["successful_joins"] for s in rep["stages"]] == [25, 50, 100], rep
assert [s["concurrency"] for s in rep["stages"]] == [25, 50, 100]
assert all(s["clients_fully_passed"] == s["fresh_clients"] and s["unexpected_http"] == 0 for s in rep["stages"])
assert all(c["fail"] == 0 and c["pass"] == s["fresh_clients"] for s in rep["stages"] for c in s["checks"].values())
assert rep["unique_tokens_overall"] is True and len(set(issued)) == 176  # 175 capacity + 1 security guest
assert rep["auth_signup_calls_observed"] == 0
assert all(rep["negatives"].values()) and rep["negatives_unexpected_http"] == 0, rep["negatives"]
assert not any(t in out for t in issued), "raw token leaked into report"
assert CODE not in out, "fixture code leaked into report"
# Negative control: a broken resume (different session_id) must fail the run with nonzero exit.
BROKEN["resume"] = True
p2 = subprocess.run(RUN[:3] + ["25"], env=env, capture_output=True, text=True)
rep2 = json.loads(p2.stdout)
assert p2.returncode == 1 and rep2["pass"] is False and rep2["stages"][0]["checks"]["resume_same_session"]["fail"] == 25
print("PASS runner offline: 25/50/100 concurrent fresh clients all checks, 176 unique tokens, 0 auth calls, negatives ok, "
      "no token/code in report; broken resume -> pass:false exit 1")
srv.shutdown()
