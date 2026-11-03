#!/usr/bin/env python3
"""Offline check of fresh_clients.py against an in-memory loopback fake (no network egress).
Verifies report shape, token non-disclosure, and auth-call instrumentation."""
import http.server, json, os, secrets, subprocess, sys, threading, time, uuid

EV_A, EV_B, CODE = str(uuid.uuid4()), str(uuid.uuid4()), "fixturecode"
sessions, requests, votes, ops, issued, sids = {}, {}, {}, {}, [], {}
BROKEN = {"resume": False, "no_limit": False}
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
                return self.reply(200, {"ok": True, "contract": "guest-token-probe-v1", "enabled": True})
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
            t_now = time.monotonic()  # genuine rolling 60 s window, 30 ops
            win = [x for x in ops.get(tok, []) if t_now - x < 60]
            if len(win) >= 30 and not BROKEN["no_limit"]:
                ops[tok] = win
                return self.reply(429, {"ok": False, "error": "guest_rate_limited"})
            ops[tok] = win + [t_now]
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


http.server.ThreadingHTTPServer.request_queue_size = 256  # fake must not drop 100 concurrent connects
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
env = dict(os.environ, PROBE_URL=f"http://127.0.0.1:{srv.server_port}/functions/v1/guest-token-probe",
           PROBE_EVENT_A=EV_A, PROBE_CODE_A=CODE, PROBE_EVENT_B=EV_B)
RUN = [sys.executable, os.path.join(os.path.dirname(__file__), "fresh_clients.py"), "--stages", "25,50,100", "--workers", "100"]
p = subprocess.run(RUN, env=env, capture_output=True, text=True)
assert p.returncode == 0, json.dumps({k: v for k, v in json.loads(p.stdout).items() if k != "stages"}) + str([(s["stage_pass"], s["unexpected_http"], s["http"]) for s in json.loads(p.stdout)["stages"]])
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
ob = rep["overload_test"]
assert ob["method"] == "concurrent_burst" and ob["calls"] == 40 and ob["max_workers"] == 40 and ob["conclusive"], ob
# security guest used 1 join(not counted)+cross-event(401, not counted) -> exactly 30 of 40 burst reads allowed
assert ob["status_counts"] == {"200": 30, "429": 10} and ob["typed_429"] == 10 and ob["verdict"] == "rate_limited", ob
assert set(rep["negatives_http"]) >= {"read:429:guest_rate_limited"}
assert not any(t in out for t in issued), "raw token leaked into report"
assert CODE not in out, "fixture code leaked into report"
# Negative control: a broken resume (different session_id) must fail the run with nonzero exit.
BROKEN["resume"] = True
p2 = subprocess.run(RUN[:3] + ["25"], env=env, capture_output=True, text=True)
rep2 = json.loads(p2.stdout)
assert p2.returncode == 1 and rep2["pass"] is False and rep2["stages"][0]["checks"]["resume_same_session"]["fail"] == 25
# Negative control: no limiter -> overload check must fail with exit 1.
BROKEN["resume"] = False; BROKEN["no_limit"] = True
p3 = subprocess.run(RUN[:3] + ["25"], env=env, capture_output=True, text=True)
rep3 = json.loads(p3.stdout)
assert p3.returncode == 1 and rep3["pass"] is False and rep3["negatives"]["guest_spam_429"] is False
assert rep3["overload_test"]["verdict"] == "failure_no_typed_429" and rep3["overload_test"]["status_counts"] == {"200": 40}
print("PASS runner offline: 25/50/100 concurrent fresh clients all checks, 176 unique tokens, 0 auth calls, negatives ok, "
      "no token/code in report; broken resume -> pass:false exit 1; 40-read burst 30x200/10x429; no limiter -> exit 1")
srv.shutdown()
