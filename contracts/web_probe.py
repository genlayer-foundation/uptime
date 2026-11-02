# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# WebProbe: presets 2 ("Check a URL") and 3 ("Check an API") of docs/PRODUCT.md §4.
#
# Deployed ONCE per network by us; users never deploy it. Anyone may call it: every result is
# stored under the CALLER's address, so a record can only ever be written by the account that
# sent it. Readers (the uptime backend, the public status feed) must read results under the
# relayer's address, never trust a result filed under someone else's.
#
# Consensus: the leader fetches and reduces the response to a small VERDICT; validators fetch
# again and must produce the same verdict. Bodies are never compared or stored, so a dynamic
# page still reaches agreement as long as the verdict holds.

from genlayer import *
from dataclasses import dataclass
import json
import re

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"

KEEP = 32  # results kept per (caller, uptime); older ones are overwritten
MAX_ID = 128
MAX_URL = 2048
MAX_TEXT = 256
VALUE_CHARS = 256
OPS = ("eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists")
NUMERIC_OPS = ("gt", "gte", "lt", "lte")
_PATH_TOKEN = re.compile(r"\.?([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]|\[\"([^\"]*)\"\]")


@allow_storage
@dataclass
class Record:
    run_id: str
    kind: str
    result: str  # canonical JSON of the verdict


def _expect(cond: bool, msg: str) -> None:
    if not cond:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {msg}")


def _check_url_arg(url: str) -> None:
    _expect(len(url) <= MAX_URL, "url too long")
    _expect(url.startswith("https://") or url.startswith("http://"), "url must be http(s)")


def _check_ids(uptime_id: str, run_id: str) -> None:
    _expect(0 < len(uptime_id) <= MAX_ID and "|" not in uptime_id, "bad uptime_id")
    _expect(0 < len(run_id) <= MAX_ID, "bad run_id")


def _canon(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def parse_path(path: str) -> list:
    """`a.b[0].c`, `$.a.b`, `a["odd key"]` -> ["a", "b", 0, "c"]. Empty path = the whole document."""
    p = path.strip()
    if p.startswith("$"):
        p = p[1:]
    out = []
    pos = 0
    while pos < len(p):
        m = _PATH_TOKEN.match(p, pos)
        if m is None or m.end() == pos:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} bad json_path at {pos}")
        if m.group(1) is not None:
            out.append(m.group(1))
        elif m.group(2) is not None:
            out.append(int(m.group(2)))
        else:
            out.append(m.group(3))
        pos = m.end()
    return out


def _extract(doc, path: list):
    cur = doc
    for step in path:
        if isinstance(step, int):
            if not isinstance(cur, list) or step >= len(cur):
                return False, None
            cur = cur[step]
        else:
            if not isinstance(cur, dict) or step not in cur:
                return False, None
            cur = cur[step]
    return True, cur


def _loads(text):
    try:
        return json.loads(text)
    except Exception:
        return text  # a value truncated to VALUE_CHARS is no longer JSON


