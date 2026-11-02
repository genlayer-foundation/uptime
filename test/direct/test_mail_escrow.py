"""Direct-mode tests for contracts/mail_escrow.py.

Messages are DKIM-signed here with real RSA keys (pycryptodome) by a small test signer, and the
contract's verifier is also checked against the published RFC 8463 rsa-sha256 test vector, so a
bug shared by the signer and the verifier cannot hide. Transfers are captured with the direct
VM's gl_call hook: every `emit_transfer` is an `EthSend` with empty calldata."""

import base64
import hashlib
import json
import re
import sys

import pytest
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15

CONTRACT = "contracts/mail_escrow.py"
DOMAIN = "uptime.example"
SELECTOR = "pm1"
DOH = "https://dns.test/resolve"
EVIDENCE = "https://evidence.test/e/"
PRICE = 10**16  # 0.01 GEN
T0 = 1_793_000_000  # a fixed "now" (2026-10-26)
TO = "ivan@example.org"

KEY = RSA.generate(2048, e=65537)
EVIL = RSA.generate(2048, e=65537)


def der(k) -> bytes:
    return k.publickey().export_key("DER")


def pin(k) -> str:
    return hashlib.sha256(der(k)).hexdigest()


def iso(ts: int) -> str:
    import datetime

    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def hexof(addr) -> str:
    if isinstance(addr, str):
        return addr.lower()
    if hasattr(addr, "as_hex"):
        return addr.as_hex.lower()
    return "0x" + bytes(addr).hex()


def mod():
    return sys.modules["_contract_mail_escrow"]


# ------------------------------------------------------------------ test DKIM signer


def _relaxed_h(raw: str) -> str:
    name, val = raw.split(":", 1)
    return name.strip().lower() + ":" + re.sub(r"[ \t]+", " ", val.replace("\r\n", "")).strip(" \t") + "\r\n"


