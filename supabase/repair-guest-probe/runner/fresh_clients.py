#!/usr/bin/env python3
"""Fresh-client HTTP runner for the guest-token probe (stdlib only).

Each simulated guest is a brand-new client: no prepared identity, no Supabase
Auth. Server-issued tokens live only in memory and are never printed; the
report contains only sanitized counts/timings and a token uniqueness check.

Usage (operator supplies fixtures created via repair_guest_probe.operator_create_event):
  PROBE_URL=https://<staging>/functions/v1/guest-token-probe \
  PROBE_EVENT_A=<uuid> PROBE_CODE_A=<code> PROBE_EVENT_B=<uuid> PROBE_CODE_B=<code> \
  [PROBE_APIKEY=<publishable key, optional>] \
  python3 fresh_clients.py --stages 25,50,100 --workers 25 > report.json

Limits: this measures one runner's view. It does NOT prove egress-IP identity,
provider-level quotas, Realtime capacity, or app capacity.
"""
import argparse, concurrent.futures as cf, datetime as dt, json, os, statistics, sys, threading, time, urllib.error, urllib.parse, urllib.request, uuid

AUTH_CALLS = 0  # instrumentation: incremented if any request ever targets Auth
_lock = threading.Lock()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


class Client:
    def __init__(self, url, apikey):
        self.url, self.apikey = url, apikey
        self.lat = {}
        self.status = {}
        self.ops = {}

    def call(self, action, payload):
        global AUTH_CALLS
        path = urllib.parse.urlparse(self.url).path
        if "/auth/v1" in path:
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
        except ValueError:
            parsed = {}
        key = f"{action}:{code}:{parsed.get('error', 'ok') if code != 200 else 'ok'}"
        with _lock:
            self.lat.setdefault(action, []).append(ms)
            self.status[key] = self.status.get(key, 0) + 1
            self.ops[action] = self.ops.get(action, 0) + 1
        return code, parsed


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))], 1)


def guest_flow(c, ev, code, i):
    """One fresh guest: join, idempotent request x2, read, vote, repeat vote, rejoin."""
    res = {"joined": False, "token_fp": None, "checks": {}}
    s, j = c.call("join", {"event_id": ev, "code": code, "nickname": f"probe{i}"})
    if s != 200 or "token" not in j:
        return res
    tok = j["token"]
    res["joined"] = True
    res["token_fp"] = hash(tok)  # in-memory uniqueness only; never emitted
    k = str(uuid.uuid4())
    s1, r1 = c.call("request", {"event_id": ev, "token": tok, "idempotency_key": k, "title": f"Probe song {i}"})
    s2, r2 = c.call("request", {"event_id": ev, "token": tok, "idempotency_key": k, "title": f"Probe song {i}"})
    res["checks"]["idempotent_request"] = s1 == 200 and s2 == 200 and r1.get("request_id") == r2.get("request_id") and r2.get("replayed") is True
    s, rd = c.call("read", {"event_id": ev, "token": tok})
    reqs = rd.get("requests", []) if s == 200 else []
    target = next((x["id"] for x in reqs if not x.get("mine")), r1.get("request_id"))
    if target:
        v1s, v1 = c.call("vote", {"event_id": ev, "token": tok, "request_id": target, "value": 1})
        v2s, v2 = c.call("vote", {"event_id": ev, "token": tok, "request_id": target, "value": 1})
        res["checks"]["idempotent_vote"] = v1s == 200 and v2s == 200 and v2.get("changed") is False and v2.get("my_vote") == 1
    s, rj = c.call("join", {"event_id": ev, "token": tok})
    res["checks"]["resume_no_new_token"] = s == 200 and rj.get("resumed") is True and "token" not in rj
    res["_tok"] = tok  # kept in memory for negative tests; stripped before report
    return res


def negatives(c, a, b, tok_a):
    out = {}
    s, _ = c.call("read", {"event_id": a})
    out["missing_token_401"] = s == 401
    s, _ = c.call("read", {"event_id": a, "token": "0" * 64})
    out["forged_token_401"] = s == 401
    s, _ = c.call("read", {"event_id": a, "token": "not-a-token"})
    out["malformed_token_401"] = s == 401
    s, _ = c.call("read", {"event_id": b, "token": tok_a})
    out["cross_event_401"] = s == 401
    s, j = c.call("join", {"event_id": a, "code": "wrong-code", "nickname": "x"})
    out["wrong_code_404_generic"] = s == 404 and j.get("error") == "invalid_event_or_code"
    s, _ = c.call("drop", {})
    out["unknown_action_400"] = s == 400
    # spam limit: hammer reads on one token until typed 429
    hit = False
    for _ in range(40):
        s, j = c.call("read", {"event_id": a, "token": tok_a})
        if s == 429 and j.get("error") == "guest_rate_limited":
            hit = True
            break
    out["guest_spam_429"] = hit
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="25,50,100")
    ap.add_argument("--workers", type=int, default=25)
    a = ap.parse_args()
    url = os.environ["PROBE_URL"]
    ev_a, code_a = os.environ["PROBE_EVENT_A"], os.environ["PROBE_CODE_A"]
    ev_b = os.environ["PROBE_EVENT_B"]
    apikey = os.environ.get("PROBE_APIKEY")
    report = {"contract": None, "runner_note": "single runner; egress IP and provider quotas not measured", "stages": []}
    c0 = Client(url, apikey)
    _, ct = c0.call("contract", {})
    report["contract"] = ct.get("contract")
    all_fps = []
    last_tok = None
    for n in [int(x) for x in a.stages.split(",")]:
        c = Client(url, apikey)
        start = now(); t0 = time.perf_counter()
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            results = list(ex.map(lambda i: guest_flow(c, ev_a, code_a, f"{n}-{i}"), range(n)))
        fps = [r["token_fp"] for r in results if r["joined"]]
        all_fps += fps
        for r in results:
            if r.get("_tok"):
                last_tok = r.pop("_tok")
        checks = {}
        for r in results:
            for k, v in r["checks"].items():
                checks.setdefault(k, [0, 0])[0 if v else 1] += 1
        report["stages"].append({
            "fresh_clients": n, "start_utc": start, "end_utc": now(), "wall_s": round(time.perf_counter() - t0, 2),
            "successful_joins": len(fps), "unique_tokens_in_stage": len(set(fps)),
            "http": c.status, "ops": c.ops,
            "latency_ms": {k: {"p50": pct(v, 50), "p95": pct(v, 95), "n": len(v)} for k, v in c.lat.items()},
            "checks_pass_fail": checks,
        })
    report["unique_tokens_overall"] = len(set(all_fps)) == len(all_fps)
    if last_tok:
        cn = Client(url, apikey)
        report["negatives"] = negatives(cn, ev_a, ev_b, last_tok)
        report["negatives_http"] = cn.status
    report["auth_signup_calls_observed"] = AUTH_CALLS
    del last_tok
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