def _as_number(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _scalar_text(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return v
    return _canon(v)


def compare(value, op: str, expected: str) -> bool:
    """Deterministic assertion of `value <op> expected`. `expected` is always given as text."""
    if op == "exists":
        return True
    if op == "contains":
        if isinstance(value, list):
            return any(_scalar_text(x) == expected for x in value)
        return expected in _scalar_text(value)
    if op in ("eq", "ne"):
        a = _as_number(value) if not isinstance(value, str) else None
        b = _as_number(expected)
        if a is not None and b is not None:
            same = a == b
        else:
            same = _scalar_text(value) == expected
        return same if op == "eq" else not same
    a = _as_number(value)
    b = _as_number(expected)
    if a is None or b is None:
        return False
    if op == "gt":
        return a > b
    if op == "gte":
        return a >= b
    if op == "lt":
        return a < b
    return a <= b


def url_verdict(status: int, body: str, expect_status: int, contains: str) -> dict:
    status_ok = status == expect_status if expect_status else 200 <= status < 300
    match = None if contains == "" else contains in body
    return {
        "ok": status_ok and match is not False,
        "reachable": True,
        "status_class": str(status // 100) + "xx",
        "status_ok": status_ok,
        "match": match,
    }


UNREACHABLE = {"ok": False, "reachable": False, "status_class": "", "status_ok": False, "match": None}


class WebProbe(gl.Contract):
    # "<caller>|<uptime_id>|<slot>" -> Record ; "<caller>|<uptime_id>" -> runs written
    slots: TreeMap[str, Record]
    counts: TreeMap[str, u256]

    def __init__(self):
        pass

    # ---------------------------------------------------------------- storage

    def _base(self, caller: str, uptime_id: str) -> str:
        return caller.lower() + "|" + uptime_id

    def _store(self, uptime_id: str, run_id: str, kind: str, result: dict) -> None:
        base = self._base(gl.message.sender_address.as_hex, uptime_id)
        n = int(self.counts.get(base, u256(0)))
        rec = Record(run_id=run_id, kind=kind, result=_canon(result))
        # A retried run (same run_id) overwrites its own slot instead of taking a new one.
        for i in range(max(0, n - KEEP), n):
            key = base + "|" + str(i % KEEP)
            if self.slots[key].run_id == run_id:
                self.slots[key] = rec
                return
        self.slots[base + "|" + str(n % KEEP)] = rec
        self.counts[base] = u256(n + 1)

    def _rows(self, caller: str, uptime_id: str) -> list:
        base = self._base(Address(caller).as_hex, uptime_id)
        n = int(self.counts.get(base, u256(0)))
        out = []
        for i in range(n - 1, max(0, n - KEEP) - 1, -1):
            r = self.slots[base + "|" + str(i % KEEP)]
            out.append({"run_id": r.run_id, "kind": r.kind, "result": json.loads(r.result)})
        return out

    # ---------------------------------------------------------------- probes

    @gl.public.write
    def check_url(self, uptime_id: str, run_id: str, url: str, expect_status: u256, contains: str) -> dict:
        """GET `url`. ok = status matches (`expect_status`, or any 2xx when 0) and, if `contains`
        is non-empty, the body contains it (case-sensitive). Stores and returns the verdict."""
        _check_ids(uptime_id, run_id)
        _check_url_arg(url)
        _expect(len(contains) <= MAX_TEXT, "contains too long")
        _expect(int(expect_status) == 0 or 100 <= int(expect_status) <= 599, "bad expect_status")
        want = int(expect_status)

        def run() -> str:
            try:
                res = gl.nondet.web.get(url)
            except Exception:
                return _canon(UNREACHABLE)
            body = res.body.decode("utf-8", errors="replace") if res.body else ""
            return _canon(url_verdict(int(res.status), body, want, contains))

        verdict = json.loads(gl.eq_principle.strict_eq(run))
        self._store(uptime_id, run_id, "url", verdict)
        return verdict

    @gl.public.write
    def check_api(
        self,
        uptime_id: str,
        run_id: str,
        url: str,
        json_path: str,
        op: str,
        expected: str,
        tolerance: str,
    ) -> dict:
        """GET `url`, parse JSON, take the value at `json_path`, assert `value <op> expected`.
        Stores {ok, value, error}. With `tolerance` empty the verdict must match exactly
        (strict_eq: point it at a stable field). With a numeric `tolerance`, validators accept the
        leader's value if their own is within it (for prices, counters)."""
        _check_ids(uptime_id, run_id)
        _check_url_arg(url)
        _expect(op in OPS, "bad op")
        _expect(len(expected) <= MAX_TEXT and len(json_path) <= MAX_TEXT, "argument too long")
        if op in NUMERIC_OPS:
            _expect(_as_number(expected) is not None, "expected must be numeric for " + op)
        path = parse_path(json_path)
        tol = None
        if tolerance.strip() != "":
            tol = _as_number(tolerance)
            _expect(tol is not None and tol >= 0, "bad tolerance")

        def leader_fn() -> dict:
            try:
                res = gl.nondet.web.get(url)
            except Exception:
                return {"ok": False, "value": None, "error": "unreachable"}
            status = int(res.status)
            if not 200 <= status < 300:
                return {"ok": False, "value": None, "error": "http_" + str(status)}
            try:
                doc = json.loads(res.body.decode("utf-8"))
            except Exception:
                return {"ok": False, "value": None, "error": "invalid_json"}
            found, value = _extract(doc, path)
            if not found:
                return {"ok": False, "value": None, "error": "path_missing"}
            text = _canon(value)
            if len(text) > VALUE_CHARS:
                text = text[:VALUE_CHARS]
            return {"ok": compare(value, op, expected), "value": text, "error": ""}

        def canonical_fn() -> str:
            return _canon(leader_fn())

        if tol is None:
            verdict = json.loads(gl.eq_principle.strict_eq(canonical_fn))
        else:

            def validator_fn(leaders_res: gl.vm.Result) -> bool:
                if not isinstance(leaders_res, gl.vm.Return):
                    return False
                theirs = leaders_res.calldata
                mine = leader_fn()
                if theirs.get("error") != mine["error"]:
                    return False
                if mine["error"] != "":
                    return True
                a = _as_number(_loads(theirs["value"]))
                b = _as_number(_loads(mine["value"]))
                if a is None or b is None:
                    return theirs == mine
                if abs(a - b) > tol:
                    return False
                # the leader's verdict must be what ITS value gives
                return theirs["ok"] == compare(_loads(theirs["value"]), op, expected)

            verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self._store(uptime_id, run_id, "api", verdict)
        return verdict

    # ---------------------------------------------------------------- views

    @gl.public.view
    def get_latest(self, caller: str, uptime_id: str, limit: u256) -> list:
        """Newest first, at most `limit` (and at most KEEP) results filed by `caller`."""
        return self._rows(caller, uptime_id)[: int(limit)]

    @gl.public.view
    def get_run(self, caller: str, uptime_id: str, run_id: str) -> dict:
        for row in self._rows(caller, uptime_id):
            if row["run_id"] == run_id:
                return row
        return {}

    @gl.public.view
    def get_count(self, caller: str, uptime_id: str) -> u256:
        """Distinct runs ever filed (only the last KEEP are readable)."""
        return self.counts.get(self._base(Address(caller).as_hex, uptime_id), u256(0))