def _relaxed_b(body: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", ln).rstrip(" ") for ln in body.split("\r\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "".join(ln + "\r\n" for ln in lines)


def _simple_b(body: str) -> str:
    while body.endswith("\r\n\r\n"):
        body = body[:-2]
    return body if body.endswith("\r\n") else body + "\r\n"


def sign(
    headers: list,
    body: str,
    *,
    key=KEY,
    domain=DOMAIN,
    selector=SELECTOR,
    t=T0,
    canon="relaxed/relaxed",
    h="from:to:subject:date:message-id",
    extra="",
) -> bytes:
    """headers: ["Name: value", ...] in message order. Returns the raw signed message."""
    hc, bc = canon.split("/")
    raw_headers = [x + "\r\n" for x in headers]
    cb = _relaxed_b(body) if bc == "relaxed" else _simple_b(body)
    bh = base64.b64encode(hashlib.sha256(cb.encode()).digest()).decode()
    value = f" v=1; a=rsa-sha256; c={canon}; d={domain}; s={selector};\r\n t={t}; h={h};{extra} bh={bh};\r\n b="
    data = ""
    used = {}
    for name in [n.strip().lower() for n in h.split(":")]:
        idx = [i for i, x in enumerate(raw_headers) if x.split(":", 1)[0].strip().lower() == name]
        k = used.get(name, 0)
        used[name] = k + 1
        if k < len(idx):
            x = raw_headers[idx[-1 - k]]
            data += _relaxed_h(x) if hc == "relaxed" else x
    sig_h = "DKIM-Signature:" + value
    data += _relaxed_h(sig_h)[:-2] if hc == "relaxed" else sig_h
    sig = pkcs1_15.new(key).sign(SHA256.new(data.encode()))
    b = base64.b64encode(sig).decode()
    signed = sig_h + b[:60] + "\r\n " + b[60:] + "\r\n"
    return (signed + "".join(raw_headers) + "\r\n" + body).encode()


def alert(token: str, to: str = f"Ivan <{TO}>", **kw) -> bytes:
    headers = [
        'From: "GenLayer Uptime" <alerts@uptime.example>',
        f"To: {to}",
        "Subject: [Uptime] Job failed: Heartbeat",
        "Date: Mon, 26 Oct 2026 12:00:00 +0000",
        "Message-ID: <abc123@uptime.example>",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
    ]
    body = (
        'Your Uptime job "Heartbeat" failed on Bradbury testnet: a transaction timed out.\r\n'
        "\r\n"
        "Job: job-1\r\nRun: 42\r\n\r\n"
        f"Receipt: {token}\r\n"
        "\r\n"
    )
    return sign(headers, body, **kw)


# ------------------------------------------------------------------ fixtures


@pytest.fixture
def env(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob, direct_charlie):
    """owner = admin, alice = job owner, bob = mailer, charlie = payee (project wallet)."""
    sends = []

    def hook(vm, request):
        if "EthSend" in request:
            sends.append((hexof(request["EthSend"]["address"]), int(request["EthSend"]["value"])))
            return {"ok": None}
        return None

    direct_vm._gl_call_hook = hook
    direct_vm.warp(iso(T0))
    direct_vm.sender = direct_owner
    c = direct_deploy(CONTRACT, hexof(direct_bob), hexof(direct_charlie), DOMAIN, SELECTOR, pin(KEY), PRICE, 3600, DOH)

    class E:
        pass

    e = E()
    e.vm, e.c, e.sends = direct_vm, c, sends
    e.admin, e.owner, e.mailer, e.payee = direct_owner, direct_alice, direct_bob, direct_charlie
    e.mod = mod()
    e.rh = e.mod.recipient_hash(TO, hexof(direct_alice))
    return e


def open_job(e, job="job-1", value=10 * PRICE, cap=0, ttl=0, recipients=None):
    e.vm.sender = e.owner
    e.vm.value = value
    e.c.open_job(job, recipients or [e.rh], cap, ttl)
    e.vm.value = 0


def dns(e, key=KEY, selector=SELECTOR, status=0, txt=None):
    p = base64.b64encode(der(key)).decode()
    body = {"Status": status, "Answer": [{"name": f"{selector}._domainkey.{DOMAIN}.", "type": 16, "TTL": 300, "data": txt if txt is not None else f"v=DKIM1; k=rsa; p={p}"}]}
    if status == 3:
        body.pop("Answer")
    e.vm.mock_web(re.escape(DOH) + r"\?name=" + re.escape(selector) + r"\._domainkey\..*", {"status": 200, "body": json.dumps(body)})


def publish(e, raw: bytes, name="m1", status=200):
    # content-addressed, as the mailer would publish it: one URL per exact message
    url = EVIDENCE + name + "-" + hashlib.sha256(raw).hexdigest()[:16]
    e.vm.mock_web(re.escape(url) + "$", {"status": status, "body": raw.decode()})
    return url, hashlib.sha256(raw).hexdigest()


def token(e, email_id, job="job-1", template="alert"):
    return e.c.receipt_token_for(hexof(e.owner), job, email_id, template)


def claim(e, email_id, raw, job="job-1", template="alert", url_name=None, sha=None):
    url, h = publish(e, raw, url_name or email_id)
    e.vm.sender = e.mailer
    return e.c.claim(hexof(e.owner), job, email_id, template, url, sha or h)


# ------------------------------------------------------------------ the verifier itself


RFC8463_KEY = (
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDkHlOQoBTzWRiGs5V6NpP3idY6Wk08a5qhdR6wy5bdOKb2jLQiY/J16JYi0Qvx/byYzCNb3W91y3FutAC"
    "DfzwQ/BC/e/8uBsCR+yz1Lxj+PL6lHvqMKrM3rG4hstT5QjvHO9PzoxZyVYLzBfO2EeC3Ip3G+2kryOTIKT+l/K4w3QIDAQAB"
)
RFC8463_MSG = "\r\n".join(
    [
        "DKIM-Signature: v=1; a=ed25519-sha256; c=relaxed/relaxed;",
        " d=football.example.com; i=@football.example.com;",
        " q=dns/txt; s=brisbane; t=1528637909; h=from : to :",
        " subject : date : message-id : from : subject : date;",
        " bh=2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=;",
        " b=/gCrinpcQOoIfuHNQIbq4pgh9kyIK3AQUdt9OdqQehSwhEIug4D11Bus",
        " Fa3bT3FY5OsU7ZbnKELq+eXdp1Q1Dw==",
        "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;",
        " d=football.example.com; i=@football.example.com;",
        " q=dns/txt; s=test; t=1528637909; h=from : to : subject :",
        " date : message-id : from : subject : date;",
        " bh=2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=;",
        " b=F45dVWDfMbQDGHJFlXUNB2HKfbCeLRyhDXgFpEL8GwpsRe0IeIixNTe3",
        " DhCVlUrSjV4BwcVcOF6+FF3Zo9Rpo1tFOeS9mPYQTnGdaSGsgeefOsk2Jz",
        " dA+L10TeYt9BgDfQNZtKdN1WO//KgIqXP7OdEFE4LjFYNcUxZQ4FADY+8=",
        "From: Joe SixPack <joe@football.example.com>",
        "To: Suzie Q <suzie@shopping.example.net>",
        "Subject: Is dinner ready?",
        "Date: Fri, 11 Jul 2003 21:00:37 -0700 (PDT)",
        "Message-ID: <20030712040037.46341.5F8J@football.example.com>",
        "",
        "Hi.",
        "",
        "We lost the game.  Are you hungry yet?",
        "",
        "Joe.",
        "",
        "",
    ]
).encode()


def test_rfc8463_rsa_vector_verifies(env):
    m = env.mod
    key_pin = hashlib.sha256(base64.b64decode(RFC8463_KEY)).hexdigest()
    fetch = lambda s: "v=DKIM1; k=rsa; p=" + RFC8463_KEY
    v = m.verify_message(RFC8463_MSG, "football.example.com", {"test": key_pin}, fetch)
    assert v["ok"] is True, v
    assert v["selector"] == "test" and v["t"] == 1528637909
    assert m.single_address(v["to"]) == "suzie@shopping.example.net"
    # the ed25519 signature is skipped (unsupported), the rsa one carries the message
    tampered = RFC8463_MSG.replace(b"We lost the game.", b"We won the game.")
    assert m.verify_message(tampered, "football.example.com", {"test": key_pin}, fetch)["reason"] == "body_hash_mismatch"
    forged_to = RFC8463_MSG.replace(b"suzie@shopping", b"mallory@shopping")
    assert m.verify_message(forged_to, "football.example.com", {"test": key_pin}, fetch)["reason"] == "bad_signature"


def test_canonicalization_and_parsing_helpers(env):
    m = env.mod
    assert m.canon_body(b"a  b \t\r\n\r\n\r\n", "relaxed") == b"a b\r\n"
    assert m.canon_body(b"", "relaxed") == b""
    assert m.canon_body(b"", "simple") == b"\r\n"
    assert m.canon_body(b"x\r\n\r\n", "simple") == b"x\r\n"
    assert m.canon_header(b"SubJect :  Hi \r\n  there\r\n", "relaxed") == b"subject:Hi there\r\n"
    assert m.single_address('"Doe, Jane" <JANE@x.org>') == "jane@x.org"
    assert m.single_address("a@x.org") == "a@x.org"
    assert m.single_address("a@x.org, b@x.org") == ""
    assert m.single_address("<a@x.org> <b@x.org>") == ""
    assert m.dns_txt({"Status": 3}) == ""
    assert m.dns_txt({"Status": 0, "Answer": [{"type": 16, "data": '"v=DKIM1; p=AB" "CD"'}]}) == "v=DKIM1; p=ABCD"
    with pytest.raises(ValueError):
        m.dns_txt({"Status": 2})
    n, e_ = m.rsa_public_key(der(KEY))
    assert n == KEY.n and e_ == 65537


# ------------------------------------------------------------------ happy path


def test_claim_releases_fee_to_payee(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"))
    out = claim(env, "e1", raw)
    assert out == {"email_id": "e1", "amount": PRICE, "signed_at": T0, "day": T0 // 86400}
    assert env.sends == [(hexof(env.payee), PRICE)]
    job = env.c.get_job(hexof(env.owner), "job-1")
    assert job["balance"] == 9 * PRICE and job["claimed"] == 1
    assert env.c.get_claim("e1")["amount"] == PRICE
    cfg = env.c.get_config()
    assert cfg["total_escrowed"] == 9 * PRICE and cfg["total_released"] == PRICE


def test_simple_canonicalization_and_bare_lf_evidence(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"), canon="simple/simple")
    assert claim(env, "e1", raw)["amount"] == PRICE
    raw2 = alert(token(env, "e2")).replace(b"\r\n", b"\n")  # mailbox exports often use LF
    assert claim(env, "e2", raw2)["amount"] == PRICE


def test_validator_agrees_and_rejects_a_changed_world(env):
    open_job(env)
    dns(env)
    claim(env, "e1", alert(token(env, "e1")))
    assert env.vm.run_validator() is True
    # a validator that sees the key swapped in DNS must not agree with an ok verdict
    env.vm.clear_mocks()
    publish(env, alert(token(env, "e1")), "e1")
    dns(env, key=EVIL)
    assert env.vm.run_validator() is False


def test_transient_errors_are_classified(env):
    open_job(env)
    dns(env)
    url = EVIDENCE + "down"
    env.vm.mock_web(re.escape(url) + "$", {"status": 503, "body": ""})
    env.vm.sender = env.mailer
    with env.vm.expect_revert("[TRANSIENT] evidence returned 503"):
        env.c.claim(hexof(env.owner), "job-1", "e1", "alert", url, "0" * 64)
    url = EVIDENCE + "gone"
    env.vm.mock_web(re.escape(url) + "$", {"status": 404, "body": ""})
    with env.vm.expect_revert("[EXTERNAL] evidence returned 404"):
        env.c.claim(hexof(env.owner), "job-1", "e1", "alert", url, "0" * 64)


# ------------------------------------------------------------------ forged evidence


def test_forged_signature_with_own_key_in_dns_is_refused(env):
    open_job(env)
    dns(env, key=EVIL)  # attacker controls DNS and serves their own key
    with env.vm.expect_revert("dns_key_not_pinned_key"):
        claim(env, "e1", alert(token(env, "e1"), key=EVIL))


def test_signature_by_wrong_key_is_refused(env):
    open_job(env)
    dns(env)  # the real, pinned key
    with env.vm.expect_revert("bad_signature"):
        claim(env, "e1", alert(token(env, "e1"), key=EVIL))


def test_tampered_message_is_refused(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"))
    with env.vm.expect_revert("body_hash_mismatch"):
        claim(env, "e1", raw.replace(b"timed out", b"succeeded"))
    other = env.mod.recipient_hash("other@example.org", hexof(env.owner))
    env.vm.sender = env.owner
    env.c.set_job("job-1", [env.rh, other], 0, T0 + 86400 * 30)
    with env.vm.expect_revert("bad_signature"):
        claim(env, "e1", raw.replace(TO.encode(), b"other@example.org"))


def test_unsigned_extra_to_header_is_refused(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"), to="nobody@evil.test")
    with env.vm.expect_revert("need_one_from_and_one_to"):
        claim(env, "e1", f"To: {TO}\r\n".encode() + raw)


def test_wrong_domain_selector_revoked_and_missing_key(env):
    open_job(env)
    dns(env)
    with env.vm.expect_revert("no_signature_for_domain"):
        claim(env, "e1", alert(token(env, "e1"), domain="pm.mtasv.example"))
    with env.vm.expect_revert("selector_not_pinned"):
        claim(env, "e1", alert(token(env, "e1"), selector="other"))
    env.vm.clear_mocks()
    dns(env, txt="v=DKIM1; k=rsa; p=")
    with env.vm.expect_revert("key_revoked"):
        claim(env, "e1", alert(token(env, "e1")))
    env.vm.clear_mocks()
    dns(env, status=3)
    with env.vm.expect_revert("dkim_key_missing"):
        claim(env, "e1", alert(token(env, "e1")))


def test_body_length_tag_and_unsigned_to_are_refused(env):
    open_job(env)
    dns(env)
    with env.vm.expect_revert("sig_body_length_limit"):
        claim(env, "e1", alert(token(env, "e1"), extra=" l=10;"))
    with env.vm.expect_revert("from_and_to_must_be_signed"):
        claim(env, "e1", alert(token(env, "e1"), h="from:subject:date"))


def test_evidence_hash_must_match(env):
    open_job(env)
    dns(env)
    with env.vm.expect_revert("evidence_hash_mismatch"):
        claim(env, "e1", alert(token(env, "e1")), sha="ab" * 32)


# ------------------------------------------------------------------ mismatched evidence


def test_recipient_must_be_registered(env):
    open_job(env)
    dns(env)
    with env.vm.expect_revert("recipient_not_registered"):
        claim(env, "e1", alert(token(env, "e1"), to="mailer@uptime.example"))
    with env.vm.expect_revert("recipient_not_registered"):
        claim(env, "e1", alert(token(env, "e1"), to=f"{TO}, extra@example.org"))


def test_token_binds_email_job_and_template(env):
    open_job(env)
    open_job(env, job="job-2")
    dns(env)
    raw = alert(token(env, "e1"))
    with env.vm.expect_revert("receipt_token_missing"):
        claim(env, "e2", raw)  # the message proves e1, not e2
    with env.vm.expect_revert("receipt_token_missing"):
        claim(env, "e1", raw, job="job-2")
    with env.vm.expect_revert("unknown template"):
        claim(env, "e1", raw, template="verification")
    assert env.sends == []


# ------------------------------------------------------------------ replay


def test_replay_is_refused(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"))
    claim(env, "e1", raw)
    with env.vm.expect_revert("email already claimed"):
        claim(env, "e1", raw, url_name="again")
    assert env.sends == [(hexof(env.payee), PRICE)]


# ------------------------------------------------------------------ caps, time, access


def test_daily_cap_counts_by_signed_day(env):
    open_job(env, cap=2)
    dns(env)
    env.vm.warp(iso(T0 + 60))
    claim(env, "e1", alert(token(env, "e1"), t=T0 + 10))
    claim(env, "e2", alert(token(env, "e2"), t=T0 + 20))
    assert env.c.claimable_today(hexof(env.owner), "job-1", T0) == 0
    with env.vm.expect_revert("daily cap reached"):
        claim(env, "e3", alert(token(env, "e3"), t=T0 + 30))
    env.vm.warp(iso(T0 + 86400))
    claim(env, "e3", alert(token(env, "e3"), t=T0 + 86400 - 5))
    assert env.c.claimable_today(hexof(env.owner), "job-1", T0 + 86400) == 1


def test_default_cap_is_ten_and_bounds(env):
    open_job(env, value=20 * PRICE)
    assert env.c.get_job(hexof(env.owner), "job-1")["daily_cap"] == 10
    env.vm.sender = env.owner
    env.vm.value = PRICE
    with env.vm.expect_revert("bad daily_cap"):
        env.c.open_job("job-x", [env.rh], 101, 0)
    with env.vm.expect_revert("1 to 3 recipients"):
        env.c.open_job("job-x", [], 0, 0)
    env.vm.value = 0
    with env.vm.expect_revert("deposit some GEN"):
        env.c.open_job("job-x", [env.rh], 0, 0)


def test_message_time_window(env):
    open_job(env)
    dns(env)
    with env.vm.expect_revert("signature dated in the future"):
        claim(env, "e1", alert(token(env, "e1"), t=T0 + 3600))
    with env.vm.expect_revert("message outside the job's term"):
        claim(env, "e1", alert(token(env, "e1"), t=T0 - 100))  # signed before the deposit
    env.vm.warp(iso(T0 + 8 * 86400))
    with env.vm.expect_revert("message too old to claim"):
        claim(env, "e1", alert(token(env, "e1"), t=T0 + 10))


def test_only_mailer_claims(env):
    open_job(env)
    dns(env)
    raw = alert(token(env, "e1"))
    url, h = publish(env, raw, "e1")
    env.vm.sender = env.payee
    with env.vm.expect_revert("only mailer"):
        env.c.claim(hexof(env.owner), "job-1", "e1", "alert", url, h)


def test_owner_withdraws_immediately_and_claims_stop(env):
    open_job(env, value=3 * PRICE)
    dns(env)
    claim(env, "e1", alert(token(env, "e1")))
    env.vm.sender = env.owner
    assert env.c.withdraw("job-1", 0) == 2 * PRICE
    assert env.sends[-1] == (hexof(env.owner), 2 * PRICE)
    with env.vm.expect_revert("insufficient credit"):
        claim(env, "e2", alert(token(env, "e2")))
    env.vm.sender = env.mailer  # nobody else can withdraw: jobs are keyed by the caller
    with env.vm.expect_revert("unknown job"):
        env.c.withdraw("job-1", 0)


def test_partial_withdraw_and_top_up(env):
    open_job(env, value=3 * PRICE)
    env.vm.sender = env.owner
    with env.vm.expect_revert("insufficient balance"):
        env.c.withdraw("job-1", 4 * PRICE)
    env.c.withdraw("job-1", PRICE)
    env.vm.value = 5 * PRICE
    env.c.top_up("job-1")
    env.vm.value = 0
    assert env.c.get_job(hexof(env.owner), "job-1")["balance"] == 7 * PRICE
    assert env.c.get_config()["total_escrowed"] == 7 * PRICE


def test_expiry_stops_claims_and_refunds_to_owner(env):
    open_job(env, ttl=86400)
    dns(env)
    env.vm.sender = env.mailer
    with env.vm.expect_revert("job not expired"):
        env.c.refund_expired(hexof(env.owner), "job-1")
    env.vm.warp(iso(T0 + 86400))
    with env.vm.expect_revert("job expired"):
        claim(env, "e1", alert(token(env, "e1"), t=T0 + 10))
    env.vm.sender = env.mailer  # anyone may trigger it; the money only goes to the owner
    assert env.c.refund_expired(hexof(env.owner), "job-1") == 10 * PRICE
    assert env.sends == [(hexof(env.owner), 10 * PRICE)]
    env.vm.sender = env.owner
    with env.vm.expect_revert("job expired"):
        env.vm.value = PRICE
        env.c.top_up("job-1")
    env.vm.value = 0


# ------------------------------------------------------------------ admin


def test_mailer_rotation_and_new_keys_wait_for_the_delay(env):
    open_job(env)
    env.vm.sender = env.owner
    with env.vm.expect_revert("only admin"):
        env.c.propose("payee", hexof(env.owner))
    env.vm.sender = env.admin
    env.c.propose("mailer", hexof(env.payee))
    with env.vm.expect_revert("not ready"):
        env.c.execute("mailer")
    env.c.add_key("pm2", pin(EVIL))
    env.vm.warp(iso(T0 + 1800))
    dns(env, key=EVIL, selector="pm2")
    env.vm.sender = env.payee
    raw = alert(token(env, "e1"), key=EVIL, selector="pm2", t=T0 + 1800)
    url, h = publish(env, raw, "e1")
    with env.vm.expect_revert("only mailer"):
        env.c.claim(hexof(env.owner), "job-1", "e1", "alert", url, h)
    env.vm.warp(iso(T0 + 3600))
    env.vm.sender = env.admin
    env.c.execute("mailer")
    assert env.c.get_config()["mailer"] == hexof(env.payee)
    env.vm.sender = env.payee
    assert env.c.claim(hexof(env.owner), "job-1", "e1", "alert", url, h)["amount"] == PRICE
    env.vm.sender = env.admin
    env.c.retire_key("pm2")
    assert "pm2" not in env.c.get_config()["keys"]


def test_key_not_yet_active_is_not_pinned(env):
    open_job(env)
    env.vm.sender = env.admin
    env.c.add_key("pm2", pin(EVIL))
    dns(env, key=EVIL, selector="pm2")
    with env.vm.expect_revert("selector_not_pinned"):
        claim(env, "e1", alert(token(env, "e1"), key=EVIL, selector="pm2"))
