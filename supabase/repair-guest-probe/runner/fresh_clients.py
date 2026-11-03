#!/usr/bin/env python3
"""Fresh-client HTTP runner for the guest-token probe (stdlib only).

Every simulated guest is a brand-new client: no prepared identity, no Supabase Auth.
Server-issued tokens live only in memory; uniqueness uses SHA-256 digests in memory.
The report contains only sanitized counts/timings/booleans. Exit code 0 only if
every expected check passed and no unexpected HTTP status occurred.

Usage (fixtures from repair_guest_probe.operator_create_event):
  PROBE_URL=https://<staging>/functions/v1/guest-token-probe \
  PROBE_EVENT_A=<uuid> PROBE_CODE_A=<code> PROBE_EVENT_B=<uuid> \
  [PROBE_APIKEY=<publishable key, optional>] \
  python3 fresh_clients.py --stages 25,50,100 --workers 100 > report.json

Limits: one runner's view only. Does NOT prove egress-IP identity, provider-level
quotas, Realtime capacity, or app capacity.
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, json, os, sys, threading, time, urllib.error, urllib.parse, urllib.request, uuid

CONTRACT = "guest-token-probe-v1"
AUTH_CALLS = 0  # instrumentation: any request aimed at Auth is counted and refused
_lock = threading.Lock()
FLOW_CHECKS = ["join_ok", "request_ok", "request_idempotent", "read_ok", "read_sees_own_request",
               "vote_ok", "vote_idempotent", "resume_same_session", "resume_no_new_token"]


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def digest(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


class Client:
    """Shared stats sink; each call is an independent HTTP request (no cookies/session reuse)."""

    def __init__(self, url, apikey):
        self.url, self.apikey = url, apikey
        self.lat, self.status, self.ops = {}, {}, {}
        self.unexpected = 0

    def call(self, action, payload, expect=(200,)):
        global AUTH_CALLS
        if "/auth/v1" in urllib.parse.urlparse(self.url).path:
            with _lock:
                AUTH_CALLS += 1
            raise RuntimeError("auth endpoint forbidden")
        data = json.dumps({"action": action, "payload": payload}).encode()
        req = urllib.request.Request(self.url, data=data, method="POST", headers={"Content-Type": "application/json"})
        if self.apikey:
            req.add_header("apikey", self.apikey)
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                code, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, body = e.code, e.read()
        except Exception:
            code, body = 0, b"{}"
        ms = (time.perf_counter() - t) * 1000
        try:
            parsed = json.loads(body or b"{}")
            if not isinstance(parsed, dict):
                parsed = {}
        except ValueError:
            parsed = {}
        err = "ok" if code == 200 else str(parsed.get("error", "unparsed"))[:40]
        key = f"{action}:{code}:{err}"
        with _lock:
            self.lat.setdefault(action, []).append(ms)
            self.status[key] = self.status.get(key, 0) + 1
            self.ops[action] = self.ops.get(action, 0) + 1
            if code not in expect:
                self.unexpected += 1
        return code, parsed


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))], 1)


def guest_flow(c, ev, code, label):
    """One fresh guest. Returns (checks dict with every FLOW_CHECKS key, token or None)."""
    ck = {k: False for k in FLOW_CHECKS}
    s, j = c.call("join", {"event_id": ev, "code": code, "nickname": f"probe{label}"})
    tok, sid = j.get("token"), j.get("session_id")
    if s != 200 or not isinstance(tok, str) or len(tok) != 64 or not sid or j.get("resumed") is not False:
        return ck, None
    ck["join_ok"] = True
    k = str(uuid.uuid4())
    s1, r1 = c.call("request", {"event_id": ev, "token": tok, "idempotency_key": k, "title": f"Probe song {label}"})
    rid = r1.get("request_id")
    ck["request_ok"] = s1 == 200 and bool(rid) and r1.get("replayed") is False
    s2, r2 = c.call("request", {"event_id": ev, "token": tok, "idempotency_key": k, "title": f"Probe song {label}"})
    ck["request_idempotent"] = ck["request_ok"] and s2 == 200 and r2.get("request_id") == rid and r2.get("replayed") is True
    s, rd = c.call("read", {"event_id": ev, "token": tok})
    reqs = rd.get("requests") if s == 200 and isinstance(rd.get("requests"), list) else None
    ck["read_ok"] = reqs is not None
    ck["read_sees_own_request"] = bool(reqs) and any(x.get("id") == rid and x.get("mine") is True for x in reqs)
    target = next((x.get("id") for x in (reqs or []) if x.get("mine") is False), rid)
    if target:
        v1s, v1 = c.call("vote", {"event_id": ev, "token": tok, "request_id": target, "value": 1})
        ck["vote_ok"] = v1s == 200 and v1.get("my_vote") == 1 and v1.get("request_id") == target
        v2s, v2 = c.call("vote", {"event_id": ev, "token": tok, "request_id": target, "value": 1})
        ck["vote_idempotent"] = ck["vote_ok"] and v2s == 200 and v2.get("changed") is False and v2.get("my_vote") == 1  # totals may move from other guests concurrently
    s, rj = c.call("join", {"event_id": ev, "token": tok})
    ck["resume_same_session"] = s == 200 and rj.get("resumed") is True and rj.get("session_id") == sid
    ck["resume_no_new_token"] = s == 200 and "token" not in rj
    return ck, tok


BURST_N = 40


def spam_burst(c, ev, tok):
    """Overload test: BURST_N simultaneous reads on ONE token (40 > 30/min limit). A run lasting
    >= 60 s cannot prove the per-minute limiter, so it is reported inconclusive and fails."""
    barrier = threading.Barrier(BURST_N)

    def one(_):
        barrier.wait()
        return c.call("read", {"event_id": ev, "token": tok}, expect=(200, 429))

    t0 = time.perf_counter(); start = now()
    with cf.ThreadPoolExecutor(max_workers=BURST_N) as ex:
        res = list(ex.map(one, range(BURST_N)))
    dur = round(time.perf_counter() - t0, 3)
    counts = {}
    for s, _ in res:
        counts[str(s)] = counts.get(str(s), 0) + 1
    typed = sum(1 for s, j in res if s == 429 and j.get("error") == "guest_rate_limited")
    conclusive = dur < 60
    verdict = ("inconclusive_burst_ge_60s" if not conclusive else
               "rate_limited" if typed >= 1 else "failure_no_typed_429")
    return {"method": "concurrent_burst", "calls": BURST_N, "max_workers": BURST_N, "same_token": True,
            "start_utc": start, "duration_s": dur, "status_counts": counts, "typed_429": typed,
            "conclusive": conclusive, "verdict": verdict}


def negatives(url, apikey, a, code_a, b):
    """Security checks on a dedicated fresh guest so capacity guests are not rate-limited."""
    c = Client(url, apikey)
    out = {}
    s, j = c.call("join", {"event_id": a, "code": code_a, "nickname": "security"})
    tok = j.get("token") if s == 200 else None
    out["security_guest_joined"] = isinstance(tok, str)
    s, _ = c.call("read", {"event_id": a}, expect=(401,))
    out["missing_token_401"] = s == 401
    s, _ = c.call("read", {"event_id": a, "token": "0" * 64}, expect=(401,))
    out["forged_token_401"] = s == 401
    s, _ = c.call("read", {"event_id": a, "token": "not-a-token"}, expect=(401,))
    out["malformed_token_401"] = s == 401
    s, j = c.call("join", {"event_id": a, "code": "wrong-code", "nickname": "x"}, expect=(404,))
    out["wrong_code_404_generic"] = s == 404 and j.get("error") == "invalid_event_or_code"
    s, _ = c.call("drop", {}, expect=(400,))
    out["unknown_action_400"] = s == 400
    if tok:
        s, _ = c.call("read", {"event_id": b, "token": tok}, expect=(401,))
        out["cross_event_401"] = s == 401
        burst = spam_burst(c, a, tok)
        out["guest_spam_429"] = burst["typed_429"] >= 1 and burst["conclusive"]
    else:
        out["cross_event_401"] = out["guest_spam_429"] = False
        burst = {"method": "concurrent_burst", "conclusive": False, "verdict": "not_run_no_security_guest"}
    del tok
    return out, c, burst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="25,50,100")
    ap.add_argument("--workers", type=int, default=100, help="max concurrent fresh flows per stage")
    a = ap.parse_args()
    url = os.environ["PROBE_URL"]
    ev_a, code_a, ev_b = os.environ["PROBE_EVENT_A"], os.environ["PROBE_CODE_A"], os.environ["PROBE_EVENT_B"]
    apikey = os.environ.get("PROBE_APIKEY")
    report = {"runner_note": "overload check is a concurrent burst of 40 same-token reads, not sequential; single runner; egress IP, provider quotas, Realtime and app capacity not measured",
              "stages": []}
    c0 = Client(url, apikey)
    s, ct = c0.call("contract", {})
    report["contract_ok"] = s == 200 and ct.get("contract") == CONTRACT and ct.get("enabled") is True
    all_digests = []
    passed = report["contract_ok"] and c0.unexpected == 0
    for n in [int(x) for x in a.stages.split(",")]:
        c = Client(url, apikey)
        start = now(); t0 = time.perf_counter()
        with cf.ThreadPoolExecutor(max_workers=min(n, a.workers)) as ex:
            results = list(ex.map(lambda i: guest_flow(c, ev_a, code_a, f"{n}-{i}"), range(n)))
        digests = [digest(t) for _, t in results if t]
        all_digests += digests
        results = [ck for ck, _ in results]  # drop tokens
        checks = {k: {"pass": sum(1 for r in results if r[k]), "fail": sum(1 for r in results if not r[k])} for k in FLOW_CHECKS}
        completed = sum(1 for r in results if all(r.values()))
        stage_ok = completed == n and len(digests) == n and len(set(digests)) == n and c.unexpected == 0
        passed = passed and stage_ok
        report["stages"].append({
            "fresh_clients": n, "concurrency": min(n, a.workers), "start_utc": start, "end_utc": now(),
            "wall_s": round(time.perf_counter() - t0, 2), "successful_joins": len(digests),
            "clients_fully_passed": completed, "unique_tokens_in_stage": len(set(digests)),
            "unexpected_http": c.unexpected, "http": c.status, "ops": c.ops,
            "latency_ms": {k: {"p50": pct(v, 50), "p95": pct(v, 95), "n": len(v)} for k, v in c.lat.items()},
            "checks": checks, "stage_pass": stage_ok,
        })
    report["unique_tokens_overall"] = len(set(all_digests)) == len(all_digests)
    neg, cn, burst = negatives(url, apikey, ev_a, code_a, ev_b)
    report["overload_test"] = burst
    report["negatives"], report["negatives_http"], report["negatives_unexpected_http"] = neg, cn.status, cn.unexpected
    report["auth_signup_calls_observed"] = AUTH_CALLS
    passed = passed and report["unique_tokens_overall"] and all(neg.values()) and cn.unexpected == 0 and AUTH_CALLS == 0
    report["pass"] = bool(passed)
    json.dump(report, sys.stdout, indent=2)
    print()
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
