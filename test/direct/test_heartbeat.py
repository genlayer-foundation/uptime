"""Direct-mode tests for contracts/heartbeat.py (leader path only; consensus
is exercised on Bradbury itself)."""

import json
import re

CONTRACT = "contracts/heartbeat.py"
BASE = "https://heartbeat.test/heartbeat"


def deploy(direct_vm, direct_deploy, owner):
    direct_vm.sender = owner
    return direct_deploy(CONTRACT, BASE + "/")


def test_questions_match_answer_key(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    on_chain = [q["qid"] for q in c.get_questions()]
    with open("frontend/src/lib/heartbeat/questions.ts") as f:
        off_chain = re.findall(r'qid: "([^"]+)"', f.read())
    assert on_chain == off_chain


def test_fetch_probe_canonicalizes(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r".*heartbeat\.test/heartbeat/static\.json", {"status": 200, "body": '{"version": 1, "heartbeat": "ok"}'})
    c.probe_fetch(1)
    # Must equal FETCH_EXPECTED in frontend/src/lib/heartbeat/questions.ts
    assert c.get_probe("1:fetch")["answer"] == '{"heartbeat": "ok", "version": 1}'
    assert c.get_count() == 1


def test_llm_probe_normalizes_answer(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*chemical symbol for gold.*", json.dumps({"answer": " Au. "}))
    c.probe_llm(3, "fact-gold")
    assert c.get_probe("3:fact-gold") == {"tick": 3, "qid": "fact-gold", "answer": "au"}


def test_llm_probe_accepts_alias_key(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*487 multiplied by 36.*", json.dumps({"result": "17,532"}))
    c.probe_llm(1, "math-mul")
    assert c.get_probe("1:math-mul")["answer"] == "17532"


def test_reading_probe_sends_fixture(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r".*heartbeat\.test/heartbeat/lighthouse\.txt", {"status": 200, "body": "The keeper is Marisol Ferrandiz."})
    direct_vm.mock_llm(r"(?s).*Marisol Ferrandiz.*lighthouse keeper.*", json.dumps({"answer": "Ferrandiz"}))
    c.probe_llm(2, "reading-keeper")
    assert c.get_probe("2:reading-keeper")["answer"] == "ferrandiz"


def test_unknown_qid_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("unknown qid"):
        c.probe_llm(1, "nope")


def test_probes_are_owner_only(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only owner"):
        c.probe_fetch(1)
    with direct_vm.expect_revert("only owner"):
        c.probe_llm(1, "fact-gold")


def test_rerun_same_key_does_not_duplicate(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*chemical symbol for gold.*", json.dumps({"answer": "Au"}))
    c.probe_llm(1, "fact-gold")
    c.probe_llm(1, "fact-gold")
    assert c.get_count() == 1
    assert c.get_probes(0, 10) == [{"tick": 1, "qid": "fact-gold", "answer": "au"}]


def test_inlined_canary_matches_contract():
    with open("frontend/src/lib/heartbeat/canary.ts") as f:
        inlined = f.read().split("CANARY_SOURCE = `", 1)[1].rsplit("`;", 1)[0]
    with open("contracts/canary.py") as f:
        assert inlined == f.read()
