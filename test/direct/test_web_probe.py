"""Direct-mode tests for contracts/src/web_probe.py (each target's build, see _target.py) (presets 2 and 3). The leader path runs in
direct mode; validator functions are exercised with direct_vm.run_validator where the contract
uses a custom one (check_api with a tolerance)."""

import json

from _target import contract, source  # noqa: E402

CONTRACT = contract("web_probe")
SITE = "https://site.test/"
API = "https://api.test/status"


def deploy(direct_vm, direct_deploy, who):
    direct_vm.sender = who
    return direct_deploy(CONTRACT)


def hexof(addr) -> str:
    return "0x" + bytes(addr).hex() if not isinstance(addr, str) else addr


# ------------------------------------------------------------------ check_url


def test_url_ok_on_2xx_and_contains(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 200, "body": "<h1>All systems operational</h1>"})
    v = c.check_url("u1", "r1", SITE, 0, "operational")
    assert v == {"ok": True, "reachable": True, "status_class": "2xx", "status_ok": True, "match": True}
    rows = c.get_latest(hexof(direct_alice), "u1", 10)
    assert rows == [{"run_id": "r1", "kind": "url", "result": v}]


def test_url_content_mismatch_fails(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 200, "body": "Partial outage"})
    v = c.check_url("u1", "r1", SITE, 0, "operational")
    assert v["ok"] is False and v["status_ok"] is True and v["match"] is False


def test_url_status_down_is_a_result_not_a_revert(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 503, "body": "down"})
    v = c.check_url("u1", "r1", SITE, 0, "")
    assert v == {"ok": False, "reachable": True, "status_class": "5xx", "status_ok": False, "match": None}


def test_url_expect_exact_status(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 404, "body": ""})
    assert c.check_url("u1", "r1", SITE, 404, "")["ok"] is True
    assert c.check_url("u1", "r2", SITE, 200, "")["ok"] is False


def test_url_unreachable_is_recorded(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    # no mock: the request fails
    v = c.check_url("u1", "r1", "https://nowhere.test/", 0, "")
    assert v["reachable"] is False and v["ok"] is False


def test_url_rejects_bad_arguments(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("url must be http(s)"):
        c.check_url("u1", "r1", "file:///etc/passwd", 0, "")
    with direct_vm.expect_revert("bad expect_status"):
        c.check_url("u1", "r1", SITE, 42, "")
    with direct_vm.expect_revert("bad uptime_id"):
        c.check_url("a|b", "r1", SITE, 0, "")
    with direct_vm.expect_revert("bad run_id"):
        c.check_url("u1", "", SITE, 0, "")


# ------------------------------------------------------------------ check_api


def mock_api(direct_vm, body, status=200):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://api\.test/status", {"status": status, "body": body if isinstance(body, str) else json.dumps(body)})


def test_api_field_assertions(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    doc = {"status": {"indicator": "none", "up": True}, "items": [{"n": 3}, {"n": 7}], "tags": ["a", "b"]}
    cases = [
        ("status.indicator", "eq", "none", True, '"none"'),
        ("$.status.indicator", "ne", "major", True, '"none"'),
        ("status.up", "eq", "true", True, "true"),
        ("items[1].n", "gt", "5", True, "7"),
        ("items[0].n", "gte", "4", False, "3"),
        ('items[0]["n"]', "lte", "3", True, "3"),
        ("items[1].n", "eq", "7.0", True, "7"),
        ("tags", "contains", "b", True, '["a","b"]'),
        ("status", "exists", "", True, '{"indicator":"none","up":true}'),
    ]
    for i, (path, op, expected, ok, value) in enumerate(cases):
        mock_api(direct_vm, doc)
        v = c.check_api("u1", f"r{i}", API, path, op, expected, "")
        assert v == {"ok": ok, "value": value, "error": ""}, (path, op, v)


def test_api_errors_are_deterministic_results(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    mock_api(direct_vm, {"a": 1})
    assert c.check_api("u1", "r1", API, "b", "exists", "", "") == {"ok": False, "value": None, "error": "path_missing"}
    mock_api(direct_vm, "not json")
    assert c.check_api("u1", "r2", API, "a", "eq", "1", "")["error"] == "invalid_json"
    mock_api(direct_vm, {"a": 1}, status=500)
    assert c.check_api("u1", "r3", API, "a", "eq", "1", "")["error"] == "http_500"


def test_api_rejects_bad_arguments(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("bad op"):
        c.check_api("u1", "r1", API, "a", "regex", "x", "")
    with direct_vm.expect_revert("expected must be numeric"):
        c.check_api("u1", "r1", API, "a", "gt", "lots", "")
    with direct_vm.expect_revert("bad json_path"):
        c.check_api("u1", "r1", API, "a..b", "exists", "", "")
    with direct_vm.expect_revert("bad tolerance"):
        c.check_api("u1", "r1", API, "a", "gt", "1", "-1")


def test_api_tolerance_validator(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    mock_api(direct_vm, {"price": 100.0})
    v = c.check_api("u1", "r1", API, "price", "gt", "90", "0.5")
    assert v == {"ok": True, "value": "100.0", "error": ""}
    # validator sees a slightly different price: within tolerance -> agree
    mock_api(direct_vm, {"price": 100.4})
    assert direct_vm.run_validator() is True
    # outside tolerance -> disagree
    mock_api(direct_vm, {"price": 101.0})
    assert direct_vm.run_validator() is False
    # a leader that lies about ok for its own value -> disagree
    mock_api(direct_vm, {"price": 100.0})
    assert direct_vm.run_validator(leader_result={"ok": False, "value": "100.0", "error": ""}) is False
    # error classes must match
    mock_api(direct_vm, {"price": 100.0}, status=503)
    assert direct_vm.run_validator() is False


# ------------------------------------------------------------------ storage


def test_results_are_filed_under_the_caller(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 200, "body": "ok"})
    c.check_url("u1", "r1", SITE, 0, "")
    direct_vm.sender = direct_bob
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://site\.test/", {"status": 500, "body": "spoof"})
    c.check_url("u1", "r1", SITE, 0, "")
    alice_rows = c.get_latest(hexof(direct_alice), "u1", 10)
    bob_rows = c.get_latest(hexof(direct_bob), "u1", 10)
    assert len(alice_rows) == 1 and alice_rows[0]["result"]["ok"] is True
    assert len(bob_rows) == 1 and bob_rows[0]["result"]["ok"] is False


def test_retry_overwrites_and_ring_buffer_keeps_last(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://site\.test/", {"status": 200, "body": "ok"})
    c.check_url("u1", "r0", SITE, 0, "")
    c.check_url("u1", "r0", SITE, 0, "")
    assert c.get_count(hexof(direct_alice), "u1") == 1
    for i in range(1, 40):
        c.check_url("u1", f"r{i}", SITE, 0, "")
    rows = c.get_latest(hexof(direct_alice), "u1", 100)
    assert len(rows) == 32
    assert rows[0]["run_id"] == "r39" and rows[-1]["run_id"] == "r8"
    assert c.get_count(hexof(direct_alice), "u1") == 40
    assert c.get_run(hexof(direct_alice), "u1", "r20")["run_id"] == "r20"
    assert c.get_run(hexof(direct_alice), "u1", "r1") == {}
