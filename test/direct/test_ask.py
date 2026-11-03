"""Direct-mode tests for contracts/ask.py (preset 4)."""

import json

CONTRACT = "contracts/ask.py"


def deploy(direct_vm, direct_deploy, who):
    direct_vm.sender = who
    return direct_deploy(CONTRACT)


def hexof(addr) -> str:
    return "0x" + bytes(addr).hex() if not isinstance(addr, str) else addr


def test_closed_book_answer_is_normalized_and_stored(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*capital of France.*", json.dumps({"answer": " Paris. "}))
    assert c.ask("u1", "r1", "What is the capital of France?", "") == "paris"
    assert c.get_run(hexof(direct_alice), "u1", "r1") == {
        "run_id": "r1",
        "question": "What is the capital of France?",
        "source_url": "",
        "answer": "paris",
    }


def test_source_page_is_stripped_and_sent(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(
        r"https://search\.test/.*",
        {"status": 200, "body": "<html><script>evil()</script><p>Latest GenLayer release: v0.6.0</p></html>"},
    )
    direct_vm.mock_llm(r"(?s)^(?!.*evil).*Latest GenLayer release: v0\.6\.0.*latest release.*", json.dumps({"result": "v0.6.0"}))
    assert c.ask("u1", "r1", "What is the latest release?", "https://search.test/?q=genlayer+release") == "v060"


def test_validator_agrees_only_on_same_normalized_answer(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*capital of France.*", json.dumps({"answer": "Paris"}))
    c.ask("u1", "r1", "What is the capital of France?", "")
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*capital of France.*", json.dumps({"answer": "PARIS!"}))
    assert direct_vm.run_validator() is True
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*capital of France.*", json.dumps({"answer": "Lyon"}))
    assert direct_vm.run_validator() is False


def test_source_errors_are_classified(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_web(r"https://gone\.test/", {"status": 404, "body": ""})
    with direct_vm.expect_revert("[EXTERNAL] source returned 404"):
        c.ask("u1", "r1", "What does it say?", "https://gone.test/")
    direct_vm.mock_web(r"https://busy\.test/", {"status": 502, "body": ""})
    with direct_vm.expect_revert("[TRANSIENT]"):
        c.ask("u1", "r1", "What does it say?", "https://busy.test/")


def test_llm_garbage_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*anything.*", json.dumps({"foo": "bar"}))
    with direct_vm.expect_revert("missing answer"):
        c.ask("u1", "r1", "anything?", "")


def test_rejects_bad_arguments(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("bad question"):
        c.ask("u1", "r1", "   ", "")
    with direct_vm.expect_revert("bad question"):
        c.ask("u1", "r1", "x" * 1001, "")
    with direct_vm.expect_revert("url must be http(s)"):
        c.ask("u1", "r1", "q?", "ftp://x")


def test_results_are_filed_under_the_caller(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*colour.*", json.dumps({"answer": "blue"}))
    c.ask("u1", "r1", "Which colour?", "")
    direct_vm.sender = direct_bob
    c.ask("u1", "r1", "Which colour?", "")
    assert c.get_count(hexof(direct_alice), "u1") == 1
    assert c.get_count(hexof(direct_bob), "u1") == 1
    assert c.get_latest(hexof(direct_alice), "u2", 5) == []


def test_validator_compares_agreed_errors(direct_vm, direct_deploy, direct_alice):
    # GenVM v0.6 carries a UserError's text in `.data` (it was `.message`).
    c = deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.mock_llm(r".*capital of France.*", json.dumps({"answer": "Paris"}))
    direct_vm.mock_web(r"https://src\.test/", {"status": 200, "body": "<p>France: Paris</p>"})
    c.ask("u1", "r1", "What is the capital of France?", "https://src.test/")
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://src\.test/", {"status": 404, "body": ""})
    assert direct_vm.run_validator(leader_error=Exception("[EXTERNAL] source returned 404")) is True
    assert direct_vm.run_validator(leader_error=Exception("[EXTERNAL] source returned 410")) is False
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://src\.test/", {"status": 503, "body": ""})
    assert direct_vm.run_validator(leader_error=Exception("[TRANSIENT] source unreachable")) is True
